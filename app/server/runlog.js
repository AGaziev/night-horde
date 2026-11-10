// Run telemetry: compact per-run log for player feedback, plus an in-memory store of recent runs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
	GAME_VERSION, HEROES, ENEMIES, ENEMY_TYPES, weaponDef, enemyHpScale, enemyDmgScale, REACTIONS, RARITIES, modeOf,
	SPECIALS, EVENTS, EVENT_INDEX, ALTAR_DEALS,
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
const SRC_NAMES = { burn: 'Поджог', blast: 'Взрывы', cracker: 'Хлопушки', star: 'Падающая звезда', other: 'Прочее' };
const SPECIAL_IDS = Object.keys(SPECIALS);
export const srcName = (id) => SRC_NAMES[id] ?? (id.startsWith('r_') && REACTIONS[id.slice(2)] ? `Реакция «${REACTIONS[id.slice(2)].name}»` : null) ?? weaponDef(id)?.name ?? id;
const enemyName = (key) => {
	const [type, how] = key.split(':');
	if (type === 'event') return EVENTS[EVENT_INDEX[how]]?.name ?? how;
	const base = type === 'elite' ? 'Элита' : ENEMIES[type]?.name ?? type;
	return how === 'shot' ? `${base} (выстрел)` : how === 'blast' ? `${base} (взрыв)` : base;
};
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
export const newRunId = () => Array.from(crypto.randomBytes(6), (b) => ID_CHARS[b % ID_CHARS.length]).join('');
export const enemyKey = (e) => ENEMY_TYPES[e.type] ?? 'enemy';
// Card rarity counters per player: offered on screen and taken, index = rarity.
const newRar = () => ({ seen: [0, 0, 0, 0], took: [0, 0, 0, 0] });

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
		// v18 specials: spawned / killed / shots fired, damage blocked by the shield; damage to players comes from `taken`.
		this.specials = Object.fromEntries(SPECIAL_IDS.map((id) => [id, { spawned: 0, killed: 0, shots: 0, blocked: 0, first: null }]));
		for (const h of room.heroes.values()) {
			this.p.set(h.pid, {
				pid: h.pid, name: h.name, hero: h.hero, picks: [], duos: [], evos: [], taken: {}, downs: [], ups: [],
				minHp: h.maxHp, minHpT: 0, rar: newRar(),
				// v15: per-minute hp [end, min, max] and weapon dps, recent hits, down details, declined new weapons.
				hpMin: [], minuteMin: h.hp, dps: [], lastDmgBy: {}, hits: [], deaths: [], declinedW: 0, declinedLonely: 0, drops: [],
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

	// act: 'pick' | 'skip' | 'reroll'; offer: the cards that were on screen.
	choice(room, h, act, card, offer) {
		const p = this.p.get(h.pid);
		if (!p) return;
		const of = (offer ?? []).map((c) => (c.level > 1 ? `${c.id}${c.level}` : c.id) + (c.rar > 0 ? `*${c.rar}` : '')).join(',');
		for (const c of offer ?? []) if (c.rar !== undefined) p.rar.seen[c.rar]++;
		if (card?.rar !== undefined) p.rar.took[card.rar]++;
		const newW = (offer ?? []).some((c) => c.kind === 'weapon' && (c.from ?? c.level - 1) === 0);
		if (newW && act !== 'reroll' && !(card?.kind === 'weapon' && (card.from ?? card.level - 1) === 0)) {
			p.declinedW++;
			if (h.weapons.size < 2) p.declinedLonely++;
		}
		const e = [r1(room.time), h.level, act];
		if (card) e.push(card.id, card.kind, card.level, card.rar ?? null);
		if (of) e.push(of);
		p.picks.push(e);
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
		if (h.hp <= 0) this.down(room, h, from);
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
		for (const b of this.bosses) {
			if (b.killedAt !== null) continue;
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

	build(room, win) {
		if (room.time - (this.nextSample - 60) >= 5) this.sample(room);
		const players = [...room.heroes.values()].map((h) => {
			const p = this.p.get(h.pid) ?? { picks: [], duos: [], evos: [], taken: {}, downs: [], ups: [], minHp: h.hp, minHpT: 0, rar: newRar() };
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
				},
				picks: p.picks,
			};
		});
		const log = {
			v: GAME_VERSION, id: this.id, at: new Date(this.startedAt).toISOString(), players: players.length,
			mode: room.mode ?? 'night', runLength: room.runLength, win, time: r1(room.time), kills: room.kills,
			pickFormat: '[time, level, pick|skip|reroll, id, kind, level, rarity, offered]; offered: id+level, *rarity if not common',
			hpFormat: 'hpByMin: [hp at the minute end, min hp in the minute, max hp]; dpsByMin: {weapon: damage per second} per minute',
			summary: [], minutes: this.minutes, peaks: this.peaks, team: players,
			bosses: this.bosses.map(({ group, nearMark, ...b }) => ({
				...b, dmg: Math.round(b.dmg), near: r1(b.near), dps: b.near > 0 ? r1(b.dmg / b.near) : 0,
				by: Object.fromEntries(Object.entries(b.by).map(([k, v]) => [k, Math.round(v)])),
			})),
			reactions: { ...(room.reactN ?? {}) },
			events: this.events,
			left: this.left,
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
	const outcome = log.win ? `победа на ${mmss(log.time)}` : `группа пала на ${mmss(log.time)}`;
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
			const res = b.sec !== null ? `убит за ${Math.round(b.sec)} с` : `не убит (снято ${Math.round(((b.dmg ?? 0) / (b.hp || 1)) * 100)}% из ${b.hp})`;
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
			id: r.id, at: r.at, v: r.v, mode: r.mode ?? 'night', win: r.win, time: r.time, players: r.team.map((p) => ({ name: p.name, hero: p.hero, level: p.level })),
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
