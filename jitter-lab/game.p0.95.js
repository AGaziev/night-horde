// Client-side game state: own hero prediction, snapshot buffer with interpolation, effect events.
import { HEROES, PASSIVES, PLAYER_COLORS, POS_HZ, ENEMIES, ENEMY_TYPES } from '/shared/content.js';

// Render clock. Snapshots arrive unevenly (tunnel bursts, server tick stalls), so the delay adapts:
// render time = now - p90(arrival - tm) over the last CLOCK_WINDOW snapshots - p90(snapshot gap) - margin.
const CLOCK_WINDOW = 40;
const CLOCK_PCT = 0.95;
const CLOCK_MARGIN = 0.02;
const CLOCK_SLEW = 0.12; // max playback speed deviation while catching up
const CLOCK_GAIN = 2;
const CLOCK_SNAP = 0.5; // jump instead of slewing when this far off
const MAX_EXTRAPOLATE = 0.2;
export const TELEPORT_DIST = 200; // moved more than this between snapshots: place, don't slide
const RECONCILE_DIST = 150;
const MAX_SNAPS = 8;
const MAX_PARTICLES = 700;
const MAX_NUMBERS = 90;

// Player row indexes in snapshot `p`.
export const P = { pid: 0, x: 1, y: 2, hp: 3, maxHp: 4, level: 5, xp: 6, xpNext: 7, st: 8, rev: 9, fx: 10, fy: 11, w: 12 };

const EMPTY = [];

function indexFlat(arr, stride) {
	const m = new Map();
	if (!Array.isArray(arr)) return m;
	for (let i = 0; i + stride <= arr.length; i += stride) m.set(arr[i], i);
	return m;
}

const SHOT_STEP = 1 / 60;
const MIN_SHOT_VISIBLE = 0.08;

export class Game {
	constructor(net) {
		this.net = net;
		this.me = null;
		this.running = false;
		this.players = new Map(); // pid -> {pid, name, hero, color}
		this.snaps = [];
		this.resetClock();
		this.local = { x: 0, y: 0, fx: 1, fy: 0 };
		this.passives = {};
		this.offer = null;
		this.posTimer = 0;
		this.lastSent = { x: NaN, y: NaN };
		// t: 0..1 between a and b; et: same, but may exceed 1 while extrapolating past the newest snapshot.
		this.view = { tm: 0, a: null, b: null, t: 0, et: 0 };

		this.shots = new Map(); // projectile id -> locally simulated projectile
		this.numbers = [];
		this.particles = [];
		this.zaps = [];
		this.slashes = [];
		this.rings = [];
		this.shake = 0;
		this.hurtFlash = 0;
		this.onEvent = () => {};
	}

	reset() {
		this.snaps.length = 0;
		this.resetClock();
		this.passives = {};
		this.offer = null;
		this.shots.clear();
		this.numbers.length = 0;
		this.particles.length = 0;
		this.zaps.length = 0;
		this.slashes.length = 0;
		this.rings.length = 0;
		this.shake = 0;
		this.hurtFlash = 0;
		this.view.a = this.view.b = null;
		this.view.tm = 0;
	}

	begin(msg) {
		this.reset();
		this.running = true;
		const list = Array.isArray(msg.players) ? msg.players : EMPTY;
		list.forEach((p, i) => {
			this.players.set(p.pid, {
				pid: p.pid,
				name: p.name || 'Игрок',
				hero: HEROES[p.hero] ? p.hero : 'knight',
				color: p.color || PLAYER_COLORS[i % PLAYER_COLORS.length],
			});
			if (p.pid === this.me) {
				this.local.x = +p.x || 0;
				this.local.y = +p.y || 0;
				this.local.fx = 1;
				this.local.fy = 0;
			}
		});
	}

	resetClock() {
		this.offs = [];
		this.gaps = [];
		this.clockRef = null;
		this.renderTm = null;
		this.lastNow = 0;
	}

	stop() {
		this.running = false;
		this.offer = null;
	}

	setLobbyPlayers(list) {
		for (const p of list || EMPTY) {
			this.players.set(p.pid, { pid: p.pid, name: p.name, hero: p.hero, color: p.color });
		}
	}

	meta(pid) {
		let m = this.players.get(pid);
		if (!m) {
			m = { pid, name: 'Игрок', hero: 'knight', color: PLAYER_COLORS[Math.abs(pid | 0) % PLAYER_COLORS.length] };
			this.players.set(pid, m);
		}
		return m;
	}

	passiveLevel(id) { return this.passives[id] || 0; }
	speedMul() { return 1 + PASSIVES.swift.perLevel * this.passiveLevel('swift'); }
	areaMul() { return 1 + PASSIVES.area.perLevel * this.passiveLevel('area'); }

	pick(i) {
		const offer = this.offer;
		if (!offer || !offer.choices[i]) return false;
		const c = offer.choices[i];
		if (c.kind === 'passive' && PASSIVES[c.id]) this.passives[c.id] = c.level || this.passiveLevel(c.id) + 1;
		this.net.send({ t: 'pick', i });
		this.offer = null;
		return true;
	}

	onSnapshot(msg) {
		const now = performance.now() / 1000;
		const tm = +msg.tm || 0;
		const last = this.snaps[this.snaps.length - 1];
		if (last && tm < last.tm - 1) {
			// Server time went backwards: a new run.
			this.snaps.length = 0;
			this.resetClock();
			this.shots.clear();
		}
		const prevTm = this.snaps.length ? this.snaps[this.snaps.length - 1].tm : null;
		if (prevTm !== null && tm <= prevTm) {
			// Duplicate or stale snapshot: keep projectile events, skip the rest.
			if (Array.isArray(msg.fx)) for (const ev of msg.fx) if (Array.isArray(ev)) this.shotEvent(ev);
			return;
		}
		const snap = {
			tm,
			k: msg.k | 0,
			p: Array.isArray(msg.p) ? msg.p : EMPTY,
			pMap: new Map(),
			e: Array.isArray(msg.e) ? msg.e : EMPTY,
			b: Array.isArray(msg.b) ? msg.b : EMPTY,
			g: Array.isArray(msg.g) ? msg.g : EMPTY,
			z: Array.isArray(msg.z) ? msg.z : EMPTY,
			fx: Array.isArray(msg.fx) ? msg.fx : EMPTY,
			boss: Array.isArray(msg.boss) ? msg.boss : null,
			applied: false,
		};
		for (const row of snap.p) if (Array.isArray(row)) snap.pMap.set(row[P.pid], row);
		for (const ev of snap.fx) if (Array.isArray(ev)) this.shotEvent(ev);
		snap.eIdx = indexFlat(snap.e, 5);
		snap.bIdx = indexFlat(snap.b, 5);
		snap.gIdx = indexFlat(snap.g, 4);
		this.snaps.push(snap);
		if (this.snaps.length > MAX_SNAPS) this.snaps.shift();

		this.trackClock(now - tm, prevTm === null ? null : tm - prevTm);

		const mine = snap.pMap.get(this.me);
		if (mine) {
			const sx = +mine[P.x], sy = +mine[P.y];
			if (mine[P.st] === 1 || Math.hypot(sx - this.local.x, sy - this.local.y) > RECONCILE_DIST) {
				this.local.x = sx;
				this.local.y = sy;
			}
		}
	}

	trackClock(off, gap) {
		pushWindow(this.offs, off);
		if (gap !== null) pushWindow(this.gaps, gap);
		const gapRef = this.gaps.length ? percentile(this.gaps, CLOCK_PCT) : 0.1;
		this.clockRef = percentile(this.offs, CLOCK_PCT) + gapRef + CLOCK_MARGIN;
	}

	latest() { return this.snaps[this.snaps.length - 1] || null; }

	myRow() {
		const s = this.latest();
		return s ? s.pMap.get(this.me) || null : null;
	}

	isAlive() {
		const r = this.myRow();
		return !r || r[P.st] !== 1;
	}

	update(dt, input) {
		const now = performance.now() / 1000;
		this.updateView(now);
		this.applyEffects();
		this.advanceShots();

		if (this.running) {
			const row = this.myRow();
			const alive = !row || row[P.st] !== 1;
			if (alive) {
				const v = input.vector();
				if (v.x || v.y) {
					const hero = HEROES[this.meta(this.me).hero] || HEROES.knight;
					const sp = hero.speed * this.speedMul();
					this.local.x += v.x * sp * dt;
					this.local.y += v.y * sp * dt;
					const len = Math.hypot(v.x, v.y);
					this.local.fx = v.x / len;
					this.local.fy = v.y / len;
				}
				this.posTimer -= dt;
				if (this.posTimer <= 0 && this.me !== null) {
					this.posTimer += 1 / POS_HZ;
					if (this.posTimer < 0) this.posTimer = 0;
					this.net.send({
						t: 'pos',
						x: Math.round(this.local.x * 10) / 10,
						y: Math.round(this.local.y * 10) / 10,
						fx: Math.round(this.local.fx * 1000) / 1000,
						fy: Math.round(this.local.fy * 1000) / 1000,
					});
				}
			} else if (row) {
				this.local.x = +row[P.x];
				this.local.y = +row[P.y];
			}
		}

		this.updateEffects(dt);
	}

	updateView(now) {
		const v = this.view;
		const n = this.snaps.length;
		if (!n || this.clockRef === null) {
			v.a = v.b = null;
			return;
		}
		// Slew the render clock towards its target so a changed delay never makes the world jump.
		const target = now - this.clockRef;
		const dt = now - this.lastNow;
		this.lastNow = now;
		if (this.renderTm === null || dt < 0 || dt > 0.25 || Math.abs(target - this.renderTm) > CLOCK_SNAP) {
			this.renderTm = target;
		} else {
			const err = target - this.renderTm;
			this.renderTm += dt * (1 + Math.max(-CLOCK_SLEW, Math.min(CLOCK_SLEW, err * CLOCK_GAIN)));
		}
		const rt = this.renderTm;
		const last = this.snaps[n - 1];
		let a = this.snaps[0], b = a, et = 1;
		if (rt >= last.tm) {
			// Newest snapshot is late: keep things moving along their last velocity for a short while.
			if (n >= 2) {
				a = this.snaps[n - 2];
				b = last;
				et = (Math.min(rt, last.tm + MAX_EXTRAPOLATE) - a.tm) / (b.tm - a.tm);
			} else {
				a = b = last;
			}
		} else if (rt > a.tm) {
			for (let i = 1; i < n; i++) {
				if (this.snaps[i].tm >= rt) {
					a = this.snaps[i - 1];
					b = this.snaps[i];
					break;
				}
			}
			et = (rt - a.tm) / (b.tm - a.tm);
		}
		v.a = a;
		v.b = b;
		v.et = et;
		v.t = Math.min(1, Math.max(0, et));
		// Displayed time keeps flowing smoothly, but never runs far ahead of the newest snapshot.
		v.tm = Math.max(0, Math.min(rt, last.tm + 0.3));
	}

	// Interpolated position of another player; returns null if unknown.
	playerPos(pid, out) {
		const { a, b, et: t } = this.view;
		if (pid === this.me && this.running) {
			out.x = this.local.x;
			out.y = this.local.y;
			return out;
		}
		if (!b) return null;
		const rb = b.pMap.get(pid);
		if (!rb) return null;
		let ra = a.pMap.get(pid) || rb;
		if (Math.abs(rb[P.x] - ra[P.x]) + Math.abs(rb[P.y] - ra[P.y]) > TELEPORT_DIST) ra = rb;
		out.x = ra[P.x] + (rb[P.x] - ra[P.x]) * t;
		out.y = ra[P.y] + (rb[P.y] - ra[P.y]) * t;
		return out;
	}

	// Shot events are taken in as soon as a snapshot arrives: a projectile may start and end between two snapshots.
	shotEvent(ev) {
		switch (ev[0]) {
			case 'shot': {
				const st = +ev[9] || 0;
				this.shots.set(ev[1], {
					kind: ev[2] | 0, x: +ev[3], y: +ev[4], vx: +ev[5], vy: +ev[6],
					speed: Math.hypot(+ev[5], +ev[6]) || 1, target: ev[8] | 0, retarget: null,
					st, simT: st, end: st + (+ev[7] || 1), endX: null, endY: null, show: false,
				});
				break;
			}
			case 'ptgt': {
				const s = this.shots.get(ev[1]);
				if (s) s.retarget = { tm: +ev[3] || 0, target: ev[2] | 0 };
				break;
			}
			case 'pend': {
				const s = this.shots.get(ev[1]);
				if (!s) break;
				s.end = Math.max(+ev[4] || 0, s.st + MIN_SHOT_VISIBLE);
				s.endX = +ev[2];
				s.endY = +ev[3];
				break;
			}
		}
	}

	enemyPos(id, out) {
		const b = this.view.b;
		if (!b) return null;
		const i = b.eIdx.get(id);
		if (i === undefined) return null;
		return lerpEnemy(this.view, i, out);
	}

	advanceShots() {
		const vt = this.view.tm;
		const tp = this.tmpShot ??= { x: 0, y: 0 };
		for (const [id, s] of this.shots) {
			if (vt >= s.end) {
				this.shots.delete(id);
				continue;
			}
			s.show = vt >= s.st;
			// Same steering as the server (fixed steps so the curve does not depend on the frame rate).
			while (s.simT + SHOT_STEP <= vt) {
				if (s.retarget && s.simT >= s.retarget.tm) {
					s.target = s.retarget.target;
					s.retarget = null;
				}
				if (s.target >= 0 && this.enemyPos(s.target, tp)) {
					const dx = tp.x - s.x, dy = tp.y - s.y;
					const d = Math.hypot(dx, dy) || 1;
					const k = Math.min(1, SHOT_STEP * 10);
					s.vx += ((dx / d) * s.speed - s.vx) * k;
					s.vy += ((dy / d) * s.speed - s.vy) * k;
					const v = Math.hypot(s.vx, s.vy) || 1;
					s.vx = (s.vx / v) * s.speed;
					s.vy = (s.vy / v) * s.speed;
				}
				s.x += s.vx * SHOT_STEP;
				s.y += s.vy * SHOT_STEP;
				s.simT += SHOT_STEP;
			}
			// Never overshoot the point where the server ended it.
			if (s.endX !== null && s.simT >= s.end - SHOT_STEP) {
				s.x = s.endX;
				s.y = s.endY;
			}
		}
	}

	applyEffects() {
		const rt = this.view.tm;
		const n = this.snaps.length;
		for (let i = 0; i < n; i++) {
			const s = this.snaps[i];
			// Effects play when the render clock reaches their snapshot; never lag more than two snapshots.
			if (s.applied || (s.tm > rt + 0.001 && i >= n - 2)) continue;
			s.applied = true;
			for (const ev of s.fx) if (Array.isArray(ev)) this.effect(ev);
		}
	}

	effect(ev) {
		switch (ev[0]) {
			case 'hit':
				if (this.numbers.length < MAX_NUMBERS) {
					this.numbers.push({ x: +ev[1] + (Math.random() - 0.5) * 10, y: +ev[2] - 10, v: Math.round(+ev[3] || 0), t: 0 });
				}
				break;
			case 'die': {
				const def = ENEMIES[ENEMY_TYPES[ev[3]]] || ENEMIES.bat;
				this.burst(+ev[1], +ev[2], def.color, def === ENEMIES.boss ? 60 : def.r > 15 ? 14 : 8, def.r);
				this.rings.push({ x: +ev[1], y: +ev[2], t: 0, life: 0.3, r0: def.r * 0.5, r1: def.r * 2, color: def.color });
				break;
			}
			case 'zap':
				this.zaps.push({ pts: jagged(+ev[1], +ev[2], +ev[3], +ev[4]), t: 0 });
				break;
			case 'slash':
				this.slashes.push({ pid: ev[1], dir: ev[2] < 0 ? -1 : 1, range: +ev[3] || 110, width: +ev[4] || 40, t: 0 });
				break;
			case 'hurt':
				if (ev[1] === this.me) {
					this.shake = Math.min(14, this.shake + 7);
					this.hurtFlash = 1;
				}
				break;
			case 'down':
				this.onEvent('down', ev[1]);
				if (ev[1] === this.me) this.shake = 16;
				break;
			case 'up':
				this.onEvent('up', ev[1]);
				break;
			case 'lvl': {
				const pt = this.playerPos(ev[1], { x: 0, y: 0 });
				if (pt) this.rings.push({ x: pt.x, y: pt.y, t: 0, life: 0.7, r0: 10, r1: 90, color: '#80deea', pid: ev[1] });
				break;
			}
			case 'boss':
				this.shake = 12;
				this.onEvent('boss', ev[1]);
				break;
			case 'chest':
				this.burst(+ev[1], +ev[2], '#ffd54f', 40, 20);
				this.rings.push({ x: +ev[1], y: +ev[2], t: 0, life: 1, r0: 10, r1: 160, color: '#ffd54f' });
				this.onEvent('chest');
				break;
		}
	}

	burst(x, y, color, n, spread) {
		for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
			const a = Math.random() * Math.PI * 2;
			const s = 40 + Math.random() * (80 + spread * 4);
			this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.35 + Math.random() * 0.35, color, size: 2 + Math.random() * 3 });
		}
	}

	updateEffects(dt) {
		this.shake = Math.max(0, this.shake - dt * 40);
		this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
		compact(this.numbers, (n) => (n.t += dt) < 0.8);
		compact(this.particles, (p) => {
			p.t += dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.vx *= 0.9;
			p.vy *= 0.9;
			return p.t < p.life;
		});
		compact(this.zaps, (z) => (z.t += dt) < 0.25);
		compact(this.slashes, (s) => (s.t += dt) < 0.22);
		compact(this.rings, (r) => (r.t += dt) < r.life);
	}
}

// Enemy at flat index i of view.b, interpolated (or briefly extrapolated) from view.a.
// out.dx is the movement between the two snapshots (for facing).
export function lerpEnemy(view, i, out) {
	const { a, b, et } = view;
	const bx = b.e[i + 2], by = b.e[i + 3];
	const j = a.eIdx.get(b.e[i]);
	const ax = j === undefined ? bx : a.e[j + 2];
	const ay = j === undefined ? by : a.e[j + 3];
	if (Math.abs(bx - ax) + Math.abs(by - ay) > TELEPORT_DIST) {
		// Respawned on a new ring or reappeared after leaving the view: no slide across the map.
		out.x = bx;
		out.y = by;
		out.dx = 0;
		return out;
	}
	out.x = ax + (bx - ax) * et;
	out.y = ay + (by - ay) * et;
	out.dx = bx - ax;
	return out;
}

function pushWindow(arr, v) {
	arr.push(v);
	if (arr.length > CLOCK_WINDOW) arr.shift();
}

function percentile(arr, q) {
	const s = arr.slice().sort((x, y) => x - y);
	return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
}

// In-place filter without allocating.
function compact(arr, keep) {
	let j = 0;
	for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[j++] = arr[i];
	arr.length = j;
}

function jagged(x1, y1, x2, y2) {
	const pts = [x1, y1];
	const segs = 7;
	const dx = x2 - x1, dy = y2 - y1;
	const len = Math.hypot(dx, dy) || 1;
	const nx = -dy / len, ny = dx / len;
	for (let i = 1; i < segs; i++) {
		const k = i / segs;
		const off = (Math.random() - 0.5) * Math.min(40, len * 0.15);
		pts.push(x1 + dx * k + nx * off, y1 + dy * k + ny * off);
	}
	pts.push(x2, y2);
	return pts;
}
