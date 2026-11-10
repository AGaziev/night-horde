// Run telemetry: compact per-run log for player feedback, plus an in-memory store of recent runs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
	GAME_VERSION, HEROES, ENEMIES, ENEMY_TYPES, weaponDef, enemyHpScale, enemyDmgScale, REACTIONS,
} from '../public/shared/content.js';

export const RUN_ID_RE = /^[A-Z0-9]{6}$/;
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_JSON = 28 * 1024;
const KEEP_RUNS = 30;

const r1 = (v) => Math.round(v * 10) / 10;
const SRC_NAMES = { burn: 'Поджог', blast: 'Взрывы', cracker: 'Хлопушки', other: 'Прочее' };
export const srcName = (id) => SRC_NAMES[id] ?? (id.startsWith('r_') && REACTIONS[id.slice(2)] ? `Реакция «${REACTIONS[id.slice(2)].name}»` : null) ?? weaponDef(id)?.name ?? id;
const enemyName = (key) => {
	const [type, how] = key.split(':');
	const base = type === 'elite' ? 'Элита' : ENEMIES[type]?.name ?? type;
	return how === 'shot' ? `${base} (выстрел)` : how === 'blast' ? `${base} (взрыв)` : base;
};
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
export const newRunId = () => Array.from(crypto.randomBytes(6), (b) => ID_CHARS[b % ID_CHARS.length]).join('');
export const enemyKey = (e) => ENEMY_TYPES[e.type] ?? 'enemy';

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
		for (const h of room.heroes.values()) {
			this.p.set(h.pid, {
				pid: h.pid, name: h.name, hero: h.hero, picks: [], duos: [], evos: [], taken: {}, downs: [], ups: [],
				minHp: h.maxHp, minHpT: 0,
			});
		}
	}

	tick(room) {
		if (room.time < this.nextSample) return;
		this.sample(room);
		this.nextSample += 60;
	}

	sample(room) {
		const heroes = [...room.heroes.values()];
		const dealt = heroes.reduce((s, h) => s + h.dmg, 0);
		const alive = heroes.filter((h) => h.st === 0).length;
		this.minutes.push({
			m: this.minutes.length + 1, enemies: room.enemies.length, hpMul: r1(enemyHpScale(room.time, room.heroes.size)),
			dmgMul: Math.round(enemyDmgScale(room.time, room.heroes.size) * 100) / 100, alive, lvl: heroes.map((h) => h.level),
			taken: Math.round(this.acc.taken), downs: this.acc.downs, kills: room.kills - this.acc.kills,
			dps: Math.round((dealt - this.acc.dealt) / 60), maxHp: Math.round(heroes.reduce((s, h) => s + h.maxHp, 0) / heroes.length),
		});
		this.acc = { taken: 0, downs: 0, kills: room.kills, dealt };
	}

	// act: 'pick' | 'skip' | 'reroll'; offer: the cards that were on screen.
	choice(room, h, act, card, offer) {
		const p = this.p.get(h.pid);
		if (!p) return;
		const of = (offer ?? []).map((c) => (c.level > 1 ? `${c.id}${c.level}` : c.id)).join(',');
		const e = [r1(room.time), h.level, act];
		if (card) e.push(card.id, card.kind, card.level);
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
		if (h.hp > 0 && h.hp < p.minHp) {
			p.minHp = h.hp;
			p.minHpT = room.time;
		}
		if (h.hp <= 0) {
			this.acc.downs++;
			p.downs.push([r1(room.time), from]);
			const pk = this.peaks[this.peaks.length - 1];
			if (pk && pk.end === null) pk.downs++;
			const kind = from.split(':')[0];
			for (const b of this.bosses) {
				if (b.killedAt !== null) continue;
				b.downs[h.name] = (b.downs[h.name] ?? 0) + 1;
				if (kind === b.type || (b.type === 'twin' && kind === 'twinhalf')) b.downsByBoss++;
			}
		}
	}

	bossSpawn(room, e) {
		this.bosses.push({ type: enemyKey(e), name: e.def.name, group: e.group, at: r1(room.time), hp: Math.round(e.maxHp), killedAt: null, sec: null, downs: {}, downsByBoss: 0 });
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

	up(room, h) {
		this.p.get(h.pid)?.ups.push(r1(room.time));
	}

	build(room, win) {
		if (room.time - (this.nextSample - 60) >= 5) this.sample(room);
		const players = [...room.heroes.values()].map((h) => {
			const p = this.p.get(h.pid) ?? { picks: [], duos: [], evos: [], taken: {}, downs: [], ups: [], minHp: h.hp, minHpT: 0 };
			const total = Object.values(h.dmgBy).reduce((s, v) => s + v, 0) || 1;
			const dmgBy = Object.entries(h.dmgBy).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1])
				.map(([id, v]) => ({ id, name: srcName(id), dmg: Math.round(v), pct: r1((v / total) * 100) }));
			const taken = Object.fromEntries(Object.entries(p.taken).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)]));
			return {
				pid: h.pid, name: h.name, hero: h.hero, heroName: HEROES[h.hero]?.name ?? h.hero, level: h.level,
				kills: h.kills, dmg: Math.round(h.dmg), dmgBy, taken, takenTotal: Math.round(Object.values(p.taken).reduce((s, v) => s + v, 0)),
				downs: p.downs, ups: p.ups, minHp: Math.round(Math.max(0, p.minHp)), minHpAt: r1(p.minHpT), maxHp: h.maxHp,
				duos: p.duos, evos: p.evos,
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
			win, time: r1(room.time), kills: room.kills,
			pickFormat: '[time, level, pick|skip|reroll, id, kind, level, offered]',
			summary: [], minutes: this.minutes, bosses: this.bosses.map(({ group, ...b }) => b), peaks: this.peaks, team: players,
			reactions: { ...(room.reactN ?? {}) },
		};
		log.summary = summarize(log);
		// Keep the copyable log small: offered-card lists go first, then pick history.
		if (JSON.stringify(log).length > MAX_JSON) for (const p of log.team) for (const e of p.picks) if (typeof e[e.length - 1] === 'string' && e.length > 3 && e[e.length - 1].includes(',')) e.pop();
		if (JSON.stringify(log).length > MAX_JSON) for (const p of log.team) p.picks = p.picks.filter((e) => e[2] !== 'pick' || e[4] !== 'passive');
		return log;
	}
}

// Short human summary in Russian on top of the log.
export function summarize(log) {
	const out = [];
	const outcome = log.win ? `победа на ${mmss(log.time)}` : `группа пала на ${mmss(log.time)}`;
	out.push(`Ночная орда ${log.v} · лог #${log.id} · игроков: ${log.players} · ${outcome} · убито ${log.kills}`);
	const all = {};
	let tot = 0;
	for (const p of log.team) for (const d of p.dmgBy) { all[d.id] = (all[d.id] ?? 0) + d.dmg; tot += d.dmg; }
	const top = Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, v]) => `${srcName(id)} ${Math.round((v / (tot || 1)) * 100)}%`);
	if (top.length) out.push(`Топ-3 оружия по доле урона: ${top.join(', ')}`);
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
			const res = b.sec !== null ? `убит за ${Math.round(b.sec)} с` : 'не убит';
			return `${b.name} (${mmss(b.at)}) — ${res}${dn ? `, падений ${dn}` : ''}`;
		}).join('; '));
	}
	if (log.peaks?.length) {
		out.push('Пики: ' + log.peaks.map((p) => {
			const extra = [p.spawned ? `теней ${p.spawned}` : '', p.burned ? `сгорело ${p.burned}` : '', p.downs ? `падений ${p.downs}` : ''].filter(Boolean);
			return `${p.name} (${mmss(p.at)})${extra.length ? ' — ' + extra.join(', ') : ''}`;
		}).join('; '));
	}
	let easyFrom = null;
	for (let i = log.minutes.length - 1; i >= 0 && easy.includes(log.minutes[i].m); i--) easyFrom = log.minutes[i].m;
	const tail = easyFrom !== null ? log.minutes.length - easyFrom + 1 : 0;
	out.push(easyFrom !== null && tail >= 3 && easyFrom > 1
		? `Легко с ${easyFrom}-й минуты: дальше урон по группе меньше 10% здоровья в минуту и без падений.`
		: 'Затяжного «легко» не было.');
	out.push(hard.length ? `Тяжело на минутах: ${hard.join(', ')} (падения или ≥50% здоровья урона за минуту).` : 'Тяжёлых минут не было: никто не терял половину здоровья за минуту.');
	for (const p of log.team) {
		const fav = p.dmgBy.slice(0, 2).map((d) => `${d.name} ${Math.round(d.pct)}%`).join(', ');
		const hit = Object.keys(p.taken)[0];
		out.push(`${p.name} — ${p.heroName}, ур. ${p.level}, урон ${p.dmg}${fav ? ` (${fav})` : ''}, падений ${p.downs.length}, мин. здоровье ${p.minHp}/${p.maxHp}${hit ? `, больше всего бьёт: ${enemyName(hit)}` : ''}`);
	}
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
			id: r.id, at: r.at, v: r.v, win: r.win, time: r.time, players: r.team.map((p) => ({ name: p.name, hero: p.hero, level: p.level })),
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
