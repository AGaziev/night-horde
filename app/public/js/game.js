// Client-side game state: own hero prediction, snapshot buffer with interpolation, effect events.
import { HEROES, WEAPONS, PASSIVES, PLAYER_COLORS, POS_HZ, ENEMIES, ENEMY_TYPES, PROJECTILE_KINDS, ITEM_TYPES, DUOS, EVOS, REACTION_IDS, REACT, PEAKS, EVENTS, FINALE, clampToRing, PLAYER_RADIUS } from '/shared/content.js';
import { HORDE_RULESET, HORDE_ARENA, HORDE_COMBAT, HORDE_BOSS_AT, HORDE_BOSS_TYPE } from '/shared/horde-content.js';

// Cards that «Изгнать» accepts: plain weapons, artifacts and overclock variants (the server checks the same).
export const canBan = (c) => (c?.kind === 'weapon' && !!WEAPONS[c.id]) || c?.kind === 'passive' || c?.kind === 'ovr';

// Render clock. Snapshots arrive unevenly (tunnel bursts, server tick stalls), so the delay adapts:
// render time = now - p90(arrival - tm) over the last CLOCK_WINDOW snapshots - p90(snapshot gap) - margin.
const CLOCK_WINDOW = 40;
const CLOCK_PCT = 0.9;
const CLOCK_MARGIN = 0.02;
const CLOCK_SLEW = 0.12; // max playback speed deviation while catching up
const CLOCK_GAIN = 2;
const CLOCK_SNAP = 0.5; // jump instead of slewing when this far off
const MAX_EXTRAPOLATE = 0.2;
// An enemy that moved farther than this between two snapshots is placed, not slid across the map.
const TELEPORT_DIST = 200;
const TELEPORT_SPEED = 400;
const RECONCILE_DIST = 150;
const MAX_SNAPS = 8;
const MAX_PARTICLES = 700;
const MAX_NUMBERS = 90;
const HORDE_FX_KINDS = new Set(['venom', 'frost', 'storm', 'ember', 'reaper', 'arbalest', 'barrier', 'conductor', 'heal']);
const MAX_HORDE_FX = 80;
// Enemies are flat records of E_STRIDE: [id, type, x, y, hpPct, stateBits].
export const E_STRIDE = 6;
const SICKLE_CATCH = 24;
const ICEDISC = PROJECTILE_KINDS.indexOf('icedisc');
const ICE_TRAIL_LIFE = 2.5;
const REACT_LIFE = 0.5;
const REACT_LABEL_LIFE = 0.9;
const REACT_LABEL_EVERY = 0.5; // per reaction kind, so labels do not pile up
// Puddle looks announced by 'zk': 1 burning pool, 2 censer cloud, 3 lane of light (Солнечное копьё, v24).
export const ZK_FIRE = 1, ZK_CLOUD = 2, ZK_LIGHT = 3;
// Trap records in snapshot `tr`: [id, x, y, kind, ownerPid]; kind 0 trap, 1 mine, 2 mine recharging, 3 spike.
export const TR_STRIDE = 5;

// Player row indexes in snapshot `p`.
export const P = { pid: 0, x: 1, y: 2, hp: 3, maxHp: 4, level: 5, xp: 6, xpNext: 7, st: 8, rev: 9, fx: 10, fy: 11, w: 12, ward: 13, heroShield: 14 };

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
		this.ruleset = 'pve';
		this.roundId = null;
		this.bossSchedule = null;
		this.directorPid = null;
		this.arena = null;
		this.directorCamera = { x: 0, y: 0, zoom: 0.65 };
		this.hordeState = null;
		this.hordeTarget = null;
		this.hordeSelected = null;
		this.hordeStatuses = new Map();
		this.hordeStatusTime = -Infinity;
		this.hordeStatusAt = 0;
		this.hordeResyncTime = -Infinity; this.hordeResyncAt = 0; this.hordeQueuedFx = null;
		this.hordeFx = [];
		this.players = new Map(); // pid -> {pid, name, hero, color}
		this.snaps = [];
		this.resetClock();
		this.local = { x: 0, y: 0, fx: 1, fy: 0 };
		this.embers = {};
		this.passives = {};
		this.pvals = {};
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
		this.coldWaves = [];
		this.shake = 0;
		this.hurtFlash = 0;
		this.dawn = null; // {t, n}: the final burn at 15:00, drives the victory overlay
		this.hostile = new Map(); // enemy projectile id -> {x, y, vx, vy, st, end}
		this.lobs = new Map(); // petard id -> {x0, y0, x1, y1, st, fuse}
		this.warns = [];
		this.blines = []; // boss charge lanes {x1, y1, x2, y2, w, t, life}
		this.broken = new Set(); // broken prop tiles, key tx * 100003 + ty
		this.eliteAffix = new Map(); // enemy id -> index in ELITE_AFFIXES
		this.orbs = new Map(); // ball lightning id -> {x0, y0, x1, y1, speed, st, life, r}
		this.zk = new Map(); // puddle id -> look (ZK_*)
		this.iceTrail = []; // {x, y, t} points left by ice discs
		this.tslashes = []; // Thunder Slash swings {pid, range, width, big, t}
		this.fans = []; // Thunder Slash fans {pid, r, t}
		this.syn = 0; // «Слаженность», %
		this.cones = []; // Lantern light {pid, a, range, half, t}
		this.crescents = []; // Crescent full-circle swings {pid, r, t}
		this.reacts = []; // reaction effects {kind, x, y, r, t, seed}
		this.labels = []; // reaction captions {kind, x, y, t}
		this.labelAt = {}; // kind -> last caption time
		this.steams = []; // steam clouds {x, y, r, t, life}
		this.banners = []; // planted banners {pid, x, y, r, t, life}
		this.evoFlash = null; // own evolution: {color, t}
		// v21 finale: threads of the absorbed horde {t, cx, cy, pts}, the Lord's death {t, x, y}, freeze-frame seconds left.
		this.absorb = null;
		this.lordDie = null;
		this.hold = 0;
		this.dawnPending = null;
		this.onEvent = () => {};
	}

	reset() {
		this.clearHordeCombat();
		this.snaps.length = 0;
		this.resetClock();
		this.passives = {};
		this.pvals = {};
		this.embers = {}; // v20: embers taken so far (message `emb`), shown in the HUD
		this.offer = null;
		this.shots.clear();
		this.numbers.length = 0;
		this.particles.length = 0;
		this.zaps.length = 0;
		this.slashes.length = 0;
		this.rings.length = 0;
		this.coldWaves.length = 0;
		this.shake = 0;
		this.hurtFlash = 0;
		this.dawn = null;
		this.dawnSeen = false;
		this.absorb = null;
		this.lordDie = null;
		this.hold = 0;
		this.dawnPending = null;
		this.hostile.clear();
		this.lobs.clear();
		this.warns.length = 0;
		this.blines.length = 0;
		this.broken.clear();
		this.eliteAffix.clear();
		this.orbs.clear();
		this.zk.clear();
		this.iceTrail.length = 0;
		this.tslashes.length = 0;
		this.fans.length = 0;
		this.syn = 0;
		this.cones.length = 0;
		this.crescents.length = 0;
		this.reacts.length = 0;
		this.labels.length = 0;
		this.labelAt = {};
		this.steams.length = 0;
		this.banners.length = 0;
		this.evoFlash = null;
		this.view.a = this.view.b = null;
		this.view.tm = 0;
	}

	begin(msg) {
		this.reset();
		this.players.clear();
		this.ruleset = msg.ruleset === HORDE_RULESET ? HORDE_RULESET : 'pve';
		this.roundId = this.ruleset === HORDE_RULESET && typeof msg.roundId === 'string' ? msg.roundId : null;
		this.bossSchedule = this.ruleset === HORDE_RULESET ? {
			type: msg.bossSchedule?.type || HORDE_BOSS_TYPE,
			at: Number.isFinite(msg.bossSchedule?.at) ? msg.bossSchedule.at : HORDE_BOSS_AT,
		} : null;
		this.directorPid = this.ruleset === HORDE_RULESET ? msg.directorPid : null;
		this.arena = this.ruleset === HORDE_RULESET ? (msg.arena || HORDE_ARENA) : null;
		this.running = true;
		this.frozen = this.ruleset !== HORDE_RULESET && msg.paused === true;
		this.menuPause = this.frozen && msg.menu === true;
		this.count = Array.isArray(msg.players) ? msg.players.length : 1;
		const br = Array.isArray(msg.broken) ? msg.broken : EMPTY;
		for (let i = 0; i + 1 < br.length; i += 2) this.broken.add((br[i] | 0) * 100003 + (br[i + 1] | 0));
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
				this.clampLocal();
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
		this.clearHordeCombat();
		this.running = false;
		this.offer = null;
		this.frozen = false;
		this.menuPause = false;
	}

	// One hero in the run: Esc / ⏸ pause and level-up offers stop the server.
	solo() {
		if (!this.running || this.ruleset === HORDE_RULESET) return false;
		const s = this.latest();
		return (s ? s.p.length : this.count) === 1;
	}

	isDirector() { return this.ruleset === HORDE_RULESET && this.directorPid === this.me; }

	// Server pause state. After a pause the snapshot clock restarts, so the world does not jump.
	setPause(on, menu) {
		if (this.ruleset === HORDE_RULESET) return;
		const was = this.frozen;
		this.frozen = !!on;
		this.menuPause = !!on && !!menu;
		if (was && !on) {
			// Keep drawing the frozen frame until the first new snapshot re-anchors the clock.
			this.offs = [];
			this.gaps = [];
		}
	}

	setLobbyPlayers(list) {
		this.players.clear();
		for (const p of list || EMPTY) {
			if (p.role === 'director') continue;
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
	// Accumulated artifact value: card rarity makes it differ from perLevel × level (server recalcMods does the same).
	passiveVal(id) { return this.pvals[id] ?? PASSIVES[id].perLevel * this.passiveLevel(id); }
	speedMul() {
		const speed = 1 + this.passiveVal('swift') + (this.inBanner() ? EVOS.banner.levels[0].speedBuff : 0);
		return this.ruleset === HORDE_RULESET ? speed * (1 - (this.hordeStatus(this.me)?.slow || 0)) : speed;
	}

	clearHordeCombat() {
		this.hordeStatuses.clear(); this.hordeFx.length = 0;
		this.hordeStatusTime = -Infinity; this.hordeStatusAt = 0;
		this.hordeResyncTime = -Infinity; this.hordeResyncAt = 0; this.hordeQueuedFx = null;
	}

	onHordeStatus(msg) {
		if (!this.running || this.ruleset !== HORDE_RULESET || !Number.isFinite(msg.time) || !Array.isArray(msg.effects)) return;
		if (msg.time < this.hordeStatusTime) return;
		this.hordeStatusTime = msg.time; this.hordeStatusAt = performance.now() / 1000;
		this.hordeStatuses.clear();
		for (const effect of msg.effects) {
			if (!effect || !this.players.has(effect.pid)) continue;
			this.hordeStatuses.set(effect.pid, {
				poisonUntil: Number.isFinite(effect.poisonUntil) ? effect.poisonUntil : 0,
				chillUntil: Number.isFinite(effect.chillUntil) ? effect.chillUntil : 0,
				slow: Number.isFinite(effect.slow) ? Math.max(0, Math.min(HORDE_COMBAT.slowCap, effect.slow)) : 0,
			});
		}
	}

	onHordeResync(msg) {
		if (!this.running || this.ruleset !== HORDE_RULESET || !this.roundId || msg.roundId !== this.roundId
			|| !Number.isFinite(msg.time) || msg.time <= this.hordeResyncTime) return;
		this.hordeResyncTime = msg.time; this.hordeResyncAt = performance.now() / 1000;
		this.hordeQueuedFx = new Map();
		for (const ev of msg.fxBefore || []) {
			const key = JSON.stringify(ev);
			this.hordeQueuedFx.set(key, (this.hordeQueuedFx.get(key) || 0) + 1);
		}
		const live = (row, fields) => row && Number.isFinite(row.remaining) && row.remaining > 0 && fields.every((key) => Number.isFinite(row[key]));
		const timing = (row) => ({ t: 0, life: row.remaining, serverStart: msg.time });
		this.warns = (msg.warnings || []).filter((row) => live(row, ['x', 'y', 'r']))
			.map((row) => ({ x: row.x, y: row.y, r: row.r, ...timing(row) }));
		this.blines = (msg.lanes || []).filter((row) => live(row, ['x1', 'y1', 'x2', 'y2', 'w']))
			.map((row) => ({ x1: row.x1, y1: row.y1, x2: row.x2, y2: row.y2, w: row.w, ...timing(row) }));
		this.hostile.clear();
		for (const row of msg.shots || []) {
			if (!live(row, ['id', 'x', 'y', 'vx', 'vy'])) continue;
			this.hostile.set(row.id, { x0: row.x, y0: row.y, x: row.x, y: row.y, vx: row.vx, vy: row.vy,
				st: msg.time, end: msg.time + row.remaining, r: row.r, show: true, authoritative: true });
		}
	}

	hordeTime() {
		const snap = this.latest(), now = performance.now() / 1000;
		return Math.max(this.view.tm,
			snap ? snap.tm + Math.max(0, now - snap.at) : -Infinity,
			this.hordeStatusTime + Math.max(0, now - this.hordeStatusAt),
			this.hordeResyncTime + Math.max(0, now - this.hordeResyncAt));
	}

	hordeStatus(pid) {
		if (!this.running || this.ruleset !== HORDE_RULESET) return null;
		const state = this.hordeStatuses.get(pid);
		if (!state || this.latest()?.pMap.get(pid)?.[P.st] === 1) return null;
		const time = this.hordeTime();
		const poisonLeft = Math.max(0, state.poisonUntil - time), chillLeft = Math.max(0, state.chillUntil - time);
		return poisonLeft || chillLeft ? { poisonLeft, chillLeft, slow: chillLeft > 0 ? state.slow : 0 } : null;
	}

	onHordeFx(msg) {
		if (!this.running || this.ruleset !== HORDE_RULESET || !HORDE_FX_KINDS.has(msg.kind)) return;
		if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
		const paired = Number.isFinite(msg.x2) && Number.isFinite(msg.y2);
		if (this.hordeFx.length >= MAX_HORDE_FX) this.hordeFx.shift();
		this.hordeFx.push({
			kind: msg.kind, x: msg.x, y: msg.y, x2: paired ? msg.x2 : msg.x, y2: paired ? msg.y2 : msg.y,
			r: Number.isFinite(msg.r) ? Math.max(0, Math.min(500, msg.r)) : 24,
			life: Number.isFinite(msg.duration) ? Math.max(0.08, Math.min(3, msg.duration)) : 0.4, t: 0,
		});
	}
	inBanner() {
		for (const b of this.banners) if (b.t < b.life && Math.hypot(this.local.x - b.x, this.local.y - b.y) < b.r) return true;
		return false;
	}
	hasVictoryBanner(pid = this.me) { return this.latest()?.trophy?.includes(pid) ?? false; }
	areaMul(pid = this.me) { return (pid === this.me ? 1 + this.passiveVal('area') : 1) * (this.hasVictoryBanner(pid) ? 1.15 : 1); }

	pick(i, drop) {
		if (this.isDirector()) return false;
		const offer = this.offer;
		if (!offer || !offer.choices[i]) return false;
		const c = offer.choices[i];
		if (c.kind === 'swap' && !c.replace?.some(({ id }) => id === drop)) return false;
		if (c.kind === 'passive' && PASSIVES[c.id]) {
			if (typeof c.val === 'number') this.pvals[c.id] = this.passiveVal(c.id) + c.val;
			this.passives[c.id] = c.level || this.passiveLevel(c.id) + 1;
		}
		this.net.send({ t: 'pick', i, drop, offerEpoch: offer.offerEpoch });
		this.offer = null;
		return true;
	}

	// v20 «Изгнать»: the card leaves the pool for the rest of the run; the server answers with a new offer.
	ban(i) {
		if (this.isDirector()) return false;
		const c = this.offer?.choices[i];
		if (!c || !(this.offer.bans > 0) || !canBan(c)) return false;
		this.net.send({ t: 'ban', i, offerEpoch: this.offer.offerEpoch });
		return true;
	}

	reroll() {
		if (this.isDirector()) return false;
		if (!this.offer || !(this.offer.rerolls > 0)) return false;
		this.net.send({ t: 'reroll', offerEpoch: this.offer.offerEpoch });
		return true;
	}

	skip() {
		if (this.isDirector()) return false;
		if (!this.offer) return false;
		this.net.send({ t: 'skip', offerEpoch: this.offer.offerEpoch });
		this.offer = null;
		return true;
	}

	onSnapshot(msg) {
		// Room.snapshot rounds its clock to centiseconds; resync carries the full simulation time.
		const resyncSnapshotTime = Math.round(this.hordeResyncTime * 100) / 100;
		if (this.ruleset === HORDE_RULESET && msg.tm < resyncSnapshotTime) return;
		if (this.hordeQueuedFx && msg.tm >= resyncSnapshotTime) {
			const queued = this.hordeQueuedFx;
			this.hordeQueuedFx = null;
			msg = { ...msg, fx: (msg.fx || []).filter((ev) => {
				const key = JSON.stringify(ev), count = queued.get(key) || 0;
				if (!count) return true;
				queued.set(key, count - 1); return false;
			}) };
		}
		if (msg.gap) {
			// Delta without its base (net.js asked for a key): only projectile events are usable.
			for (const ev of msg.fx) if (Array.isArray(ev)) this.shotEvent(ev);
			return;
		}
		const now = performance.now() / 1000;
		const tm = +msg.tm || 0;
		const last = this.snaps[this.snaps.length - 1];
		if (last && tm < last.tm - 1) {
			// Server time went backwards: a new run.
			this.snaps.length = 0;
			this.resetClock();
			this.shots.clear();
			this.hostile.clear();
			this.lobs.clear();
		}
		const prevTm = this.snaps.length ? this.snaps[this.snaps.length - 1].tm : null;
		if (prevTm !== null && tm <= prevTm) {
			// Duplicate or stale snapshot: keep projectile events, skip the rest.
			if (Array.isArray(msg.fx)) for (const ev of msg.fx) if (Array.isArray(ev)) this.shotEvent(ev);
			return;
		}
		const snap = {
			tm,
			at: now,
			fin: Array.isArray(msg.fin) && msg.fin.length >= 6 ? msg.fin : null,
			k: msg.k | 0,
			op: msg.op && Array.isArray(msg.op.posts) ? msg.op : null,
			trophy: Array.isArray(msg.trophy) ? msg.trophy : EMPTY,
			support: Array.isArray(msg.support) ? msg.support : EMPTY,
			p: Array.isArray(msg.p) ? msg.p : EMPTY,
			pMap: new Map(),
			e: Array.isArray(msg.e) ? msg.e : EMPTY,
			b: Array.isArray(msg.b) ? msg.b : EMPTY,
			g: Array.isArray(msg.g) ? msg.g : EMPTY,
			z: Array.isArray(msg.z) ? msg.z : EMPTY,
			tr: Array.isArray(msg.tr) ? msg.tr : EMPTY,
			it: Array.isArray(msg.it) ? msg.it : EMPTY,
			fx: Array.isArray(msg.fx) ? msg.fx : EMPTY,
			boss: Array.isArray(msg.boss) ? msg.boss : null,
			pk: Array.isArray(msg.pk) && PEAKS[msg.pk[0]] ? msg.pk : null,
			ev: Array.isArray(msg.ev) && EVENTS[msg.ev[0]] ? msg.ev : null,
			applied: false,
		};
		// Wave 4: a phase step of the event (the cursed chest opened) gets its own banner.
		const pe = this.snaps.length ? this.snaps[this.snaps.length - 1].ev : null;
		if (snap.ev && pe && pe[0] === snap.ev[0] && pe[2] !== snap.ev[2]) this.onEvent('evphase', EVENTS[snap.ev[0]], snap.ev[2]);
		for (const row of snap.p) if (Array.isArray(row)) snap.pMap.set(row[P.pid], row);
		for (const ev of snap.fx) if (Array.isArray(ev)) {
			this.shotEvent(ev);
			if (ev[0] === 'dawn') this.dawnSeen = true;
		}
		snap.eIdx = indexFlat(snap.e, E_STRIDE);
		this.syn = msg.syn | 0;
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

	// Active peak at the render clock: {def, left} or null.
	peak() {
		const s = this.view.b || this.latest();
		return s && s.pk ? { def: PEAKS[s.pk[0]], left: +s.pk[1] || 0, dur: +s.pk[2] || PEAKS[s.pk[0]].dur || 1 } : null;
	}

	// Active Wave 4 event at the render clock: {def, left, phase, x, y, r, a, b} or null (snapshot `ev`).
	event() {
		const s = this.view.b || this.latest();
		const v = s && s.ev;
		return v ? { def: EVENTS[v[0]], left: +v[1] || 0, phase: v[2] | 0, x: +v[3], y: +v[4], r: +v[5] || 0, a: +v[6] || 0, b: +v[7] || 0 } : null;
	}

	// v21 finale at this moment: {phase, left, cx, cy, r, r1} or null. The ring is run forward from the newest snapshot
	// (the prelude shrinks it between snapshots), so the own hero's prediction and the drawn wall agree with the server.
	finale() {
		const s = this.latest();
		const f = s && s.fin;
		if (!f) return null;
		const age = this.frozen || this.hold > 0 ? 0 : Math.max(0, Math.min(1, performance.now() / 1000 - s.at));
		return { phase: f[0] | 0, left: Math.max(0, (+f[1] || 0) - age), cx: +f[2], cy: +f[3], r: Math.max(+f[5], +f[4] - FINALE.ring.shrink * age), r1: +f[5] };
	}

	myRow() {
		const s = this.latest();
		return s ? s.pMap.get(this.me) || null : null;
	}

	isAlive() {
		if (this.isDirector()) return false;
		const r = this.myRow();
		return !r || r[P.st] !== 1;
	}

	clampLocal() {
		const a = this.arena;
		if (!a) return;
		this.local.x = Math.max(a.minX + PLAYER_RADIUS, Math.min(a.maxX - PLAYER_RADIUS, this.local.x));
		this.local.y = Math.max(a.minY + PLAYER_RADIUS, Math.min(a.maxY - PLAYER_RADIUS, this.local.y));
	}

	update(dt, input) {
		const now = performance.now() / 1000;
		// Freeze frame on the Lord's last hit: the field stands still, then the dawn burn starts.
		if (this.hold > 0) {
			this.hold -= dt;
			if (this.hold > 0) return;
			if (this.dawnPending !== null) this.startDawn(this.dawnPending);
			this.dawnPending = null;
		}
		this.updateView(now);
		this.applyEffects();
		this.advanceShots();
		this.advanceHostile();
		if (this.isDirector()) {
			// Spatial effects and sound use a view anchor, without creating a hero or sending its position.
			this.local.x = this.directorCamera.x; this.local.y = this.directorCamera.y;
		}

		// Frozen by the server, or about to be (own offer open in solo): stand still.
		const still = this.frozen || (this.offer && this.solo());
		if (this.running && !still && !this.isDirector()) {
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
				// The finale wall: the same projection the server applies (a standing hero is pushed by the closing ring too).
				const fin = this.finale();
				if (fin) [this.local.x, this.local.y] = clampToRing(this.local.x, this.local.y, fin.cx, fin.cy, fin.r - PLAYER_RADIUS);
				this.clampLocal();
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
		if (pid === this.me && this.isDirector()) return null;
		if (pid === this.me && this.running) {
			out.x = this.local.x;
			out.y = this.local.y;
			return out;
		}
		if (!b) return null;
		const rb = b.pMap.get(pid);
		if (!rb) return null;
		const ra = a.pMap.get(pid) || rb;
		out.x = ra[P.x] + (rb[P.x] - ra[P.x]) * t;
		out.y = ra[P.y] + (rb[P.y] - ra[P.y]) * t;
		return out;
	}

	// Shot events are taken in as soon as a snapshot arrives: a projectile may start and end between two snapshots.
	shotEvent(ev) {
		this.sound?.shot(ev, this);
		switch (ev[0]) {
			case 'shot': {
				const st = +ev[9] || 0;
				this.shots.set(ev[1], {
					kind: ev[2] | 0, x: +ev[3], y: +ev[4], vx: +ev[5], vy: +ev[6],
					speed: Math.hypot(+ev[5], +ev[6]) || 1, target: ev[8] | 0, retarget: null,
					st, simT: st, end: st + (+ev[7] || 1), endX: null, endY: null, show: false,
					// Returning projectile (sickle): owner pid and the time it turns back.
					// v20: a 13th field marks a big projectile («Шаровая молния»), its owner field is -1.
					owner: ev.length >= 12 && ev[10] >= 0 ? ev[10] : null, turn: ev.length >= 12 && ev[10] >= 0 ? st + (+ev[11] || 0) : Infinity,
					big: ev.length >= 13 ? ev[12] | 0 : 0,
				});
				break;
			}
			case 'eshot': {
				const st = +ev[7] || 0;
				this.hostile.set(ev[1], { x0: +ev[2], y0: +ev[3], vx: +ev[4], vy: +ev[5], st, end: st + (+ev[6] || 1), x: +ev[2], y: +ev[3], show: false });
				break;
			}
			case 'eorb': {
				// Sniper orb: a slow big shot, drawn apart from the spitters' drops.
				const st = +ev[7] || 0;
				this.hostile.set(ev[1], { x0: +ev[2], y0: +ev[3], vx: +ev[4], vy: +ev[5], st, end: st + (+ev[6] || 1), x: +ev[2], y: +ev[3], show: false, r: +ev[8] || 12 });
				break;
			}
			case 'epend': {
				const s = this.hostile.get(ev[1]);
				if (s) s.end = Math.max(s.st + MIN_SHOT_VISIBLE, +ev[2] || 0);
				break;
			}
			case 'lob':
				this.lobs.set(ev[1], { x0: +ev[2], y0: +ev[3], x1: +ev[4], y1: +ev[5], fuse: +ev[6] || 0.6, st: +ev[7] || 0, kind: ev[8] | 0 });
				break;
			case 'orb':
			case 'orbm':
				// 'orbm': a homing orb turned; the new leg starts where it is now with the life it has left.
				this.orbs.set(ev[1], { x0: +ev[2], y0: +ev[3], x1: +ev[4], y1: +ev[5], speed: +ev[6] || 120, life: +ev[7] || 4, st: +ev[8] || 0, r: +ev[9] || 90, x: +ev[2], y: +ev[3], show: ev[0] === 'orbm' });
				break;
			case 'zk':
				this.zk.set(ev[1], ev[2] | 0);
				break;
			case 'brk':
				this.broken.add((ev[1] | 0) * 100003 + (ev[2] | 0));
				break;
			case 'elite':
				this.eliteAffix.set(ev[1], ev[2] | 0);
				break;
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
				if (s.simT >= s.turn && s.owner !== null && this.playerPos(s.owner, tp)) {
					// Same rule as the server: straight back to the owner.
					const dx = tp.x - s.x, dy = tp.y - s.y;
					const d = Math.hypot(dx, dy) || 1;
					if (d < SICKLE_CATCH) break;
					s.vx = (dx / d) * s.speed;
					s.vy = (dy / d) * s.speed;
				} else if (s.target >= 0 && this.enemyPos(s.target, tp)) {
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

	// Enemy projectiles fly straight: position is a function of the render time.
	advanceHostile() {
		const vt = this.view.tm;
		for (const [id, s] of this.hostile) {
			const time = s.authoritative ? Math.max(vt, this.hordeTime()) : vt;
			if (time >= s.end) {
				this.hostile.delete(id);
				continue;
			}
			s.show = time >= s.st;
			const k = Math.max(0, time - s.st);
			s.x = s.x0 + s.vx * k;
			s.y = s.y0 + s.vy * k;
		}
		for (const [id, l] of this.lobs) if (vt > l.st + l.fuse + 0.05) this.lobs.delete(id);
		for (const [id, o] of this.orbs) {
			const k = vt - o.st;
			if (k > o.life) {
				this.orbs.delete(id);
				continue;
			}
			o.show = k >= 0;
			// Same motion as the server: straight to the target point at constant speed, then hover.
			const dx = o.x1 - o.x0, dy = o.y1 - o.y0, d = Math.hypot(dx, dy) || 1;
			const f = Math.min(1, (Math.max(0, k) * o.speed) / d);
			o.x = o.x0 + dx * f;
			o.y = o.y0 + dy * f;
		}
		// Ice discs leave a frosty trail; the server keeps the same zones for the slow.
		for (const s of this.shots.values()) {
			if (s.kind !== ICEDISC || !s.show) continue;
			const last = s.trailAt;
			if (!last || Math.hypot(last.x - s.x, last.y - s.y) > 26) {
				s.trailAt = { x: s.x, y: s.y };
				this.iceTrail.push({ x: s.x, y: s.y, t: 0, seed: Math.random() * 6 });
			}
		}
		if (this.iceTrail.length > 400) this.iceTrail.splice(0, this.iceTrail.length - 400);
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
		this.sound?.fx(ev, this);
		switch (ev[0]) {
			case 'hit': {
				const crit = ev[4] === 1;
				if (this.numbers.length < MAX_NUMBERS || crit) {
					this.numbers.push({ x: +ev[1] + (Math.random() - 0.5) * 10, y: +ev[2] - 10, v: Math.round(+ev[3] || 0), t: 0, crit, mine: crit && ev[5] === this.me });
				}
				if (crit) this.burst(+ev[1], +ev[2] - 6, ev[5] === this.me ? '#ffee58' : '#fff59d', ev[5] === this.me ? 6 : 3, 2);
				break;
			}
			case 'die': {
				const def = ENEMIES[ENEMY_TYPES[ev[3]]] || ENEMIES.bat;
				this.burst(+ev[1], +ev[2], def.color, def.boss ? 60 : def.r > 15 ? 14 : 8, def.r);
				this.rings.push({ x: +ev[1], y: +ev[2], t: 0, life: 0.3, r0: def.r * 0.5, r1: def.r * 2, color: def.color });
				break;
			}
			case 'buildbeam':
				this.zaps.push({ pts: [+ev[1], +ev[2], +ev[3], +ev[4]], t: 0, color: '#d897ff' });
				break;
			case 'coldwave':
				this.coldWaves.push({ x: +ev[1], y: +ev[2], angle: +ev[3], range: +ev[4], width: +ev[5], speed: +ev[6], t: 0, life: +ev[4] / +ev[6] });
				break;
			case 'buildring': {
				const r = +ev[3] || 60, color = ['#d1a6ff', '#ffd47e', '#9ee8ff', '#ff9d55', '#a5f0c6'][ev[4]] || '#d1a6ff';
				this.rings.push({ x: +ev[1], y: +ev[2], t: 0, life: 0.33, r0: r * 0.25, r1: r, color, fill: true });
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
			case 'boom': {
				const x = +ev[1], y = +ev[2], r = +ev[3] || 60, kind = ev[4] | 0;
				// 0 petard, 1 bloater, 2 volatile, 3 ball lightning, 4 ice grenade, 5 mine/pit, 6 molotov, 7 ward, 8 fireworks.
				const color = ['#ffb74d', '#ef9a9a', '#ef9a9a', '#e1f5fe', '#81d4fa', '#ffa726', '#ff7043', '#ffe082', '#f48fb1', '#ea80fc'][kind] || '#ffb74d';
				if (kind === 8) for (const c of ['#ff8a80', '#ffff8d', '#80d8ff', '#b9f6ca']) this.burst(x, y, c, 8, r * 0.4);
				this.burst(x, y, color, 18, r * 0.3);
				this.burst(x, y, '#fff3e0', 8, r * 0.15);
				this.rings.push({ x, y, t: 0, life: 0.35, r0: r * 0.3, r1: r, color, fill: true });
				if (Math.hypot(x - this.local.x, y - this.local.y) < 260) this.shake = Math.min(12, this.shake + (kind === 0 ? 3 : 6));
				break;
			}
			case 'bline':
				this.blines.push({ x1: +ev[1], y1: +ev[2], x2: +ev[3], y2: +ev[4], w: +ev[5] || 60, t: 0, life: Math.max(0.1, +ev[6] || 0.8) });
				break;
			case 'warn':
				this.warns.push({ x: +ev[1], y: +ev[2], r: +ev[3] || 60, t: 0, life: Math.max(0.1, +ev[4] || 0.5) });
				break;
			case 'frost': {
				// v28: a wave at a point (Ледяные силки: ['frost', pid, r, x, y]) instead of around the hero.
				if (ev.length >= 5) {
					this.rings.push({ x: +ev[3], y: +ev[4], t: 0, life: 0.45, r0: 10, r1: +ev[2] || 70, color: '#b3e5fc', frost: true });
					break;
				}
				const pt = this.playerPos(ev[1], { x: 0, y: 0 });
				if (pt) this.rings.push({ x: pt.x, y: pt.y, t: 0, life: 0.45, r0: 16, r1: +ev[2] || 110, color: '#b3e5fc', pid: ev[1], frost: true });
				break;
			}
			case 'apulse': {
				// v20 overclock «Пульс»: the aura beats as a ring in the hero's colour.
				const pt = this.playerPos(ev[1], { x: 0, y: 0 });
				if (pt) this.rings.push({ x: pt.x, y: pt.y, t: 0, life: 0.4, r0: 20, r1: +ev[2] || 140, color: this.meta(ev[1]).color, pid: ev[1], fill: true });
				break;
			}
			case 'ovr': {
				this.onEvent('ovr', ev[1], ev[2], ev[3]);
				const pt = this.playerPos(ev[1], { x: 0, y: 0 });
				if (pt) {
					this.rings.push({ x: pt.x, y: pt.y, t: 0, life: 0.6, r0: 10, r1: 170, color: '#b388ff', pid: ev[1] });
					this.burst(pt.x, pt.y, '#b388ff', 24, 12);
				}
				break;
			}
			case 'tslash':
				this.tslashes.push({ pid: ev[1], range: +ev[2] || 150, width: +ev[3] || 60, big: ev[4] === 1, t: 0, seed: Math.random() * 100 });
				break;
			case 'tfan': {
				this.fans.push({ pid: ev[1], r: +ev[2] || 200, t: 0 });
				const pt = this.playerPos(ev[1], { x: 0, y: 0 });
				if (pt && ev[1] === this.me) this.shake = Math.min(10, this.shake + 4);
				if (pt) this.burst(pt.x, pt.y, '#b3e5fc', 16, 10);
				break;
			}
			case 'evo': {
				const E = EVOS[ev[2]];
				this.onEvent('evo', ev[1], ev[2]);
				const pt = this.playerPos(ev[1], { x: 0, y: 0 });
				if (E && pt) {
					// Shock wave 0 → 250 px in 0.4 s and a burst in the weapon's colour.
					this.rings.push({ x: pt.x, y: pt.y, t: 0, life: 0.4, r0: 0, r1: 250, color: E.color, pid: ev[1], fill: true });
					this.rings.push({ x: pt.x, y: pt.y, t: 0, life: 0.9, r0: 20, r1: 160, color: '#ffd54f', pid: ev[1] });
					this.burst(pt.x, pt.y, E.color, 40, 18);
				}
				if (E && ev[1] === this.me) this.evoFlash = { color: E.color, t: 0 };
				break;
			}
			case 'cone':
				this.cones.push({ pid: ev[1], a: (+ev[2] || 0) / 100, range: +ev[3] || 200, half: ((+ev[4] || 25) * Math.PI) / 180, t: 0 });
				break;
			case 'crescent':
				this.crescents.push({ pid: ev[1], r: +ev[2] || 170, t: 0 });
				break;
			case 'react': {
				const kind = REACTION_IDS[ev[1] | 0];
				if (!kind) break;
				const x = +ev[2], y = +ev[3], r = +ev[4] || 0;
				this.reacts.push({ kind, x, y, r, t: 0, seed: Math.random() * 100 });
				if (kind === 'steam') this.steams.push({ x, y, r: r || REACT.steamR, t: 0, life: REACT.steamLife });
				const now = this.view.tm;
				if (!(this.labelAt[kind] > now - REACT_LABEL_EVERY)) {
					this.labelAt[kind] = now;
					this.labels.push({ kind, x, y: y - 18, t: 0 });
				}
				break;
			}
			case 'banner':
				this.banners = this.banners.filter((b) => b.pid !== ev[1]);
				this.banners.push({ pid: ev[1], x: +ev[2], y: +ev[3], life: +ev[4] || 6, r: +ev[5] || 200, t: 0 });
				break;
			case 'bell': {
				const pt = this.playerPos(ev[1], { x: 0, y: 0 });
				if (pt) this.rings.push({ x: pt.x, y: pt.y, t: 0, life: 0.5, r0: 20, r1: +ev[2] || 130, color: '#ffe082', pid: ev[1] });
				break;
			}
			case 'ward': {
				const pt = this.playerPos(ev[1], { x: 0, y: 0 });
				if (pt) this.rings.push({ x: pt.x, y: pt.y, t: 0, life: 0.3, r0: 18, r1: 34, color: '#ffe082', pid: ev[1] });
				break;
			}
			case 'shard':
				this.burst(+ev[1], +ev[2], '#e1f5fe', 10, 6);
				this.rings.push({ x: +ev[1], y: +ev[2], t: 0, life: 0.25, r0: 6, r1: 40, color: '#b3e5fc' });
				break;
			case 'duo':
				this.onEvent('duo', ev[1], ev[2]);
				if (DUOS[ev[2]]) {
					const pt = this.playerPos(ev[1], { x: 0, y: 0 });
					if (pt) {
						this.rings.push({ x: pt.x, y: pt.y, t: 0, life: 0.9, r0: 10, r1: 220, color: '#ffe082', pid: ev[1] });
						this.burst(pt.x, pt.y, '#ffe082', 30, 14);
					}
				}
				break;
			case 'snap':
				this.burst(+ev[1], +ev[2], '#bcaaa4', 8, 4);
				this.rings.push({ x: +ev[1], y: +ev[2], t: 0, life: 0.25, r0: 6, r1: 26, color: '#d7ccc8' });
				break;
			case 'brk':
				this.broken.add((ev[1] | 0) * 100003 + (ev[2] | 0));
				this.onEvent('brk', ev[1] | 0, ev[2] | 0);
				break;
			case 'item': {
				const type = ITEM_TYPES[ev[2] | 0];
				this.burst(+ev[3], +ev[4], type === 'rage' ? '#ff7043' : type === 'dew' ? '#80deea' : '#fff59d', 14, 6);
				this.onEvent('item', ev[1], type);
				break;
			}
			case 'open':
				this.burst(+ev[2], +ev[3], '#ffd54f', 26, 12);
				this.rings.push({ x: +ev[2], y: +ev[3], t: 0, life: 0.7, r0: 10, r1: 90, color: '#ffd54f' });
				break;
			case 'elite':
				this.onEvent('elite', ev[2] | 0);
				break;
			case 'blink':
				this.burst(+ev[1], +ev[2], '#b388ff', 12, 6);
				break;
			case 'peakw':
				if (PEAKS[ev[1]]) this.onEvent('peakw', PEAKS[ev[1]]);
				break;
			case 'evt':
				if (EVENTS[ev[1]]) {
					this.shake = Math.max(this.shake, 4);
					this.onEvent('evt', EVENTS[ev[1]], ev[2] | 0);
				}
				break;
			case 'evte':
				if (EVENTS[ev[1]]) this.onEvent('evte', EVENTS[ev[1]], ev[2] | 0);
				break;
			case 'altar':
				this.onEvent('altar', ev[1], ev[2] | 0);
				break;
			case 'peak':
				if (!PEAKS[ev[1]]) break;
				this.shake = Math.max(this.shake, 8);
				this.onEvent('peak', PEAKS[ev[1]]);
				break;
			case 'pring':
				this.rings.push({ x: +ev[1], y: +ev[2], t: 0, life: 1.6, r0: +ev[3] || 420, r1: 90, color: '#b388ff' });
				break;
			case 'dawn':
				if (this.hold > 0) this.dawnPending = ev[1] | 0;
				else this.startDawn(ev[1] | 0);
				break;
			case 'outposts':
				this.onEvent('outposts', ev[1], ev[2]);
				break;
			case 'finw':
				this.onEvent('finw');
				break;
			case 'fin':
				if ((ev[1] | 0) !== 4) this.shake = Math.max(this.shake, (ev[1] | 0) === 3 ? 14 : 8);
				this.onEvent('fin', ev[1] | 0, ev[2] | 0);
				break;
			case 'ray':
				this.evoFlash = { color: '#fff8e1', t: 0 };
				this.onEvent('ray', ev[1] | 0);
				break;
			case 'absorb': {
				// Dark threads from the horde to the middle of the ring (a sample of the enemies the client still shows).
				const pts = [];
				// The snapshot that carries the event already holds the Lord alone: take the last one with the horde in it.
				for (let i = this.snaps.length - 1; i >= 0 && !pts.length; i--) {
					const e = this.snaps[i].e;
					if (e.length <= E_STRIDE) continue;
					const step = Math.max(1, Math.ceil(e.length / E_STRIDE / 60)) * E_STRIDE;
					for (let j = 0; j + E_STRIDE <= e.length; j += step) pts.push(+e[j + 2], +e[j + 3]);
				}
				this.absorb = { t: 0, cx: +ev[2], cy: +ev[3], pts };
				this.shake = 16;
				this.onEvent('absorb', ev[1] | 0);
				break;
			}
			case 'lorddie': {
				const x = +ev[2], y = +ev[3];
				this.lordDie = { t: 0, x, y };
				this.hold = FINALE.killHold;
				this.shake = 0;
				this.evoFlash = { color: '#fff8e1', t: 0 };
				this.burst(x, y, '#fff8e1', 60, 30);
				this.burst(x, y, '#ffca28', 40, 22);
				this.rings.push({ x, y, t: 0, life: 1.2, r0: 20, r1: 420, color: '#ffe082' });
				this.onEvent('lorddie', ev[1]);
				break;
			}
			case 'inv': {
				const pt = this.playerPos(ev[1], { x: 0, y: 0 });
				if (pt) this.rings.push({ x: pt.x, y: pt.y, t: 0, life: 1.2, r0: +ev[2] || 430, r1: 120, color: '#ff5252', pid: ev[1] });
				if (ev[1] === this.me) this.onEvent('inv');
				break;
			}
		}
	}

	// Dawn: every enemy the client still shows goes up in golden fire. A Lord who lived to the dawn (no `lorddie`)
	// is not killed: he pales and falls apart into shades.
	startDawn(n) {
		this.dawn = { t: 0, n };
		this.shake = 18;
		const lord = ENEMY_TYPES.indexOf('boss');
		for (let i = this.snaps.length - 1; i >= 0; i--) {
			const e = this.snaps[i].e;
			if (!e.length) continue;
			for (let j = 0; j + E_STRIDE <= e.length; j += E_STRIDE) {
				if (e[j + 1] === lord && !this.lordDie) {
					this.burst(+e[j + 2], +e[j + 3], '#4a148c', 40, 26);
					this.burst(+e[j + 2], +e[j + 3], '#b39ddb', 20, 18);
				} else this.burst(+e[j + 2], +e[j + 3], j % 3 ? '#ffca28' : '#fff8e1', 3, 6);
			}
			break;
		}
		this.onEvent('dawn', this.lordDie ? 2 : 1);
	}

	burst(x, y, color, n, spread) {
		for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
			const a = Math.random() * Math.PI * 2;
			const s = 40 + Math.random() * (80 + spread * 4);
			this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.35 + Math.random() * 0.35, color, size: 2 + Math.random() * 3 });
		}
	}

	updateEffects(dt) {
		compact(this.hordeFx, (fx) => (fx.t += dt) < fx.life);
		this.shake = Math.max(0, this.shake - dt * 40);
		this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
		if (this.dawn) this.dawn.t += dt;
		if (this.absorb && (this.absorb.t += dt) > 0.8) this.absorb = null;
		if (this.lordDie) this.lordDie.t += dt;
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
		compact(this.coldWaves, (w) => (w.t += dt) < w.life);
		const advanceWarning = (w) => {
			w.t = w.serverStart === undefined ? w.t + dt : Math.max(0, this.hordeTime() - w.serverStart);
			return w.t < w.life;
		};
		compact(this.warns, advanceWarning);
		compact(this.blines, advanceWarning);
		compact(this.iceTrail, (p) => (p.t += dt) < ICE_TRAIL_LIFE);
		compact(this.tslashes, (s) => (s.t += dt) < 0.32);
		compact(this.fans, (f) => (f.t += dt) < 0.45);
		compact(this.cones, (c) => (c.t += dt) < 0.45);
		compact(this.crescents, (c) => (c.t += dt) < 0.3);
		compact(this.reacts, (c) => (c.t += dt) < REACT_LIFE);
		compact(this.labels, (c) => (c.t += dt) < REACT_LABEL_LIFE);
		compact(this.steams, (c) => (c.t += dt) < c.life);
		compact(this.banners, (b) => (b.t += dt) < b.life);
		if (this.evoFlash && (this.evoFlash.t += dt) > 0.12) this.evoFlash = null;
		if (this.zk.size > 256 && this.view.b) {
			const live = new Set();
			const z = this.view.b.z;
			for (let i = 0; i + 4 <= z.length; i += 4) live.add(z[i]);
			for (const id of this.zk.keys()) if (!live.has(id)) this.zk.delete(id);
		}
		if (this.eliteAffix.size > 64 && this.view.b) {
			for (const id of this.eliteAffix.keys()) if (!this.view.b.eIdx.has(id)) this.eliteAffix.delete(id);
		}
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
	if (Math.abs(bx - ax) + Math.abs(by - ay) > Math.max(TELEPORT_DIST, TELEPORT_SPEED * (b.tm - a.tm))) {
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
