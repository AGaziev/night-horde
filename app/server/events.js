// Wave 4 random events (content.js EVENTS): one at a time for the whole group, announced with a banner and a hint.
// The room calls tick() every tick and the hooks below; the active event goes to clients as snapshot `ev`.
import {
	EVENTS, EVENT_RULES, EVENT_INDEX, ALTAR_DEALS, STAR_SHARD, ENEMIES, ELITE_AFFIXES, xpForNext, enemyHpScale, enemyDmgScale,
	spawnRateScale, CHEST_FLOOR,
} from '../public/shared/content.js';

const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const round3 = (v) => Math.round(v * 1000) / 1000;
const r1 = (v) => Math.round(v * 10) / 10;
const KILL_WINDOW = 60; // seconds of kills behind the streak goal
const STAR = EVENTS[EVENT_INDEX.star], GOLD = EVENTS[EVENT_INDEX.gold], FOG = EVENTS[EVENT_INDEX.fog];
const ALTAR = EVENTS[EVENT_INDEX.altar], CURSED = EVENTS[EVENT_INDEX.cursed], STREAK = EVENTS[EVENT_INDEX.streak];
export const EPIC = CHEST_FLOOR.boss; // «не ниже эпической»

export class Events {
	constructor(room) {
		this.room = room;
		this.cur = null;
		this.last = -1;
		this.next = room.runLength * EVENT_RULES.from;
		this.kills = []; // [time, kills] once per second for the streak goal
		this.force = null; // tests: id of the next event
	}

	get active() {
		return this.cur;
	}

	tick(alive) {
		const room = this.room, t = room.time;
		if (!this.kills.length || t - this.kills[this.kills.length - 1][0] >= 1) {
			this.kills.push([t, room.kills]);
			while (this.kills.length && this.kills[0][0] < t - KILL_WINDOW) this.kills.shift();
		}
		if (this.cur) {
			this.step(alive);
			return;
		}
		if (t < this.next || !alive.length) return;
		if (!this.force && this.blocked()) {
			this.next = t + EVENT_RULES.retry;
			return;
		}
		this.begin(this.pick(), alive);
	}

	// Not during a peak (with its warning) nor around a boss spawn.
	blocked() {
		const room = this.room, t = room.time;
		if (room.peaks.some((p) => t >= p.at - EVENT_RULES.peakGap - 4 && t < p.at + p.dur + 2)) return true;
		if (room.bossAt.some((b) => Math.abs(t - b) < EVENT_RULES.bossGap || (b > t && b - t < 30))) return true;
		return t > room.runLength - 45;
	}

	pick() {
		if (this.force) {
			const id = this.force;
			this.force = null;
			return EVENT_INDEX[id];
		}
		let i;
		do i = Math.floor(Math.random() * EVENTS.length); while (i === this.last && EVENTS.length > 1);
		return i;
	}

	center(alive) {
		return [alive.reduce((s, h) => s + h.x, 0) / alive.length, alive.reduce((s, h) => s + h.y, 0) / alive.length];
	}

	// A point `d` px from the group in a random direction.
	spot(alive, d) {
		const [cx, cy] = this.center(alive);
		const a = Math.random() * Math.PI * 2;
		return [cx + Math.cos(a) * d, cy + Math.sin(a) * d];
	}

	begin(i, alive) {
		const room = this.room, D = EVENTS[i], t = room.time;
		const ev = { i, id: D.id, at: t, end: t + 30, phase: 0, x: 0, y: 0, r: 0, a: 0, b: 0, log: { id: D.id, name: D.name, at: r1(t), end: null, res: null } };
		this.cur = ev;
		this.last = i;
		switch (D.id) {
			case 'star': {
				const h = alive[Math.floor(Math.random() * alive.length)];
				const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 90;
				[ev.x, ev.y, ev.r] = [h.x + Math.cos(a) * d, h.y + Math.sin(a) * d, STAR.r];
				ev.end = t + STAR.warn;
				room.fx.push(['warn', Math.round(ev.x), Math.round(ev.y), ev.r, round3(STAR.warn)]);
				break;
			}
			case 'gold': {
				const h = alive[Math.floor(Math.random() * alive.length)];
				const a = Math.random() * Math.PI * 2;
				const e = room.spawnEnemy('goldshade', alive, enemyHpScale(room.nt, room.heroes.size));
				e.x = h.x + Math.cos(a) * GOLD.dist;
				e.y = h.y + Math.sin(a) * GOLD.dist;
				ev.shade = e;
				ev.end = t + ENEMIES.goldshade.life;
				[ev.x, ev.y] = [e.x, e.y];
				break;
			}
			case 'fog':
				[ev.x, ev.y] = this.center(alive);
				ev.r = FOG.r;
				ev.end = t + FOG.dur;
				ev.log.kills = 0;
				break;
			case 'altar':
				[ev.x, ev.y] = this.spot(alive, ALTAR.dist);
				ev.r = ALTAR.r;
				ev.a = Math.floor(Math.random() * ALTAR_DEALS.length);
				ev.end = t + ALTAR.life;
				ev.took = new Set();
				ev.log.deal = ALTAR_DEALS[ev.a].id;
				ev.log.took = [];
				break;
			case 'cursed':
				[ev.x, ev.y] = this.spot(alive, CURSED.dist);
				ev.r = CURSED.r;
				ev.end = t + CURSED.life;
				break;
			case 'streak': {
				const k0 = this.kills[0];
				const rate = k0 && t - k0[0] >= 10 ? (room.kills - k0[1]) / (t - k0[0]) : 0;
				ev.b = Math.max(STREAK.min, Math.round(rate * STREAK.dur * STREAK.pace));
				ev.k0 = room.kills;
				ev.end = t + STREAK.dur;
				ev.log.goal = ev.b;
				break;
			}
		}
		room.fx.push(['evt', i, ev.b]);
	}

	finish(res) {
		const ev = this.cur, room = this.room;
		ev.log.end = r1(room.time);
		ev.log.res = res;
		room.fx.push(['evte', ev.i, res]);
		room.runLog?.event(room, ev.log);
		this.cur = null;
		this.next = room.time + EVENT_RULES.gap[0] + Math.random() * (EVENT_RULES.gap[1] - EVENT_RULES.gap[0]);
	}

	step(alive) {
		const ev = this.cur, room = this.room, t = room.time;
		switch (ev.id) {
			case 'star':
				if (ev.phase === 0 && t >= ev.end) this.starFall(ev);
				else if (ev.phase === 1 && (t >= ev.end || !room.items.includes(ev.item))) this.finish(room.items.includes(ev.item) ? 0 : 1);
				return;
			case 'gold': {
				const e = ev.shade;
				[ev.x, ev.y] = [e.x, e.y];
				if (e.dead) return this.finish(e.caught ? 1 : 0);
				let near = Infinity;
				for (const h of alive) near = Math.min(near, dist2(h.x, h.y, e.x, e.y));
				if (t >= ev.end || near > ENEMIES.goldshade.escape ** 2) {
					e.dead = true;
					room.fx.push(['blink', Math.round(e.x), Math.round(e.y)]);
					this.finish(0);
				}
				return;
			}
			case 'fog':
				if (t >= ev.end) this.finish(0);
				return;
			case 'altar':
				for (const h of alive) {
					if (ev.took.has(h.pid) || dist2(h.x, h.y, ev.x, ev.y) > (ev.r + 14) ** 2) continue;
					ev.took.add(h.pid);
					this.deal(h, ALTAR_DEALS[ev.a]);
					ev.log.took.push(h.name);
				}
				if (t >= ev.end || ev.took.size >= room.heroes.size) this.finish(ev.took.size ? 1 : 0);
				return;
			case 'cursed':
				if (ev.phase === 0) {
					const h = alive.find((o) => dist2(o.x, o.y, ev.x, ev.y) < (ev.r + 14) ** 2);
					if (h) this.openCursed(ev, h, alive);
					else if (t >= ev.end) this.finish(0);
				} else if (t >= ev.end) {
					const ok = alive.filter((h) => !ev.downed.has(h.pid));
					for (const h of ok) room.grantOffer(h, true, EPIC);
					if (ok.length) room.fx.push(['open', -1, Math.round(ev.x), Math.round(ev.y)]);
					ev.log.rewarded = ok.length;
					this.finish(ok.length ? 1 : 2);
				}
				return;
			case 'streak':
				ev.a = room.kills - ev.k0;
				if (ev.a >= ev.b) {
					const B = STREAK.bonus;
					for (const h of alive) h.streakT = t + B.dur;
					for (const g of room.gems) {
						let best = null, bd = Infinity;
						for (const h of alive) {
							const d = dist2(g.x, g.y, h.x, h.y);
							if (d < bd) [best, bd] = [h, d];
						}
						g.pull = best;
					}
					ev.log.kills = ev.a;
					this.finish(1);
				} else if (t >= ev.end) {
					ev.log.kills = ev.a;
					this.finish(0);
				}
		}
	}

	starFall(ev) {
		const room = this.room;
		ev.phase = 1;
		room.fx.push(['boom', Math.round(ev.x), Math.round(ev.y), ev.r, 3]);
		let hit = 0;
		for (const e of room.enemies) {
			if (e.dead || dist2(e.x, e.y, ev.x, ev.y) >= (ev.r + e.r * 0.5) ** 2) continue;
			hit++;
			const big = e.boss || e.elite || e.def.special;
			room.hurtEnemy(e, big ? e.maxHp * STAR.bigFrac : e.hp + 1, null, room.SRC_STAR);
		}
		const pdmg = STAR.pdmg * enemyDmgScale(room.nt, room.heroes.size);
		let hurt = 0;
		for (const h of room.heroes.values()) {
			if (h.st !== 0 || dist2(h.x, h.y, ev.x, ev.y) >= (ev.r + 14) ** 2) continue;
			hurt++;
			if (h.iframes <= 0) room.hurtPlayer(h, pdmg, 'event:star');
		}
		ev.item = room.dropItem('star', ev.x, ev.y);
		ev.end = room.time + 40;
		ev.r = 24;
		Object.assign(ev.log, { hit, hurt });
	}

	deal(h, D) {
		const room = this.room, t = room.time;
		if (D.hpCost) {
			h.hp = Math.max(1, h.hp * (1 - D.hpCost));
			room.runLog?.hpDrop(h);
		}
		if (D.dmgMul) h.altarDmgT = t + D.dur;
		if (D.takenMul) h.altarCurseT = t + D.dur;
		if (D.xpMul) h.altarXpT = t + D.dur;
		h.altarDeal = D;
		room.fx.push(['altar', h.pid, ALTAR_DEALS.indexOf(D)]);
	}

	openCursed(ev, h, alive) {
		const room = this.room;
		ev.phase = 1;
		ev.end = room.time + CURSED.hold;
		ev.downed = new Set();
		[ev.x, ev.y] = [h.x, h.y];
		ev.r = CURSED.ring;
		const wave = room.currentWave();
		const count = Math.round((CURSED.base + CURSED.perMin * room.nt / 60) * spawnRateScale(room.heroes.size));
		const hpMul = enemyHpScale(room.nt, room.heroes.size);
		room.fx.push(['open', h.pid, Math.round(h.x), Math.round(h.y)]);
		room.fx.push(['pring', Math.round(h.x), Math.round(h.y), CURSED.ring]);
		let n = 0;
		for (let i = 0; i < count && room.enemies.length < 420; i++) {
			const e = room.spawnEnemy(room.waveType(wave), alive, hpMul);
			const a = (i / count) * Math.PI * 2;
			e.x = h.x + Math.cos(a) * CURSED.ring;
			e.y = h.y + Math.sin(a) * CURSED.ring;
			n++;
			if (i === 0) room.setElite(e, ELITE_AFFIXES[Math.floor(Math.random() * ELITE_AFFIXES.length)].id);
		}
		Object.assign(ev.log, { opened: r1(room.time), by: h.name, wave: n });
	}

	// --- hooks from the room ---

	inFog(e) {
		const ev = this.cur;
		return ev !== null && ev.id === 'fog' && dist2(e.x, e.y, ev.x, ev.y) < ev.r * ev.r;
	}

	onKill(e, h) {
		const ev = this.cur;
		if (!ev) return;
		if (ev.id === 'gold' && e === ev.shade && h) {
			e.caught = true;
			this.room.dropItem('chest', e.x, e.y);
		}
		if (ev.id === 'fog' && this.inFog(e)) ev.log.kills++;
	}

	onDown(h) {
		if (this.cur?.id === 'cursed' && this.cur.phase === 1) this.cur.downed.add(h.pid);
	}

	// The star shard is shared: every alive player gets half a level and some health.
	starShard() {
		const room = this.room;
		for (const o of room.heroes.values()) {
			if (o.st !== 0) continue;
			room.addXp(o, xpForNext(o.level, room.heroes.size) * STAR_SHARD.lvlFrac);
			o.hp = Math.min(o.maxHp, o.hp + STAR_SHARD.heal);
		}
	}

	// [index, seconds left, phase, x, y, r, a, b]
	snap() {
		const ev = this.cur;
		if (!ev) return null;
		return [ev.i, Math.max(0, Math.round((ev.end - this.room.time) * 10) / 10), ev.phase, Math.round(ev.x), Math.round(ev.y), Math.round(ev.r), ev.a, ev.b];
	}
}

export const STREAK_MUL = STREAK.bonus.mul;
export const FOG_DEF = FOG;
