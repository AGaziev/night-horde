// Run telemetry: compact per-run log for player feedback, plus an in-memory store of recent runs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
	GAME_VERSION, HEROES, ENEMIES, ENEMY_TYPES, weaponDef, enemyHpScale, enemyDmgScale, REACTIONS, RARITIES, modeOf,
	SPECIALS, EVENTS, EVENT_INDEX, ALTAR_DEALS, MAX_WEAPONS, MAX_PASSIVES, OVERCLOCKS, WEAPONS, PASSIVES,
} from '../public/shared/content.js';

export const RUN_ID_RE = /^[A-Z0-9]{6}$/;
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_JSON = 28 * 1024;
const KEEP_RUNS = 30;
const LAST_HITS = 10; // seconds of hits kept to explain a down
const CROWD_R = 300; // enemies within this radius are counted at a down
const SHOOT_R = 600; // ranged enemies within this radius are counted at a down
const SHOOTERS = new Set(ENEMY_TYPES.flatMap((t, i) => (ENEMIES[t]?.shotDmg ? [i] : [])));
const BOSS_NEAR = 400; // a boss is «near» while an alive player is this close

const r1 = (v) => Math.round(v * 10) / 10;
const SRC_NAMES = {
	perk_witch: 'Эхо атаки', perk_ranger: 'Бросок на ходу', perk_smith: 'Удар молота',
	perk_stormcaller: 'Разряд', perk_alchemist: 'Осадок', perk_spearmaiden: 'Прокол',
	burn: 'Поджог', blast: 'Взрывы', cracker: 'Хлопушки', star: 'Падающая звезда', other: 'Прочее' };
const SPECIAL_IDS = Object.keys(SPECIALS);
const PASSIVE_OR_WEAPON = (id) => weaponDef(id)?.name ?? PASSIVES[id]?.name ?? id;
export const srcName = (id) => SRC_NAMES[id] ?? (id.startsWith('r_') && REACTIONS[id.slice(2)] ? `Реакция «${REACTIONS[id.slice(2)].name}»` : null) ?? weaponDef(id)?.name ?? id;
const enemyName = (key) => {
	const [type, how] = key.split(':');
	if (type === 'event') return EVENTS[EVENT_INDEX[how]]?.name ?? how;
	const base = type === 'elite' ? 'Элита' : ENEMIES[type]?.name ?? type;
	return how === 'shot' ? `${base} (выстрел)` : how === 'blast' ? `${base} (взрыв)` : how === 'dash' ? `${base} (рывок)` : how === 'wave' ? `${base} (волна)` : base;
};
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
export const newRunId = () => Array.from(crypto.randomBytes(6), (b) => ID_CHARS[b % ID_CHARS.length]).join('');
export const enemyKey = (e) => ENEMY_TYPES[e.type] ?? 'enemy';
// Card rarity counters per player: offered on screen and taken, index = rarity.
const newRar = () => ({ seen: [0, 0, 0, 0], took: [0, 0, 0, 0] });
// v21 finale: what hit a player during the fight with the Lord — his wave, shots, charge, touch, or the packs.
const FIN_CLOSE = 250, FIN_WALL = 40;
const finSrc = (from) => (from === 'boss:wave' ? 'wave' : from === 'boss:shot' ? 'shot' : from === 'boss:dash' ? 'dash' : from === 'boss' ? 'contact' : 'adds');
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));

export class RunLog {
	constructor(room) {
		this.id = newRunId();
		this.startedAt = Date.now();
		this.minutes = [];
		this.nextSample = 60;
		this.acc = { taken: 0, downs: 0, kills: 0, dealt: 0 };
		this.p = new Map();
		this.bosses = [];
		this.peaks = [];
		this.events = [];
		this.left = []; // [time, players before, after]
		this.fin = null; // v21 finale section, see finStart()
		// v18 specials: spawned / killed / shots fired, damage blocked by the shield; damage to players comes from `taken`.
		this.specials = Object.fromEntries(SPECIAL_IDS.map((id) => [id, { spawned: 0, killed: 0, shots: 0, blocked: 0, first: null }]));
		for (const h of room.heroes.values()) {
			this.p.set(h.pid, {
				pid: h.pid, name: h.name, hero: h.hero, picks: [], duos: [], evos: [], taken: {}, downs: [], ups: [],
				minHp: h.maxHp, minHpT: 0, rar: newRar(),
				// v15: per-minute hp [end, min, max] and weapon dps, recent hits, down details, declined new weapons.
				hpMin: [], minuteMin: h.hp, dps: [], lastDmgBy: {}, hits: [], deaths: [], declinedW: 0, declinedLonely: 0, drops: [],
				// v20: overclock offers (per weapon, both variants count once) / taken, banished cards, when the 6 + 4 slots filled up.
				ovr: { seen: 0, took: [] }, bans: [], slotsFullT: null,
			});
		}
	}

	tick(room) {
		const dt = room.time - (this.lastT ?? room.time);
		this.lastT = room.time;
		if (dt > 0) for (const e of room.bosses ?? []) {
			const b = this.bosses.find((x) => x.group === e.group);
			if (!b || b.killedAt !== null || b.nearMark === room.time) continue;
			for (const h of room.heroes.values()) {
				if (h.st === 0 && (h.x - e.x) ** 2 + (h.y - e.y) ** 2 < BOSS_NEAR * BOSS_NEAR) {
					b.near += dt;
					b.nearMark = room.time; // twin halves count once per tick
					break;
				}
			}
		}
		const F = this.fin;
		if (F?.lord && dt > 0) {
			const f = room.fin, L = f.lord;
			let n = 0;
			for (const e of room.enemies) if (!e.dead) n++;
			if (n > F.load.enemiesMax) F.load.enemiesMax = n;
			for (const h of room.heroes.values()) {
				if (h.st !== 0) continue;
				if (!L.dead && (h.x - L.x) ** 2 + (h.y - L.y) ** 2 < FIN_CLOSE * FIN_CLOSE) F.close[h.name] = (F.close[h.name] ?? 0) + dt;
				if (Math.hypot(h.x - f.cx, h.y - f.cy) > f.r - FIN_WALL) F.wall[h.name] = (F.wall[h.name] ?? 0) + dt;
			}
		}
		if (room.time < this.nextSample) return;
		this.sample(room);
		this.nextSample += 60;
	}

	sample(room) {
		const heroes = [...room.heroes.values()];
		const dealt = heroes.reduce((s, h) => s + h.dmg, 0);
		const alive = heroes.filter((h) => h.st === 0).length;
		this.minutes.push({
			m: this.minutes.length + 1, enemies: room.enemies.length, hpMul: r1(enemyHpScale(room.nt ?? room.time, room.heroes.size)),
			dmgMul: Math.round(enemyDmgScale(room.nt ?? room.time, room.heroes.size) * 100) / 100, alive, lvl: heroes.map((h) => h.level),
			taken: Math.round(this.acc.taken), downs: this.acc.downs, kills: room.kills - this.acc.kills,
			dps: Math.round((dealt - this.acc.dealt) / 60), maxHp: Math.round(heroes.reduce((s, h) => s + h.maxHp, 0) / heroes.length),
		});
		this.acc = { taken: 0, downs: 0, kills: room.kills, dealt };
		for (const h of heroes) {
			const p = this.p.get(h.pid);
			if (!p) continue;
			p.hpMin.push([Math.round(h.hp), Math.round(Math.max(0, p.minuteMin)), h.maxHp]);
			p.minuteMin = h.hp;
			const row = {};
			for (const [id, v] of Object.entries(h.dmgBy)) {
				const d = Math.round((v - (p.lastDmgBy[id] ?? 0)) / 60);
				if (d >= 1) row[id] = d;
			}
			p.dps.push(row);
			p.lastDmgBy = { ...h.dmgBy };
		}
	}

	// act: 'pick' | 'skip' | 'reroll' | 'ban'; offer: the cards that were on screen. Overclock cards are `weapon~variant`.
	choice(room, h, act, card, offer) {
		const p = this.p.get(h.pid);
		if (!p) return;
		const cid = (c) => (c.kind === 'ovr' ? `${c.id}~${c.v}` : c.id);
		const of = (offer ?? []).map((c) => (c.level > 1 ? `${c.id}${c.level}` : cid(c)) + (c.rar > 0 ? `*${c.rar}` : '')).join(',');
		p.ovr.seen += new Set((offer ?? []).filter((c) => c.kind === 'ovr').map((c) => c.id)).size;
		if (act === 'pick' && card?.kind === 'ovr') p.ovr.took.push([r1(room.time), cid(card)]);
		if (act === 'ban' && card) p.bans.push([r1(room.time), cid(card)]);
		for (const c of offer ?? []) if (c.rar !== undefined) p.rar.seen[c.rar]++;
		if (card?.rar !== undefined) p.rar.took[card.rar]++;
		const newW = (offer ?? []).some((c) => c.kind === 'weapon' && (c.from ?? c.level - 1) === 0);
		if (newW && act !== 'reroll' && !(card?.kind === 'weapon' && (card.from ?? card.level - 1) === 0)) {
			p.declinedW++;
			if (h.weapons.size < 2) p.declinedLonely++;
		}
		const e = [r1(room.time), h.level, act];
		if (card) e.push(cid(card), card.kind, card.level, card.rar ?? null);
		if (of) e.push(of);
		p.picks.push(e);
	}

	// After a pick is applied: the moment all weapon and artifact slots are taken for the first time.
	picked(room, h) {
		const p = this.p.get(h.pid);
		if (p && p.slotsFullT === null && h.weapons.size >= MAX_WEAPONS && h.passives.size >= MAX_PASSIVES) p.slotsFullT = r1(room.time);
	}

	fused(room, h, kind, id) {
		this.p.get(h.pid)?.[kind === 'evo' ? 'evos' : 'duos'].push([r1(room.time), id]);
	}

	hurt(room, h, amount, from) {
		const p = this.p.get(h.pid);
		if (!p || amount <= 0) return;
		this.acc.taken += amount;
		p.taken[from] = (p.taken[from] ?? 0) + amount;
		p.hits.push([room.time, from, amount]);
		while (p.hits.length && p.hits[0][0] < room.time - LAST_HITS) p.hits.shift();
		if (h.hp < p.minuteMin) p.minuteMin = h.hp;
		if (h.hp > 0 && h.hp < p.minHp) {
			p.minHp = h.hp;
			p.minHpT = room.time;
		}
		if (this.fin?.lord) this.fin.taken[finSrc(from)] += amount;
		if (h.hp <= 0) this.down(room, h, from);
	}

	// --- v21 finale: prelude, the fight, rage, packs, tick time ---
	finStart(room) {
		this.fin = {
			pre: r1(room.time), at: null, fight: room.finPlan?.fight ?? 0, ring: [room.fin.cx, room.fin.cy, room.fin.r1], players: room.heroes.size,
			lord: null, lordHp: 0, absorbed: 0, rageAt: null, rayAt: null, revived: 0, close: {}, wall: {},
			taken: { wave: 0, shot: 0, dash: 0, contact: 0, adds: 0 }, downs: {}, downsBy: { wave: 0, shot: 0, dash: 0, contact: 0, adds: 0, offline: 0 },
			adds: { pulses: 0, spawned: 0, killed: 0 }, load: { enemiesMax: 0, tickMs: 0, tickAvg: 0, ticks: 0 },
		};
	}

	finFight(room, lord, absorbed) {
		const F = this.fin;
		if (!F) return;
		F.at = r1(room.time);
		F.lord = lord;
		F.lordHp = Math.round(lord.maxHp);
		F.absorbed = absorbed;
		F.players = room.heroes.size;
	}

	finRage(room) {
		if (this.fin?.lord) this.fin.rageAt = r1(room.time - room.fin.fightAt);
	}

	// v23: the ray of dawn — second of the fight and heroes lifted.
	finRay(room, revived) {
		if (!this.fin?.lord) return;
		this.fin.rayAt = r1(room.time - room.fin.fightAt);
		this.fin.revived = revived;
	}

	finAdds(n) {
		if (!this.fin) return;
		this.fin.adds.pulses++;
		this.fin.adds.spawned += n;
	}

	finAddKilled() {
		if (this.fin) this.fin.adds.killed++;
	}

	finTick(ms) {
		const L = this.fin?.load;
		if (!L) return;
		if (ms > L.tickMs) L.tickMs = ms;
		L.tickAvg += ms;
		L.ticks++;
	}

	bossAbsorbed(room, e) {
		const b = this.bosses.find((x) => x.group === e.group);
		if (b && b.killedAt === null) b.absorbed = true;
	}

	// A down: by a hit (from hurt) or without one (v19: dropped connection, from = 'offline').
	down(room, h, from) {
		const p = this.p.get(h.pid);
		if (!p) return;
		this.acc.downs++;
		p.downs.push([r1(room.time), from]);
		const last = {};
		for (const [, k, v] of p.hits) last[k] = (last[k] ?? 0) + v;
		let crowd = 0, shooters = 0;
		for (const e of room.enemies) {
			if (e.dead) continue;
			const d2 = (e.x - h.x) ** 2 + (e.y - h.y) ** 2;
			if (d2 < CROWD_R * CROWD_R) crowd++;
			if (d2 < SHOOT_R * SHOOT_R && SHOOTERS.has(e.type)) shooters++;
		}
		p.deaths.push({
			t: r1(room.time), from, crowd, shooters, peak: room.peak?.name ?? null, lvl: h.level, maxHp: h.maxHp,
			last10: Object.fromEntries(Object.entries(last).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)])),
			weapons: [...h.weapons].map(([id, w]) => `${id}${w.lvl}`),
		});
		const pk = this.peaks[this.peaks.length - 1];
		if (pk && pk.end === null) pk.downs++;
		const kind = from.split(':')[0];
		if (this.fin?.lord) {
			this.fin.downs[h.name] = (this.fin.downs[h.name] ?? 0) + 1;
			this.fin.downsBy[from === 'offline' ? 'offline' : finSrc(from)]++;
		}
		for (const b of this.bosses) {
			if (b.killedAt !== null || b.absorbed) continue;
			b.downs[h.name] = (b.downs[h.name] ?? 0) + 1;
			if (kind === b.type || (b.type === 'twin' && kind === 'twinhalf')) b.downsByBoss++;
		}
	}

	bossSpawn(room, e) {
		this.bosses.push({ type: enemyKey(e), name: e.def.name, group: e.group, at: r1(room.time), hp: Math.round(e.maxHp), killedAt: null, sec: null, downs: {}, downsByBoss: 0, dmg: 0, near: 0, by: {} });
	}

	// Damage players dealt to a boss (both twin halves count to the same boss), per player name.
	bossHit(room, e, dmg, h) {
		const b = this.bosses.find((x) => x.group === e.group);
		if (!b || b.killedAt !== null || dmg <= 0) return;
		b.dmg += dmg;
		if (h) b.by[h.name] = (b.by[h.name] ?? 0) + dmg;
	}

	bossKilled(room, e) {
		const b = this.bosses.find((x) => x.group === e.group);
		if (!b || b.killedAt !== null) return;
		b.killedAt = r1(room.time);
		b.sec = r1(room.time - b.at);
	}

	// Peaks: start, end and counters (spawned ring, burned at dawn); downs land on the active peak.
	peakStart(room, def) {
		this.peaks.push({ id: def.id, name: def.name, at: r1(room.time), end: null, downs: 0 });
	}

	peakEnd(room, def) {
		const p = this.peaks.find((x) => x.id === def.id && x.end === null);
		if (p) p.end = r1(room.time);
	}

	peakNote(room, key, n) {
		const p = this.peaks[this.peaks.length - 1];
		if (p) p[key] = (p[key] ?? 0) + n;
	}

	// Health lost outside hurt() (the altar's price) still counts for the minute's minimum.
	hpDrop(h) {
		const p = this.p.get(h.pid);
		if (p && h.hp < p.minuteMin) p.minuteMin = h.hp;
	}

	// v19: connection drops and returns mid-run ([from, back|null] per player), group size changes when a player leaves.
	offline(room, h, off) {
		const p = this.p.get(h.pid);
		if (!p) return;
		if (off) p.drops.push([r1(room.time), null]);
		else if (p.drops.length && p.drops[p.drops.length - 1][1] === null) p.drops[p.drops.length - 1][1] = r1(room.time);
	}

	groupChange(room, from, to) {
		this.left.push([r1(room.time), from, to]);
	}

	special(room, e, key, n = 1) {
		const S = this.specials[enemyKey(e)];
		if (!S) return;
		S[key] += n;
		if (key === 'spawned' && S.first === null) S.first = r1(room.time);
	}

	// One finished Wave 4 event: {id, name, at, end, res, ...details}; res indexes EVENTS[i].done.
	event(room, ev) {
		this.events.push(ev);
	}

	up(room, h) {
		this.p.get(h.pid)?.ups.push(r1(room.time));
	}

	// v23 results card (`over.card`): what the results screen and the shared card show, names resolved, small.
	card(room, log) {
		if (!log) return null;
		const heroes = new Map([...room.heroes.values()].map((h) => [h.pid, h]));
		const lordBy = log.finale?.by ?? {};
		const players = log.team.map((t) => {
			const h = heroes.get(t.pid), p = this.p.get(t.pid);
			const embers = Object.values(t.build?.embers ?? {}).reduce((s, n) => s + n, 0);
			const takenTop = Object.entries(t.taken).slice(0, 3).map(([k, v]) => [enemyName(k), v]);
			const hit = h?.bestHit ?? [0, null, 0];
			return {
				pid: t.pid, name: t.name, hero: t.hero, heroName: t.heroName, level: t.level, kills: t.kills, dmg: t.dmg, maxHp: t.maxHp,
				weapons: t.dmgBy.slice(0, 8).map((d) => [d.name, d.dmg, d.pct]),
				taken: t.takenTotal, takenTop, revives: t.ach?.revives ?? 0,
				// Downs by enemies (a dropped connection is counted apart), when they fell and when allies lifted them.
				downs: t.downs.filter((d) => d[1] !== 'offline').length, downsAt: t.downs.filter((d) => d[1] !== 'offline').map((d) => Math.round(d[0])),
				lifted: t.ups.length, liftedAt: t.ups.map((x) => Math.round(x)), drops: t.drops?.length ?? 0,
				state: h?.offline ? 'offline' : h?.st === 0 ? 'alive' : 'down', minHp: t.minHp,
				bestHit: hit[0] > 0 ? [Math.round(hit[0]), srcName(hit[1] ?? 'other'), r1(hit[2])] : null,
				streak: h && h.bestStreak[0] > 0 ? [h.bestStreak[0], r1(h.bestStreak[1])] : null,
				fused: [...t.evos.map(([at, id]) => [at, weaponDef(id)?.name ?? id, 'evo']), ...t.duos.map(([at, id]) => [at, weaponDef(id)?.name ?? id, 'duo'])].sort((a, b) => a[0] - b[0]),
				ovr: (t.ovr?.took ?? []).map(([at, s]) => { const [id, v] = s.split('~'); return [at, `${WEAPONS[id]?.name ?? id} — «${OVERCLOCKS[id]?.[v - 1]?.name ?? v}»`]; }),
				embers,
				// Per minute: damage per second (all weapons) and the lowest hp of the minute.
				dpm: (p?.dps ?? []).map((row) => Object.entries(row).reduce((s, [k, v]) => s + (k.startsWith('r_') ? 0 : v), 0)),
				hpm: (p?.hpMin ?? []).map((x) => x[1]),
				lord: Math.round(lordBy[t.name] ?? 0),
			};
		});
		const top = players.flatMap((p) => p.weapons.slice(0, 1).map((w) => ({ name: p.name, weapon: w[0], dmg: w[1], pct: w[2] }))).sort((a, b) => b.dmg - a.dmg)[0] ?? null;
		const F = log.finale;
		return {
			id: log.id, v: log.v, mode: log.mode, len: log.runLength, time: log.time, win: log.win, grade: log.grade, kills: log.kills,
			players, top, awards: awards(players, log),
			group: { downs: players.reduce((s, p) => s + p.downs, 0), lifted: players.reduce((s, p) => s + p.lifted, 0), revives: players.reduce((s, p) => s + p.revives, 0) },
			fin: F && F.at !== null ? { at: F.at, lordHp: F.lordHp, sec: F.sec, hpLeft: F.hpLeft, grade: F.grade, lastHit: F.lastHit, rageAt: F.rageAt, rayAt: F.rayAt ?? null, revived: F.revived } : null,
			bosses: (log.bosses ?? []).map((b) => [b.name, b.at, b.sec, !!b.absorbed]),
			// [name, at, outcome, ok]: ok is null for single-outcome events (fog), else res 1 is the good one.
			events: (log.events ?? []).map((e) => {
				const D = EVENTS[EVENT_INDEX[e.id]];
				return [D?.name ?? e.id, e.at, D?.done?.[e.res] ?? '', (D?.done?.length ?? 0) < 2 ? null : e.res === 1];
			}),
		};
	}

	build(room, win) {
		if (room.time - (this.nextSample - 60) >= 5) this.sample(room);
		const players = [...room.heroes.values()].map((h) => {
			const p = this.p.get(h.pid) ?? { picks: [], duos: [], evos: [], taken: {}, downs: [], ups: [], minHp: h.hp, minHpT: 0, rar: newRar(), ovr: { seen: 0, took: [] }, bans: [], slotsFullT: null };
			// Share of embers among the cards taken in the last third of the run.
			const late = p.picks.filter((e) => e[2] === 'pick' && e[0] >= room.runLength * (2 / 3));
			const lateEmb = late.filter((e) => e[4] === 'ember').length;
			const total = Object.values(h.dmgBy).reduce((s, v) => s + v, 0) || 1;
			const dmgBy = Object.entries(h.dmgBy).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1])
				.map(([id, v]) => ({ id, name: srcName(id), dmg: Math.round(v), pct: r1((v / total) * 100) }));
			const taken = Object.fromEntries(Object.entries(p.taken).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)]));
			return {
				pid: h.pid, name: h.name, hero: h.hero, heroName: HEROES[h.hero]?.name ?? h.hero, level: h.level,
				kills: h.kills, dmg: Math.round(h.dmg), dmgBy, taken, takenTotal: Math.round(Object.values(p.taken).reduce((s, v) => s + v, 0)),
				downs: p.downs, ups: p.ups, minHp: Math.round(Math.max(0, p.minHp)), minHpAt: r1(p.minHpT), maxHp: h.maxHp,
				duos: p.duos, evos: p.evos, rarity: p.rar, ach: room.runAchievements?.(h, win),
				hpByMin: p.hpMin, dpsByMin: p.dps, deaths: p.deaths, drops: p.drops ?? [], declinedNewWeapon: p.declinedW, declinedNewWeaponLonely: p.declinedLonely,
				build: {
					weapons: [...h.weapons].map(([id, w]) => `${id}${w.lvl}`),
					passives: [...h.passives].map(([id, l]) => `${id}${l}`),
					embers: { ...h.embers },
					ovr: [...h.weapons].filter(([, w]) => w.oc).map(([id, w]) => `${id}~${w.oc}`),
				},
				ovr: { seen: p.ovr.seen, took: p.ovr.took }, bans: p.bans, slotsFullAt: p.slotsFullT,
				late: { picks: late.length, embers: lateEmb, emberShare: late.length ? Math.round((lateEmb / late.length) * 100) : null },
				picks: p.picks,
			};
		});
		let finale = null;
		if (this.fin) {
			const { lord, load, pre, ...F } = this.fin;
			const res = room.finaleResult?.() ?? null;
			const names = new Map(players.map((p) => [p.pid, p.name]));
			finale = {
				pre, ...F, close: Object.fromEntries(Object.entries(F.close).map(([k, v]) => [k, r1(v)])), wall: Object.fromEntries(Object.entries(F.wall).map(([k, v]) => [k, r1(v)])),
				taken: round(F.taken),
				killedAt: res?.killedAt ?? null, sec: res?.sec ?? null, hpLeft: res?.hpLeft ?? null, grade: room.grade ?? 0, lastHit: res?.lastHit ?? null,
				by: lord ? Object.fromEntries([...lord.by].map(([pid, d]) => [names.get(pid) ?? pid, Math.round(d)])) : {},
				load: { enemiesMax: load.enemiesMax, tickMs: Math.round(load.tickMs * 100) / 100, tickAvg: load.ticks ? Math.round((load.tickAvg / load.ticks) * 100) / 100 : 0 },
			};
		}
		const log = {
			v: GAME_VERSION, id: this.id, at: new Date(this.startedAt).toISOString(), players: players.length,
			mode: room.mode ?? 'night', runLength: room.runLength, win, grade: room.grade ?? (win ? 1 : 0), time: r1(room.time), kills: room.kills,
			pickFormat: '[time, level, pick|skip|reroll|ban, id, kind, level, rarity, offered]; offered: id+level, *rarity if not common; overclock: weapon~variant',
			hpFormat: 'hpByMin: [hp at the minute end, min hp in the minute, max hp]; dpsByMin: {weapon: damage per second} per minute',
			summary: [], minutes: this.minutes, peaks: this.peaks, team: players,
			bosses: this.bosses.map(({ group, nearMark, ...b }) => ({
				...b, dmg: Math.round(b.dmg), near: r1(b.near), dps: b.near > 0 ? r1(b.dmg / b.near) : 0,
				by: Object.fromEntries(Object.entries(b.by).map(([k, v]) => [k, Math.round(v)])),
			})),
			reactions: { ...(room.reactN ?? {}) },
			events: this.events,
			left: this.left,
			finale,
			specials: Object.fromEntries(Object.entries(this.specials).map(([id, S]) => {
				const hit = {};
				for (const p of players) for (const [k, v] of Object.entries(p.taken)) if (k.split(':')[0] === id) hit[k] = (hit[k] ?? 0) + v;
				return [id, { ...S, blocked: Math.round(S.blocked), dmgToPlayers: Object.values(hit).reduce((a, b) => a + b, 0), hit }];
			})),
		};
		log.rarity = { seen: [0, 0, 0, 0], took: [0, 0, 0, 0] };
		for (const p of players) for (const k of ['seen', 'took']) p.rarity[k].forEach((n, i) => { log.rarity[k][i] += n; });
		log.summary = summarize(log);
		// Keep the copyable log small: offered-card lists go first, then pick history.
		if (JSON.stringify(log).length > MAX_JSON) for (const p of log.team) for (const e of p.picks) if (typeof e[e.length - 1] === 'string' && e.length > 3 && e[e.length - 1].includes(',')) e.pop();
		if (JSON.stringify(log).length > MAX_JSON) for (const p of log.team) p.picks = p.picks.filter((e) => e[2] !== 'pick' || e[4] !== 'passive');
		if (JSON.stringify(log).length > MAX_JSON) for (const p of log.team) p.dpsByMin = p.dpsByMin.filter((_, i) => i % 3 === 2 || i === p.dpsByMin.length - 1);
		return log;
	}
}

// Short human summary in Russian on top of the log.
export function summarize(log) {
	const out = [];
	const outcome = log.grade === 2 ? `победа, Владыка повержен на ${mmss(log.time)}` : log.win ? `победа на ${mmss(log.time)}` : `группа пала на ${mmss(log.time)}`;
	const len = log.runLength ?? modeOf(log.mode).seconds;
	out.push(`Ночная орда ${log.v} · лог #${log.id} · режим «${modeOf(log.mode).name}» (${mmss(len)}) · игроков: ${log.players} · ${outcome} · убито ${log.kills}`);
	const all = {};
	let tot = 0;
	for (const p of log.team) for (const d of p.dmgBy) { all[d.id] = (all[d.id] ?? 0) + d.dmg; tot += d.dmg; }
	const top = Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, v]) => `${srcName(id)} ${Math.round((v / (tot || 1)) * 100)}%`);
	if (top.length) out.push(`Топ-3 оружия по доле урона: ${top.join(', ')}`);
	const builds = log.team.map((p) => (p.evos?.length ?? 0) + (p.duos?.length ?? 0));
	if (builds.length) out.push(`Эволюций и связок за забег: ${builds.join(', ')} (в среднем ${r1(builds.reduce((a, b) => a + b, 0) / builds.length)})`);
	const rx = Object.entries(log.reactions ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
	if (rx.length) out.push('Реакции: ' + rx.map(([k, n]) => `${REACTIONS[k]?.name ?? k} ×${n}`).join(', '));
	const hard = [], easy = [];
	for (const m of log.minutes) {
		const per = m.alive > 0 ? m.taken / Math.max(1, m.alive) / Math.max(1, m.maxHp) : 1;
		m.load = Math.round(per * 100);
		if (m.downs > 0 || per >= 0.5) hard.push(m.m);
		if (m.downs === 0 && per < 0.1) easy.push(m.m);
	}
	if (log.bosses?.length) {
		out.push('Боссы: ' + log.bosses.map((b) => {
			const dn = Object.values(b.downs).reduce((s, v) => s + v, 0);
			const res = b.sec !== null ? `убит за ${Math.round(b.sec)} с` : b.absorbed ? 'поглощён Владыкой' : `не убит (снято ${Math.round(((b.dmg ?? 0) / (b.hp || 1)) * 100)}% из ${b.hp})`;
			const near = b.near ? `, рядом ${Math.round(b.near)} с, урон по нему ${b.dps}/с` : '';
			return `${b.name} (${mmss(b.at)}) — ${res}${near}${dn ? `, падений ${dn}` : ''}`;
		}).join('; '));
	}
	if (log.rarity) {
		const line = (arr) => RARITIES.map((R, i) => `${R.name.toLowerCase()} ${arr[i]}`).join(', ');
		out.push(`Редкость карточек: выпало ${line(log.rarity.seen)}; взято ${line(log.rarity.took)}.`);
	}
	if (log.peaks?.length) {
		out.push('Пики: ' + log.peaks.map((p) => {
			const extra = [p.spawned ? `теней ${p.spawned}` : '', p.burned ? `сгорело ${p.burned}` : '', p.downs ? `падений ${p.downs}` : ''].filter(Boolean);
			return `${p.name} (${mmss(p.at)})${extra.length ? ' — ' + extra.join(', ') : ''}`;
		}).join('; '));
	}
	const sp = Object.entries(log.specials ?? {}).filter(([, S]) => S.spawned > 0);
	if (sp.length) {
		out.push('Новые враги: ' + sp.map(([id, S]) => {
			const extra = [S.shots ? `выстрелов ${S.shots}` : '', S.blocked ? `щит поглотил ${S.blocked}` : ''].filter(Boolean);
			return `${ENEMIES[id].name} (с ${mmss(S.first)}) — появилось ${S.spawned}, убито ${S.killed}, урон по игрокам ${S.dmgToPlayers}${extra.length ? ', ' + extra.join(', ') : ''}`;
		}).join('; '));
	}
	if (log.events?.length) {
		out.push('События: ' + log.events.map((e) => {
			const D = EVENTS[EVENT_INDEX[e.id]];
			const det = [
				e.id === 'star' && e.hit !== undefined ? `задело врагов ${e.hit}, игроков ${e.hurt}` : '',
				e.id === 'fog' ? `убито в тумане ${e.kills}` : '',
				e.id === 'altar' ? `«${ALTAR_DEALS.find((d) => d.id === e.deal)?.name}»${e.took?.length ? `, приняли: ${e.took.join(', ')}` : ''}` : '',
				e.id === 'cursed' && e.opened !== undefined ? `открыл ${e.by} на ${mmss(e.opened)}, волна ${e.wave}` : '',
				e.id === 'streak' ? `${e.kills}/${e.goal}` : '',
			].filter(Boolean);
			return `${D?.name ?? e.id} (${mmss(e.at)}) — ${D?.done[e.res] ?? e.res}${det.length ? ' (' + det.join('; ') + ')' : ''}`;
		}).join('; '));
	}
	const F = log.finale;
	if (F && F.at === null) out.push(`Финал: кольцо сомкнулось на ${mmss(F.pre)}, до Владыки не дожили.`);
	else if (F) {
		const tot = Object.values(F.by).reduce((s, v) => s + v, 0) || 1;
		const by = Object.entries(F.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((v / tot) * 100)}%`).join(', ');
		const close = Object.entries(F.close).map(([k, v]) => `${k} ${Math.round(v)} с`).join(', ');
		const wall = Object.entries(F.wall).filter(([, v]) => v >= 5).map(([k, v]) => `${k} ${Math.round(v)} с`).join(', ');
		const dn = Object.values(F.downs).reduce((s, v) => s + v, 0);
		const head = F.grade === 2 ? `Владыка повержен за ${Math.round(F.sec)} с${F.lastHit ? `, последний удар — ${F.lastHit}` : ''}`
			: F.grade === 1 ? `дожили, у Владыки осталось ${Math.round(F.hpLeft * 100)}%`
			: `группа пала на ${Math.round(F.sec)}-й секунде боя, Владыке оставалось ${Math.round(F.hpLeft * 100)}%`;
		const parts = [
			F.rageAt !== null ? `ярость на ${Math.round(F.rageAt)}-й` : 'до ярости не дошло', `падений ${dn}`, F.rayAt !== null && F.rayAt !== undefined ? `луч рассвета на ${Math.round(F.rayAt)}-й, поднято ${F.revived}` : '',
			by ? `по Владыке: ${by}` : '', close ? `вплотную: ${close}` : '', wall ? `у стены: ${wall}` : '',
			`урон по игрокам: волна ${F.taken.wave}, снаряды ${F.taken.shot}, рывок ${F.taken.dash}, касание ${F.taken.contact}, орда ${F.taken.adds}`,
			`поглощено ${F.absorbed}, пачек ${F.adds.pulses} (${F.adds.spawned} врагов)`,
		].filter(Boolean);
		out.push(`Финал (${mmss(F.at)}, здоровье Владыки ${F.lordHp}): ${head}; ${parts.join('; ')}.`);
		if (Object.values(F.taken).reduce((s, v) => s + v, 0) === 0 && F.grade > 0) out.push('Финал прошёл без урона по игрокам — слишком легко.');
	}
	const drops = log.team.filter((p) => p.drops?.length).map((p) => `${p.name} ${p.drops.map(([a, b]) => `${mmss(a)}–${b === null ? 'не вернулся' : mmss(b)}`).join(', ')}`);
	if (drops.length) out.push(`Обрывы связи: ${drops.join('; ')}`);
	if (log.left?.length) out.push('Состав менялся: ' + log.left.map(([t, a, b]) => `${a} → ${b} на ${mmss(t)}`).join(', '));
	const calm = longestRun(log.minutes.filter((m) => m.m > 1 && easy.includes(m.m)).map((m) => m.m));
	out.push(calm && calm[1] - calm[0] + 1 >= 3
		? `Легко на минутах ${calm[0]}–${calm[1]}: урон по группе меньше 10% здоровья в минуту и без падений.`
		: 'Затяжного «легко» не было.');
	out.push(hard.length ? `Тяжело на минутах: ${hard.join(', ')} (падения или ≥50% здоровья урона за минуту).` : 'Тяжёлых минут не было: никто не терял половину здоровья за минуту.');
	for (const p of log.team) {
		const fav = p.dmgBy.slice(0, 2).map((d) => `${d.name} ${Math.round(d.pct)}%`).join(', ');
		const hit = Object.keys(p.taken)[0];
		out.push(`${p.name} — ${p.heroName}, ур. ${p.level}, урон ${p.dmg}${fav ? ` (${fav})` : ''}, падений ${p.downs.length}, мин. здоровье ${p.minHp}/${p.maxHp}${hit ? `, больше всего бьёт: ${enemyName(hit)}` : ''}`);
		out.push(...playerLines(p));
	}
	return out;
}

// v23: playful titles for the results card, in priority order. Group titles go to the single best one (a tie gives
// nobody); in a group a player holds at most two, the next title goes to the best of the rest, so the titles spread.
// Solo gets the personal ones it earned.
// Each: {id, icon, title, pid, name, text}.
export function awards(players, log) {
	const group = players.length > 1;
	const cand = [];
	const per = new Map();
	const free = (p) => !group || (per.get(p.pid) ?? 0) < 2;
	const best = (key, min = 1) => {
		const pool = players.filter(free);
		const v = pool.map((p) => key(p));
		const m = Math.max(...v);
		if (!(m >= min) || v.filter((x) => x === m).length > 1) return null;
		return pool[v.indexOf(m)];
	};
	const add = (id, icon, title, p, text) => {
		if (!p || !free(p)) return;
		per.set(p.pid, (per.get(p.pid) ?? 0) + 1);
		cand.push({ id, icon, title, pid: p.pid, name: p.name, text: text(p) });
	};
	if (log.finale?.lastHit) add('lord', '👑', 'Убийца Владыки', players.find((p) => p.name === log.finale.lastHit), () => 'последний удар по Владыке');
	add('rescuer', '✚', 'Спасатель', best((p) => p.revives), (p) => `поднял союзников ${p.revives} ${plural(p.revives, 'раз', 'раза', 'раз')}`);
	if (group) {
		add('kills', '☠', 'Больше всех убийств', best((p) => p.kills), (p) => `${fmtNum(p.kills)} ${plural(p.kills, 'враг', 'врага', 'врагов')}`);
		add('dmg', '⚔', 'Главный калибр', best((p) => p.dmg), (p) => `${fmtNum(p.dmg)} урона`);
		add('tank', '🛡', 'Танк', best((p) => p.taken, 100), (p) => `принял ${fmtNum(p.taken)} урона`);
	}
	// No scratch: never fell, never dropped under 30% health, and took the least (a group) or under three full healths (solo).
	const clean = players.filter((p) => p.downs === 0 && p.drops === 0 && p.minHp >= p.maxHp * 0.3 && free(p));
	if (clean.length) {
		const c = clean.reduce((a, b) => (b.taken < a.taken ? b : a));
		const tank = cand.find((a) => a.id === 'tank');
		if ((group ? clean.filter((p) => p.taken === c.taken).length === 1 : c.taken < c.maxHp * 3) && tank?.pid !== c.pid) {
			add('clean', '✨', 'Ни царапины', c, (p) => (p.taken ? `ни разу не упал, принял всего ${fmtNum(p.taken)}` : 'ни одного удара'));
		}
	}
	add('hit', '💥', 'Тяжёлая рука', best((p) => p.bestHit?.[0] ?? 0), (p) => `${fmtNum(p.bestHit[0])} за удар (${p.bestHit[1]})`);
	add('streak', '🔥', 'Неудержимый', best((p) => p.streak?.[0] ?? 0, 20), (p) => `${p.streak[0]} ${plural(p.streak[0], 'убийство', 'убийства', 'убийств')} за 10 с`);
	add('embers', '♦', 'Коллекционер углей', best((p) => p.embers, 3), (p) => `${p.embers} ${plural(p.embers, 'уголь', 'угля', 'углей')}`);
	if (group) add('phoenix', '🐦', 'Феникс', best((p) => p.downs, 2), (p) => `падал и вставал ${p.downs} ${plural(p.downs, 'раз', 'раза', 'раз')}`);
	return cand;
}

export const plural = (n, one, few, many) => {
	const a = Math.abs(n) % 100, b = a % 10;
	return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
const fmtNum = (n) => String(Math.round(n ?? 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');

// Longest run of consecutive minute numbers as [from, to], or null.
function longestRun(ms) {
	let best = null, from = null;
	for (let i = 0; i < ms.length; i++) {
		if (i === 0 || ms[i] !== ms[i - 1] + 1) from = ms[i];
		if (!best || ms[i] - from > best[1] - best[0]) best = [from, ms[i]];
	}
	return best;
}

// Why the player fell and what the build did: downs with the last 10 s, dps per weapon by minute, hp curve, declined weapons.
function playerLines(p) {
	const out = [];
	const pre = `  ${p.name}:`;
	for (const d of p.deaths ?? []) {
		const hits = Object.entries(d.last10).slice(0, 3).map(([k, v]) => `${enemyName(k)} ${v}`).join(', ');
		out.push(`${pre} падение ${mmss(d.t)}${d.peak ? ` (пик «${d.peak}»)` : ''}: за 10 с били ${hits || '—'}; врагов в 300 px: ${d.crowd}, стрелков в 600 px: ${d.shooters ?? 0}; оружие ${d.weapons.join(' ')}`);
	}
	const rows = p.dpsByMin ?? [];
	if (rows.length) {
		const ids = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((id) => !id.startsWith('r_') && id !== 'other');
		const total = rows.map((r) => Object.values(r).reduce((a, b) => a + b, 0));
		out.push(`${pre} урон в секунду по минутам: всего ${total.join(' ')}`);
		const per = ids.map((id) => `${srcName(id)} ${rows.map((r) => r[id] ?? 0).join(' ')}`);
		if (per.length) out.push(`${pre} по оружию: ${per.join('; ')}`);
		const dips = [];
		for (let i = 1; i < total.length; i++) if (total[i] < total[i - 1] * 0.75) dips.push(i + 1);
		if (dips.length) out.push(`${pre} провал урона на минутах: ${dips.join(', ')} (−25% и больше к прошлой минуте)`);
	}
	if (p.hpByMin?.length) out.push(`${pre} здоровье по минутам (мин. за минуту): ${p.hpByMin.map((x) => x[1]).join(' ')} из ${p.maxHp}`);
	const ovrName = (s) => { const [id, v] = s.split('~'); return v ? `${WEAPONS[id]?.name ?? id} — «${OVERCLOCKS[id]?.[v - 1]?.name ?? v}»` : PASSIVE_OR_WEAPON(id); };
	if (p.ovr) {
		out.push(`${pre} разгоны: предложено ${p.ovr.seen}, взято ${p.ovr.took.length}${p.ovr.took.length ? ` (${p.ovr.took.map(([t, s]) => `${ovrName(s)} на ${mmss(t)}`).join(', ')})` : ''}; изгнано ${p.bans.length}${p.bans.length ? ` (${p.bans.map(([t, s]) => `${ovrName(s)} на ${mmss(t)}`).join(', ')})` : ''}`);
		out.push(`${pre} слоты 6 + 4 заполнены: ${p.slotsFullAt === null ? 'нет' : mmss(p.slotsFullAt)}; угли в последней трети забега: ${p.late.emberShare === null ? 'выборов не было' : `${p.late.embers} из ${p.late.picks} выборов (${p.late.emberShare}%)`}`);
	}
	if (p.declinedNewWeapon) out.push(`${pre} отказался от нового оружия ${p.declinedNewWeapon} раз${p.declinedNewWeaponLonely ? ` (из них ${p.declinedNewWeaponLonely} — с одним оружием)` : ''}`);
	return out;
}

export const logText = (log) => `${log.summary.join('\n')}\n\n${JSON.stringify(log)}`;

// Last KEEP_RUNS runs in memory; optional copy on disk (enabled by the server, not by tests or sims).
export const runStore = {
	runs: [],
	dir: null,
	add(log) {
		this.runs.push(log);
		if (this.runs.length > KEEP_RUNS) this.runs.splice(0, this.runs.length - KEEP_RUNS);
		if (!this.dir) return;
		fs.writeFile(path.join(this.dir, `${log.id}.json`), JSON.stringify(log), () => {});
		this.prune();
	},
	get(id) {
		if (!RUN_ID_RE.test(id)) return null;
		const mem = this.runs.find((r) => r.id === id);
		if (mem || !this.dir) return mem ?? null;
		try {
			return JSON.parse(fs.readFileSync(path.join(this.dir, `${id}.json`), 'utf8'));
		} catch {
			return null;
		}
	},
	list() {
		return this.runs.slice().reverse().map((r) => ({
			id: r.id, at: r.at, v: r.v, mode: r.mode ?? 'night', win: r.win, grade: r.grade ?? (r.win ? 1 : 0), time: r.time, players: r.team.map((p) => ({ name: p.name, hero: p.hero, level: p.level })),
		}));
	},
	persist(dir) {
		try {
			fs.mkdirSync(dir, { recursive: true });
			this.dir = dir;
			const files = this.files();
			for (const f of files.slice(-KEEP_RUNS)) {
				try {
					const log = JSON.parse(fs.readFileSync(path.join(dir, f.name), 'utf8'));
					if (RUN_ID_RE.test(log.id) && !this.runs.some((r) => r.id === log.id)) this.runs.push(log);
				} catch { /* skip broken file */ }
			}
		} catch {
			this.dir = null;
		}
	},
	files() {
		return fs.readdirSync(this.dir).filter((n) => /^[A-Z0-9]{6}\.json$/.test(n))
			.map((name) => ({ name, t: fs.statSync(path.join(this.dir, name)).mtimeMs })).sort((a, b) => a.t - b.t);
	},
	prune() {
		try {
			const files = this.files();
			for (const f of files.slice(0, Math.max(0, files.length - 200))) fs.unlinkSync(path.join(this.dir, f.name));
		} catch { /* best effort */ }
	},
};
