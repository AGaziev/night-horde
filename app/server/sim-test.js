// Headless simulation test: node server/sim-test.js
import assert from 'node:assert/strict';
import { Hub, Room } from './game.js';
import { RUN_ID_RE, runStore, logText, summarize } from './runlog.js';
import { SnapshotDecoder } from '../public/js/snapshot-codec.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	TICK_HZ, MAX_ENEMIES, ENEMY_TYPES, PROJECTILE_KINDS, WEAPON_IDS, ENEMIES, REVIVE_SECONDS, HEROES, NO_TRAIT, heroTrait,
	ITEM_TYPES, ST, ELITE_AFFIXES, ELITE_HP_MUL, MAX_GEMS, SKIP_XP, REROLLS_START, PASSIVES, WEAPONS, BREAK_TILE,
	breakableAt, xpForNext, PLAYER_RADIUS, ITEMS, MAX_LEVEL, MAX_WEAPONS, MAX_PASSIVES, SHIELD_DIRS, SHIELD_SHIFT,
	DUOS, DUO_IDS, DUO_BY_PAIR, duoKey, MAX_DUOS, SYNERGY_PER, EVOS, EVO_IDS, EVO_BY_WEAPON, EMBERS, teamXpMul,
	GAME_VERSION, enemyHpScale, enemyDmgScale, BOSS_TIMES, BOSS_POOL, FINAL_BOSS, bossHpScale,
	PEAKS, PEAK_WARN, PEAK_BOSS_GAP, RUN_SECONDS, INVASION, spawnRateScale, peakSchedule,
	RARITIES, CHEST_FLOOR, rollRarity, rarityWeights, passiveStep, passiveDesc, PASSIVE_BASE,
} from '../public/shared/content.js';
import * as C from '../public/shared/content.js';
const enemyHpScaleOf = (r) => C.enemyHpScale(r.nt, r.heroes.size);

const isInt = (v) => Number.isInteger(v);

function checkSnapshot(s) {
	assert.equal(s.t, 's');
	assert.equal(typeof s.tm, 'number');
	assert.ok(isInt(s.k));
	assert.ok(Array.isArray(s.p));
	for (const p of s.p) {
		assert.equal(p.length, 14);
		assert.ok(isInt(p[13]) && p[13] >= 0, 'ward charges');
		for (let i = 0; i < 10; i++) assert.ok(isInt(p[i]), `p[${i}] int`);
		assert.ok(p[8] === 0 || p[8] === 1);
		assert.ok(p[9] >= 0 && p[9] <= 100);
		assert.equal(typeof p[10], 'number');
		assert.equal(typeof p[11], 'number');
		for (const [id, lvl, extra, mask] of p[12]) {
			assert.ok((WEAPON_IDS.includes(id) || (DUO_IDS.includes(id) && lvl <= 3) || (EVO_IDS.includes(id) && lvl === 1)) && isInt(lvl), `weapon ${id}`);
			// v20: an overclocked plain weapon at level 5 carries [id, lvl, echo amount, variant 1|2].
			const ovr = WEAPON_IDS.includes(id) && lvl === 5 && (mask === 1 || mask === 2);
			assert.ok(extra === undefined || ((['orbit', 'windmill', 'firewheel', 'orrery'].includes(id) || ovr) && isInt(extra)));
			assert.ok(mask === undefined || (id === 'orrery' && isInt(mask)) || ovr);
		}
	}
	const flat = (arr, n) => {
		assert.ok(Array.isArray(arr) && arr.length % n === 0);
		assert.ok(arr.every(isInt), 'flat arrays must be integers');
	};
	flat(s.e, 6);
	flat(s.b, 5);
	flat(s.g, 4);
	flat(s.z, 4);
	flat(s.tr, 5);
	for (let i = 0; i < s.tr.length; i += 5) assert.ok([0, 1, 2, 3, 4].includes(s.tr[i + 3]), 'trap kind');
	assert.ok(isInt(s.syn) && s.syn >= 0 && s.syn <= 20, 'synergy');
	flat(s.it, 4);
	for (let i = 0; i < s.e.length; i += 6) {
		assert.ok(s.e[i + 1] >= 0 && s.e[i + 1] < ENEMY_TYPES.length);
		assert.ok(s.e[i + 4] >= 1 && s.e[i + 4] <= 100);
		assert.ok(s.e[i + 5] >= 0 && s.e[i + 5] < (SHIELD_DIRS << SHIELD_SHIFT), 'state mask');
		if (s.e[i + 5] >= 512) assert.ok(s.e[i + 5] & ST.shield, 'facing bits only with a shield');
	}
	for (let i = 0; i < s.it.length; i += 4) assert.ok(s.it[i + 1] >= 0 && s.it[i + 1] < ITEM_TYPES.length);
	for (let i = 0; i < s.b.length; i += 5) assert.ok(s.b[i + 1] >= 0 && s.b[i + 1] < PROJECTILE_KINDS.length);
	for (let i = 0; i < s.g.length; i += 4) assert.ok([0, 1, 2, 3].includes(s.g[i + 3]));
	assert.ok(Array.isArray(s.fx));
	const known = ['hit', 'die', 'zap', 'slash', 'hurt', 'down', 'up', 'lvl', 'boss', 'chest', 'shot', 'ptgt', 'pend', 'slowz',
		'eshot', 'epend', 'lob', 'boom', 'warn', 'frost', 'snap', 'brk', 'item', 'open', 'elite', 'blink', 'inv',
		'tslash', 'tfan', 'orb', 'orbm', 'zk', 'shard', 'duo', 'evo', 'cone', 'crescent', 'bell', 'ward', 'bline', 'react', 'banner', 'peakw', 'peak', 'pring', 'dawn', 'evt', 'evte', 'eorb', 'altar', 'apulse', 'ovr'];
	const arity = {
		ptgt: 4, pend: 5, inv: 3, eshot: 8, epend: 3, lob: 9, tslash: 5, tfan: 3, orb: 10, orbm: 10, zk: 3, shard: 3, duo: 3, evo: 3, cone: 5, crescent: 3, bell: 3, ward: 3, bline: 7, boom: 5, warn: 5, frost: 3, snap: 3, brk: 3, item: 5, open: 4, elite: 3, blink: 3, react: 5, banner: 6, peakw: 2, peak: 2, pring: 4, dawn: 2, evt: 3, evte: 3, eorb: 9, altar: 3, apulse: 3, ovr: 4,
	};
	for (const f of s.fx) {
		assert.ok(known.includes(f[0]), `fx ${f[0]}`);
		if (arity[f[0]]) assert.equal(f.length, arity[f[0]], `fx ${f[0]} arity`);
		if (f[0] === 'shot') assert.ok(f.length === 10 || f.length === 12 || f.length === 13, 'shot arity'); // 13: v20 big projectile
		if (f[0] === 'hit') assert.ok(f.length === 4 || (f.length === 6 && f[4] === 1), 'hit arity');
		if (f[0] === 'shot') assert.ok(f[2] >= 0 && f[2] < PROJECTILE_KINDS.length && f[7] > 0 && f[9] <= s.tm + 0.01); // tm has 2 decimals, event times 3
		if (f[0] === 'pend') assert.ok(f[4] <= s.tm + 0.01);
	}
	assert.ok(s.pk === undefined || (Array.isArray(s.pk) && s.pk.length === 3 && PEAKS[s.pk[0]] && s.pk[1] >= 0 && s.pk[2] >= s.pk[1]), 'peak');
	assert.ok(s.boss === null || (Array.isArray(s.boss) && s.boss.length === 3 && ENEMIES[ENEMY_TYPES[s.boss[2]]]?.boss), 'boss bar');
}

// Snapshots go through the client decoder, as in the browser (wire format: snapshot-codec.js).
function makeHub(onMsg) {
	const decoders = new Map();
	const hub = new Hub((pid, msg, json) => {
		if (json) msg = JSON.parse(json);
		if (msg.t === 's') {
			if (!decoders.has(pid)) decoders.set(pid, new SnapshotDecoder());
			msg = decoders.get(pid).decode(msg);
			assert.ok(msg, 'snapshot chain is unbroken');
		}
		onMsg(pid, msg, json);
		if (msg.t === 'lvl') hub.handle(pid, { t: 'pick', i: 0 });
	});
	return hub;
}

// --- main run: 3 players in circles for 6 minutes ---
const stats = { snaps: 0, bytes: 0, maxBytes: 0, lvl: 0, over: null, errs: [], maxEnemies: 0, bossSeen: false, chests: 0 };
const hub = makeHub((pid, msg, json) => {
	if (msg.t === 's') {
		if (pid !== 1) return;
		checkSnapshot(msg);
		const size = (json ?? JSON.stringify(msg)).length;
		stats.snaps++;
		stats.bytes += size;
		stats.maxBytes = Math.max(stats.maxBytes, size);
		for (const f of msg.fx) {
			if (f[0] === 'boss') stats.bossSeen = true;
			if (f[0] === 'chest') stats.chests++;
		}
	} else if (msg.t === 'lvl') stats.lvl++;
	else if (msg.t === 'over') stats.over = msg;
	else if (msg.t === 'err') stats.errs.push(msg.msg);
});

const heroes = ['knight', 'witch', 'ranger'];
for (let pid = 1; pid <= 3; pid++) hub.addPlayer(pid, `Бот ${pid}`);
hub.handle(1, { t: 'create', hero: 'knight' });
const room = [...hub.rooms.values()][0];
hub.handle(2, { t: 'join', code: room.code.toLowerCase(), hero: 'witch' });
hub.handle(3, { t: 'join', code: room.code, hero: 'ranger' });
hub.handle(2, { t: 'start' }); // not host: err
assert.equal(room.state, 'lobby');
hub.handle(1, { t: 'start' });
assert.equal(room.state, 'play');
assert.equal(room.heroes.size, 3);
hub.handle(3, { t: 'pos', x: NaN, y: 'x', fx: Infinity, fy: 0 }); // garbage must be ignored
hub.handle(3, { t: 'pos', x: 99999, y: 99999, fx: 1, fy: 0 }); // teleport must be clamped
assert.ok(Math.hypot(room.heroes.get(3).x, room.heroes.get(3).y) < 200);

const dt = 1 / TICK_HZ;
const SIM_SECONDS = 360;
let tickMs = 0, ticks = 0, worstMs = 0;
for (let i = 0; i < SIM_SECONDS * TICK_HZ && room.state === 'play'; i++) {
	const t = i * dt;
	for (let pid = 1; pid <= 3; pid++) {
		const h = room.heroes.get(pid);
		if (!h) continue;
		// Keep the bots alive so the run reaches 6 minutes.
		h.hp = Math.max(h.hp, h.maxHp * 0.6);
		const a = t * 0.5 + pid * 2.1;
		const cx = Math.cos(pid) * 150, cy = Math.sin(pid) * 150;
		hub.handle(pid, { t: 'pos', x: cx + Math.cos(a) * 250, y: cy + Math.sin(a) * 250, fx: -Math.sin(a), fy: Math.cos(a) });
	}
	const t0 = performance.now();
	room.tick(dt);
	const ms = performance.now() - t0;
	tickMs += ms;
	worstMs = Math.max(worstMs, ms);
	ticks++;
	stats.maxEnemies = Math.max(stats.maxEnemies, room.enemies.length);
}

console.log('--- 3 players, %d s simulated ---', Math.round(room.time));
console.log('enemies alive: %d (max %d), kills: %d', room.enemies.length, stats.maxEnemies, room.kills);
for (const h of room.heroes.values()) {
	console.log('  %s [%s] level %d, kills %d, dmg %d, weapons: %s, passives: %s', h.name, h.hero, h.level, h.kills, Math.round(h.dmg),
		[...h.weapons].map(([id, w]) => `${id}:${w.lvl}`).join(' '), [...h.passives].map(([id, l]) => `${id}:${l}`).join(' '));
}
console.log('lvl offers: %d, boss seen: %s, chests: %d, errs: %j', stats.lvl, stats.bossSeen, stats.chests, stats.errs);
console.log('snapshot avg %d B, max %d B over %d snapshots', Math.round(stats.bytes / stats.snaps), stats.maxBytes, stats.snaps);
console.log('tick avg %s ms, worst %s ms', (tickMs / ticks).toFixed(3), worstMs.toFixed(2));
assert.equal(room.state, 'play');
assert.ok(room.time >= SIM_SECONDS - 1);
assert.ok(room.kills > 100);
assert.ok(stats.bossSeen);
assert.deepEqual(stats.errs, ['Начать игру может только хост']);

// --- revive ---
{
	const [a, b] = [room.heroes.get(1), room.heroes.get(2)];
	b.x = a.x + 20;
	b.y = a.y;
	b.ward = 0; // a ward charge would eat the hit
	room.hurtPlayer(b, 1e9);
	assert.equal(b.st, 1);
	for (let i = 0; i < (REVIVE_SECONDS + 0.5) * TICK_HZ; i++) {
		a.hp = a.maxHp;
		room.tick(dt);
	}
	assert.equal(b.st, 0, 'revived');
	console.log('revive: ok');

	const lvlBefore = stats.lvl;
	const aliveCount = [...room.heroes.values()].filter((h) => h.st === 0).length;
	const boss = room.bosses[0] ?? room.spawnEnemy('boss', [a], 1);
	if (!room.bosses.includes(boss)) room.bosses.push(boss);
	room.hurtEnemy(boss, 1e9, a);
	for (let i = 0; i < 3; i++) room.tick(dt);
	assert.ok(stats.chests >= 1, 'chest fx');
	assert.ok(stats.lvl >= lvlBefore + aliveCount, 'chest offers');
	console.log('boss chest: ok');
}

// --- game over + again ---
for (const h of room.heroes.values()) {
	h.ward = 0;
	room.hurtPlayer(h, 1e9);
}
room.tick(dt);
assert.equal(room.state, 'over');
assert.equal(stats.over?.win, false);
assert.equal(stats.over.stats.length, 3);
{
	// Run log: id, per-minute rows, per-player picks/damage, Russian summary, size limit, stored in runStore.
	const log = stats.over.log;
	assert.ok(RUN_ID_RE.test(log.id) && stats.over.runId === log.id, 'run id');
	assert.equal(log.v, GAME_VERSION);
	assert.equal(log.win, false);
	assert.equal(log.players, 3);
	assert.ok(log.minutes.length >= 6, 'minute rows');
	for (const m of log.minutes) {
		assert.ok(isInt(m.enemies) && m.hpMul >= 1 && m.lvl.length === 3 && isInt(m.taken) && isInt(m.downs));
	}
	assert.ok(log.minutes[5].hpMul > log.minutes[0].hpMul, 'hp scale grows');
	for (const p of log.team) {
		assert.ok(HEROES[p.hero] && p.name.startsWith('Бот'));
		assert.ok(p.picks.length >= p.level - 1 - 3, 'pick history');
		assert.ok(p.picks.every((e) => typeof e[0] === 'number' && ['pick', 'skip', 'reroll'].includes(e[2])));
		assert.ok(p.dmgBy.length > 0 && Math.abs(p.dmgBy.reduce((a, d) => a + d.pct, 0) - 100) < 1.5, 'damage shares');
		assert.ok(p.downs.length >= 1, 'final down logged');
		assert.ok(p.build.weapons.length >= 1);
		assert.ok(p.takenTotal > 0 && Object.keys(p.taken).length > 0, 'damage taken by source');
		// v15: why they fell and how the build did, minute by minute.
		assert.equal(p.hpByMin.length, log.minutes.length, 'hp per minute');
		assert.ok(p.hpByMin.every(([end, min, max]) => isInt(end) && isInt(min) && min <= end && end <= max), 'hp rows [end, min, max]');
		assert.equal(p.dpsByMin.length, log.minutes.length, 'weapon dps per minute');
		assert.ok(p.dpsByMin.some((row) => Object.values(row).some((v) => v > 0)), 'some weapon dps');
		assert.ok(p.deaths.length === p.downs.length && p.deaths.every((d) => isInt(d.crowd) && isInt(d.shooters) && typeof d.last10 === 'object' && d.weapons.length >= 1), 'down details');
		assert.ok(p.deaths.some((d) => Object.keys(d.last10).length > 0), 'who hit in the last 10 s');
		assert.ok(isInt(p.declinedNewWeapon) && isInt(p.declinedNewWeaponLonely));
	}
	assert.ok(log.summary.some((l) => /падение \d+:\d\d: за 10 с били .*врагов в 300 px: \d+, стрелков в 600 px: \d+/.test(l)), 'down line in the summary');
	assert.ok(log.summary.some((l) => /урон в секунду по минутам/.test(l)) && log.summary.some((l) => /здоровье по минутам/.test(l)), 'dps and hp lines');
	assert.ok(log.team.some((p) => p.ups.length >= 1), 'revive logged');
	assert.ok(log.summary.length >= 4 && /Топ-3 оружия/.test(log.summary[1]), 'summary');
	assert.ok(log.summary.some((l) => /легко/i.test(l)) && log.summary.some((l) => /яжел|яжёл/.test(l)), 'easy/hard lines');
	// #338U4Q: six calm minutes 8–13, then Dawn hurts again at 14–15 — the calm run is still reported.
	const calm = structuredClone(log);
	calm.minutes = Array.from({ length: 15 }, (_, i) => ({ m: i + 1, alive: 1, maxHp: 100, downs: 0, taken: i + 1 >= 8 && i + 1 <= 13 ? 0 : i + 1 >= 14 ? 60 : 20 }));
	assert.ok(summarize(calm).includes('Легко на минутах 8–13: урон по группе меньше 10% здоровья в минуту и без падений.'), 'calm run mid-game');
	calm.minutes.forEach((m) => { if (m.m === 10 || m.m === 13) m.taken = 30; });
	assert.ok(summarize(calm).includes('Затяжного «легко» не было.'), 'two short calm runs are not a calm stretch');
	const text = logText(log);
	assert.ok(text.length < 30 * 1024, `log text ${text.length} B`);
	assert.deepEqual(JSON.parse(text.slice(text.indexOf('{'))), log);
	assert.deepEqual(runStore.get(log.id), log);
	assert.equal(runStore.list()[0].id, log.id);
	console.log('run log: ok (%d B, #%s)\n  %s', text.length, log.id, log.summary.join('\n  '));
}
hub.handle(1, { t: 'again' });
assert.equal(room.state, 'lobby');
hub.handle(2, { t: 'leave' });
hub.handle(1, { t: 'leave' });
assert.equal(room.host, 3);
hub.removePlayer(3);
assert.equal(hub.rooms.size, 0);
console.log('over/again/leave: ok');

// --- stress: 8 players, 350 enemies ---
{
	let snapBytes = 0, snaps = 0;
	const r = new Room('TEST', (pid, msg, json) => {
		if (msg.t === 's' && pid === 1) {
			snapBytes += (json ?? JSON.stringify(msg)).length;
			snaps++;
		}
		if (msg.t === 'lvl') r.handle(pid, { t: 'pick', i: 0 });
	});
	for (let pid = 1; pid <= 8; pid++) r.addPlayer(pid, `P${pid}`, Object.keys(HEROES)[pid % Object.keys(HEROES).length]);
	r.start();
	// Six max-level weapons per player, rotated so every weapon (old and new) is in play, plus Echo.
	for (const h of r.heroes.values()) {
		h.weapons = new Map();
		for (let k = 0; k < 6; k++) h.weapons.set(WEAPON_IDS[(h.pid * 3 + k) % WEAPON_IDS.length], { lvl: 5, t: Math.random() });
		h.passives.set('echo', 5);
		h.passives.set('crit', 5);
		r.recalcMods(h);
	}
	r.time = 400;
	r.bossIdx = 2;
	const alive = [...r.heroes.values()];
	let ms = 0, n = 0, worst = 0;
	const tickTimes = [];
	for (let i = 0; i < 30 * TICK_HZ; i++) {
		while (r.enemies.length < MAX_ENEMIES) {
			const e = r.spawnEnemy(['skel', 'ghoul', 'bat', 'brute', 'spitter', 'bloater'][r.enemies.length % 6], alive, 50);
			if (r.enemies.length % 40 === 0) r.setElite(e, ELITE_AFFIXES[(r.enemies.length / 40) % ELITE_AFFIXES.length].id);
		}
		for (const h of r.heroes.values()) {
			h.hp = h.maxHp;
			const a = i * dt * 0.7 + h.pid;
			r.handle(h.pid, { t: 'pos', x: Math.cos(a) * (100 + h.pid * 40), y: Math.sin(a) * (100 + h.pid * 40), fx: -Math.sin(a), fy: Math.cos(a) });
		}
		const t0 = performance.now();
		const c0 = process.cpuUsage();
		r.tick(dt);
		const cu = process.cpuUsage(c0);
		const d = performance.now() - t0;
		if (i > 30) {
			ms += d;
			n++;
			worst = Math.max(worst, d);
			// CPU time of the tick: not inflated by waiting for a core on a busy machine.
			tickTimes.push((cu.user + cu.system) / 1000);
		}
	}
	assert.ok(Object.keys([...r.heroes.values()].reduce((a, h) => Object.assign(a, h.dmgBy), {})).length >= WEAPON_IDS.length, 'all weapons dealt damage');
	console.log('--- stress: 8 players, %d enemies, %d gems, %d traps ---', r.enemies.length, r.gems.length, r.traps.length);
	// CPU-time average without the worst 1% (GC spikes): scheduling stalls on a busy machine must not fail the run.
	tickTimes.sort((a, b) => a - b);
	const kept = tickTimes.slice(0, Math.ceil(tickTimes.length * 0.99));
	const trimmed = kept.reduce((a, b) => a + b, 0) / kept.length;
	console.log('tick wall avg %s ms, worst %s ms; CPU avg without worst 1%%: %s ms; snapshot avg %d B', (ms / n).toFixed(3), worst.toFixed(2), trimmed.toFixed(3), Math.round(snapBytes / snaps));
	assert.ok(trimmed < 3, 'tick under 3 ms');
}

// --- hero traits ---
{
	const dtt = 1 / TICK_HZ;
	const traitRoom = (ids) => {
		const r = new Room('TRAIT', () => {});
		ids.forEach((hero, i) => r.addPlayer(i + 1, `T${i + 1}`, hero));
		r.start();
		r.spawn = () => {}; // no random enemies
		return r;
	};
	const placeEnemy = (r, type, x, y) => {
		const e = r.spawnEnemy(type, [...r.heroes.values()], 1000);
		e.x = x;
		e.y = y;
		e.speed = ENEMIES[type].speed;
		return e;
	};
	for (const id of ['knight', 'witch', 'ranger']) assert.deepEqual(heroTrait(id), { ...NO_TRAIT }, `${id} has no trait`);
	for (const [id, h] of Object.entries(HEROES)) assert.ok(!h.trait || typeof h.traitDesc === 'string', `${id} traitDesc`);

	// Herald: allies inside his aura heal 1 hp/s, himself and allies outside do not.
	{
		const r = traitRoom(['herald', 'knight', 'witch']);
		const [hr, kn, wi] = [1, 2, 3].map((pid) => r.heroes.get(pid));
		hr.x = 0; hr.y = 0;
		kn.x = 30; kn.y = 0;
		wi.x = 500; wi.y = 0;
		hr.hp = kn.hp = wi.hp = 50;
		for (let i = 0; i < 2 * TICK_HZ; i++) r.tick(dtt);
		assert.ok(Math.abs(kn.hp - 52) < 0.05, `herald heals ally: ${kn.hp}`);
		assert.equal(wi.hp, 50, 'ally outside aura is not healed');
		assert.equal(hr.hp, 50, 'herald does not heal himself');
		hr.weapons.get('aura').lvl = 5;
		hr.mods.areaMul = 1.5;
		kn.x = 160; kn.hp = 50; // 115 * 1.5 = 172.5 > 160
		for (let i = 0; i < TICK_HZ; i++) r.tick(dtt);
		assert.ok(kn.hp > 50.9, 'heal radius follows aura level and areaMul');
		r.hurtPlayer(hr, 1e9);
		kn.hp = 50;
		for (let i = 0; i < TICK_HZ; i++) r.tick(dtt);
		assert.equal(kn.hp, 50, 'downed herald does not heal');
		console.log('trait herald heal: ok');
	}

	// Smith: takes 20% less damage and pulls enemies within 250 to himself.
	{
		const r = traitRoom(['smith', 'witch']);
		const [sm, wi] = [r.heroes.get(1), r.heroes.get(2)];
		const hp0 = sm.hp;
		r.hurtPlayer(sm, 10);
		assert.ok(Math.abs(hp0 - sm.hp - 8) < 1e-9, 'smith takes 80% damage');
		const hpW = wi.hp;
		r.hurtPlayer(wi, 10);
		assert.equal(hpW - wi.hp, 10, 'others take full damage');
		const stepOf = (smithY) => {
			r.enemies = [];
			wi.x = 0; wi.y = 0;
			sm.x = 0; sm.y = smithY;
			const e = placeEnemy(r, 'ghoul', 150, 50);
			r.moveEnemies(dtt, [sm, wi]);
			return e.y - 50;
		};
		assert.ok(stepOf(200) > 0, 'enemy within 250 goes to the smith');
		assert.ok(stepOf(400) < 0, 'enemy farther than 250 goes to the nearest player');
		sm.st = 1;
		r.enemies = [];
		sm.y = 200;
		const e = placeEnemy(r, 'ghoul', 150, 50);
		r.moveEnemies(dtt, [wi]);
		assert.ok(e.y < 50, 'downed smith does not taunt');
		console.log('trait smith armor + taunt: ok');
	}

	// Stormcaller: one more chain jump than the same lightning level of another hero.
	{
		const zapsFor = (hero) => {
			const r = traitRoom([hero]);
			const h = r.heroes.get(1);
			h.x = 0; h.y = 0;
			h.weapons = new Map([['lightning', { lvl: 1, t: 0 }]]);
			for (let i = 0; i < 4; i++) placeEnemy(r, 'brute', 200 + i * 60, 0);
			r.rebuildGrid();
			r.fx = [];
			r.updateWeapon(h, 'lightning', h.weapons.get('lightning'), dtt);
			return r.fx.filter((f) => f[0] === 'zap').length;
		};
		assert.equal(zapsFor('knight'), 1, 'lightning lvl1: no chain');
		assert.equal(zapsFor('stormcaller'), 2, 'stormcaller: +1 chain');
		console.log('trait stormcaller chain: ok');
	}

	// Alchemist: enemies inside his puddles move 35% slower; other puddles do not slow.
	{
		const stepIn = (hero) => {
			const r = traitRoom([hero]);
			const h = r.heroes.get(1);
			h.x = 0; h.y = 0;
			h.weapons = new Map([['flask', { lvl: 1, t: 0 }]]);
			const e = placeEnemy(r, 'ghoul', 150, 0);
			r.rebuildGrid();
			r.fx = [];
			r.updateWeapon(h, 'flask', h.weapons.get('flask'), dtt);
			const slowFx = r.fx.filter((f) => f[0] === 'slowz').length;
			r.updatePuddles(dtt);
			const x0 = e.x;
			r.moveEnemies(dtt, [h]);
			const inside = x0 - e.x;
			// Out of the puddle the slow wears off.
			r.puddles = [];
			e.x = 150;
			r.time += 1;
			r.moveEnemies(dtt, [h]);
			const outside = 150 - e.x;
			return { inside, outside, slowFx };
		};
		const al = stepIn('alchemist'), kn = stepIn('knight');
		const full = ENEMIES.ghoul.speed * dtt;
		assert.ok(Math.abs(al.inside - full * 0.65) < 1e-6, `alchemist puddle slows: ${al.inside} vs ${full}`);
		assert.ok(Math.abs(al.outside - full) < 1e-6, 'slow ends outside the puddle');
		assert.ok(Math.abs(kn.inside - full) < 1e-6, 'other puddles do not slow');
		assert.equal(al.slowFx, 1, 'slowz fx for alchemist puddle');
		assert.equal(kn.slowFx, 0, 'no slowz fx for other puddles');
		console.log('trait alchemist slow: ok');
	}
}

// --- wave 0/1: offers, crits, new weapons, artifacts, enemies, props, elites, gems ---
{
	const dtt = 1 / TICK_HZ;
	const sent = [];
	const mkRoom = (heroes = ['knight']) => {
		sent.length = 0;
		const r = new Room('NEW', (pid, msg) => sent.push([pid, msg]));
		heroes.forEach((hero, i) => r.addPlayer(i + 1, `N${i + 1}`, hero));
		r.start();
		r.spawn = () => {};
		for (const h of r.heroes.values()) { h.x = 0; h.y = 0; }
		return r;
	};
	const put = (r, type, x, y, hp = 1000) => {
		const e = r.spawnEnemy(type, [...r.heroes.values()], 1);
		e.x = x; e.y = y; e.hp = e.maxHp = hp; e.speed = 0;
		return e;
	};
	const lastOffer = (pid = 1) => sent.filter(([p, m]) => p === pid && m.t === 'lvl').at(-1)?.[1];
	const fxOf = (r, kind) => r.fx.filter((f) => f[0] === kind);
	const only = (h, id, lvl = 1) => { h.weapons = new Map([[id, { lvl, t: 0 }]]); };

	// Reroll and skip.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		r.grantOffer(h);
		let o = lastOffer();
		assert.equal(o.rerolls, REROLLS_START);
		assert.equal(o.skipXp, SKIP_XP);
		assert.ok(o.choices.length >= 1 && o.choices.length <= 3);
		r.handle(1, { t: 'reroll' });
		assert.equal(h.rerolls, REROLLS_START - 1);
		assert.equal(lastOffer().rerolls, REROLLS_START - 1);
		r.handle(1, { t: 'reroll' });
		const n = sent.length;
		r.handle(1, { t: 'reroll' }); // none left
		assert.equal(h.rerolls, 0);
		assert.equal(sent.length, n, 'no reroll without charges');
		h.level = 5; h.xp = 0;
		r.handle(1, { t: 'skip' });
		assert.equal(h.offer, null, 'skip closes the offer');
		assert.equal(h.xp, SKIP_XP, 'skip gives xp');
		r.handle(1, { t: 'skip' }); // nothing to skip
		assert.equal(h.xp, SKIP_XP);
		console.log('reroll/skip: ok');
	}

	// G4: slot 1 upgrades what is owned, new weapons not in two offers in a row, heal at low hp.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		h.weapons.set('bolt', { lvl: 1, t: 0 });
		let prevNew = false, newInRow = 0;
		for (let k = 0; k < 200; k++) {
			const c = r.makeChoices(h);
			assert.equal(c[0].kind, 'weapon', 'slot 1 upgrades the owned weapon');
			assert.ok(h.weapons.has(c[0].id));
			assert.ok(!c.some((x) => x.rec), 'two weapons: no «recommended» mark');
			const hasNew = c.some((x) => x.kind === 'weapon' && x.level === 1);
			assert.ok(c.filter((x) => x.kind === 'weapon' && x.level === 1).length <= 1, 'one new weapon per offer');
			if (hasNew && prevNew) newInRow++;
			prevNew = hasNew;
		}
		assert.equal(newInRow, 0, 'new weapon at most every other offer');
		// One weapon: the pacing rule is lifted and new weapon cards are «recommended».
		h.weapons.delete('bolt');
		let lonelyRow = 0, recs = 0;
		prevNew = false;
		for (let k = 0; k < 200; k++) {
			const c = r.makeChoices(h);
			for (const x of c) assert.equal(!!x.rec, x.kind === 'weapon' && (x.from ?? 0) === 0, 'rec marks exactly the new weapons');
			const hasNew = c.some((x) => x.rec);
			recs += hasNew;
			if (hasNew && prevNew) lonelyRow++;
			prevNew = hasNew;
		}
		assert.ok(lonelyRow > 10 && recs > 100, `one weapon: new weapons offered often (${recs}/200, ${lonelyRow} in a row)`);
		for (let k = 0; k < 300; k++) assert.ok(!r.makeChoices(h).some((c) => c.kind === 'heal'), 'no healing at full hp with free slots');
		h.hp = h.maxHp * 0.3;
		const low = r.makeChoices(h);
		assert.equal(low[2].kind, 'heal', 'heal in slot 3 at low hp');
		h.hp = h.maxHp;
		// Rare card from a chest-boosted offer, applied: +1 to two weapons.
		h.weapons = new Map([['whip', { lvl: 1, t: 0 }], ['bolt', { lvl: 2, t: 0 }], ['aura', { lvl: 5, t: 0 }]]);
		let rare = null;
		for (let k = 0; k < 400 && !rare; k++) {
			h.boostQueue = 1;
			rare = r.makeChoices(h).find((c) => c.kind === 'rare');
		}
		assert.ok(rare, 'rare card shows up');
		h.offer = [rare];
		r.handle(1, { t: 'pick', i: 0 });
		assert.equal(h.weapons.get('whip').lvl + h.weapons.get('bolt').lvl, 5, 'rare: two weapons +1');
		assert.equal(h.weapons.get('aura').lvl, 5);
		console.log('G4 weighted offers + rare: ok');
	}

	// Slots: 6 weapons (v15, was 4) + 4 artifacts; once full only upgrades of what is owned are offered.
	{
		assert.equal(MAX_WEAPONS, 6);
		assert.equal(MAX_PASSIVES, 4);
		const r = mkRoom();
		const h = r.heroes.get(1);
		h.weapons = new Map(['whip', 'bolt', 'knives', 'ward', 'lantern', 'frost'].map((id) => [id, { lvl: 2, t: 0 }])); // no duo pairs
		h.passives = new Map(['crit', 'mail', 'area', 'regen'].map((id) => [id, 1])); // no evolution pairs
		r.recalcMods(h);
		for (let k = 0; k < 100; k++) {
			for (const c of r.makeChoices(h)) {
				assert.ok(c.kind === 'heal' || c.kind === 'rare' || c.level > 1, `no new picks with full slots: ${c.kind}:${c.id}`);
			}
		}
		h.weapons.delete('frost');
		sent.length = 0;
		r.grantOffer(h);
		assert.deepEqual(lastOffer().slots, [5, 6, 4, 4], 'slots in the offer');
		for (const w of h.weapons.values()) w.lvl = MAX_LEVEL;
		// v20: overclocks come before embers, so the weapons here are already overclocked.
		for (const w of h.weapons.values()) w.oc = 1;
		h.weapons.set('frost', { lvl: MAX_LEVEL, t: 0, oc: 1 });
		for (const id of h.passives.keys()) h.passives.set(id, MAX_LEVEL);
		h.offer = null;
		assert.deepEqual(r.makeChoices(h).map((c) => c.kind), ['ember', 'ember', 'ember'], 'all maxed: embers instead of healing');
		// Screenshot 9:50: everything owned is maxed, but a weapon slot is free — new weapons, never embers.
		h.weapons.delete('frost');
		for (let k = 0; k < 50; k++) {
			h.lastOfferNewW = k % 2 === 0;
			const c = r.makeChoices(h);
			assert.ok(c.every((x) => x.kind === 'weapon' && (x.from ?? 0) === 0), `free weapon slot: new weapons, not ${c.map((x) => x.kind)}`);
			assert.equal(c.length, 3);
		}
		// Same with a free artifact slot: artifacts fill the offer, embers stay out.
		h.weapons.set('frost', { lvl: MAX_LEVEL, t: 0, oc: 1 });
		h.passives.delete('regen');
		r.recalcMods(h);
		for (let k = 0; k < 30; k++) assert.ok(!r.makeChoices(h).some((x) => x.kind === 'ember'), 'free artifact slot: no embers');
		h.passives.set('regen', MAX_LEVEL);
		console.log('slots 6+4: ok');
	}

	// Pressure: invasions ring every player from 3:30 (not solo), enemy hp and damage grow after 3:00.
	{
		const duo = mkRoom(['knight', 'witch']);
		duo.time = 209;
		duo.events.next = Infinity;
		for (let i = 0; i < 2 * TICK_HZ && !duo.enemies.length; i++) duo.tick(dtt);
		assert.ok(duo.enemies.length >= 2 * 8, `invasion ring for both players: ${duo.enemies.length}`);
		const ring = duo.enemies.filter((e) => Math.abs(Math.hypot(e.x, e.y) - 430) < 40);
		assert.ok(ring.length >= 8, 'enemies stand on the ring');
		const solo = mkRoom();
		solo.time = 209;
		solo.events.next = Infinity; // v18: a Wave 4 event (the golden shade) would add an enemy here
		for (let i = 0; i < 2 * TICK_HZ; i++) solo.tick(dtt);
		assert.equal(solo.enemies.length, 0, 'no invasions solo');
		const e0 = solo.spawnEnemy('skel', [solo.heroes.get(1)], 1);
		solo.time = 780;
		const e1 = solo.spawnEnemy('skel', [solo.heroes.get(1)], 1);
		assert.ok(e1.dmg > e0.dmg * 1.5, 'enemy damage grows late');
		console.log('pressure invasions + scaling: ok');
	}

	// Crits: chance 1 doubles damage and marks the hit event; damage is counted per weapon.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		const e = put(r, 'brute', 300, 0);
		r.fx = [];
		r.hurtEnemy(e, 10, h, { weapon: 'knives', tags: ['phys', 'proj'] });
		assert.equal(e.hp, 990);
		assert.deepEqual(fxOf(r, 'hit')[0].slice(3), [10]);
		h.passives.set('crit', 5);
		r.recalcMods(h);
		assert.ok(Math.abs(h.mods.critChance - 0.3) < 1e-9, 'Острота: +6% per level');
		h.mods.critChance = 1;
		r.fx = [];
		r.hurtEnemy(e, 10, h, { weapon: 'knives', tags: ['phys', 'proj'] });
		assert.equal(e.hp, 970, 'crit ×2');
		assert.deepEqual(fxOf(r, 'hit')[0].slice(3), [20, 1, 1], 'crit flag and owner');
		assert.equal(Math.round(h.dmgBy.knives), 30);
		console.log('crits: ok');
	}

	// Sickle: hits on the way out and again on the way back, then returns to the owner.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		only(h, 'sickle');
		const e = put(r, 'brute', 150, 0);
		r.fx = [];
		let shot = null;
		for (let i = 0; i < 3 * TICK_HZ; i++) {
			r.tick(dtt);
			shot ??= r.fx.find((f) => f[0] === 'shot');
			if (r.projectiles.length === 0 && shot) break;
		}
		assert.ok(shot && shot.length === 12 && shot[10] === 1, 'sickle shot carries owner and out time');
		assert.ok(1000 - e.hp >= 24, `sickle hits twice: ${1000 - e.hp}`);
		console.log('weapon sickle: ok');
	}

	// Petard: lob, then a blast after the fuse in the densest group.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		only(h, 'bomb');
		const lone = put(r, 'brute', -200, 0);
		const pack = [put(r, 'brute', 200, 0), put(r, 'brute', 220, 10), put(r, 'brute', 205, -15)];
		r.tick(dtt);
		const lob = r.fx.find((f) => f[0] === 'lob') ?? sent.flatMap(([, m]) => m.t === 's' ? m.fx : []).find((f) => f[0] === 'lob');
		assert.ok(r.blasts.length === 1, 'bomb thrown');
		assert.ok(r.blasts[0].x > 150, 'aimed at the pack');
		for (let i = 0; i < TICK_HZ; i++) r.tick(dtt);
		for (const e of pack) assert.ok(e.hp < 1000, 'pack damaged');
		assert.equal(lone.hp, 1000, 'lone enemy untouched');
		void lob;
		console.log('weapon bomb: ok');
	}

	// Frost: damage + slow; level 5 freezes (no contact damage, frozen bit in the snapshot).
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		only(h, 'frost', 5);
		const e = put(r, 'ghoul', 60, 0);
		e.speed = 60;
		r.tick(dtt);
		assert.ok(e.hp < 1000 && e.slowT > r.time && e.frozenT > r.time, 'frost hits, slows, freezes');
		assert.equal(r.enemyState(e) & (ST.chill | ST.frozen), ST.chill | ST.frozen);
		e.x = 20; // touching the hero while frozen
		const hp = h.hp;
		r.tick(dtt);
		assert.equal(h.hp, hp, 'frozen enemies do not bite');
		const snap = r.snapshot();
		const i = snap.e.indexOf(e.id);
		assert.ok(i >= 0 && (snap.e[i + 5] & ST.frozen), 'frozen bit in snapshot');
		console.log('weapon frost: ok');
	}

	// Traps: laid behind a moving hero, catch the first enemy: damage + root.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		only(h, 'traps');
		h.lastPosT = 0;
		r.handle(1, { t: 'pos', x: 10, y: 0, fx: 1, fy: 0 });
		r.tick(dtt);
		assert.equal(r.traps.length, 1);
		assert.ok(r.traps[0].x < h.x - 10, 'trap behind the hero');
		const e = put(r, 'ghoul', r.traps[0].x, r.traps[0].y + 4);
		e.speed = 60;
		r.time += 0.5;
		r.fx = [];
		r.tick(dtt);
		assert.equal(r.traps.length, 0, 'trap used');
		assert.ok(e.hp < 1000 && e.rootT > r.time, 'damage + root');
		assert.ok(r.enemyState(e) & ST.root);
		assert.ok(r.snapshot().fx.some((f) => f[0] === 'snap'));
		console.log('weapon traps: ok');
	}

	// Artifacts: Echo adds projectiles and orbit blades, Hourglass lengthens puddles, Mail blocks damage.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		only(h, 'knives');
		put(r, 'brute', 200, 0);
		const knives = () => {
			r.fx = [];
			h.weapons.get('knives').t = 0;
			r.updateWeapon(h, 'knives', h.weapons.get('knives'), dtt);
			return r.fx.filter((f) => f[0] === 'shot').length;
		};
		assert.equal(knives(), 1);
		h.passives.set('echo', 1);
		r.recalcMods(h);
		assert.equal(knives(), 2, 'Эхо 1: +1');
		h.passives.set('echo', 4);
		r.recalcMods(h);
		assert.equal(knives(), 3, 'Эхо 4: +2');
		h.weapons.set('orbit', { lvl: 1, t: 0 });
		const row = r.snapshot().p.find((p) => p[0] === 1);
		assert.deepEqual(row[12].find((w) => w[0] === 'orbit'), ['orbit', 1, 2], 'orbit extra blades in snapshot');

		only(h, 'flask');
		r.updateWeapon(h, 'flask', h.weapons.get('flask'), dtt);
		const plain = r.puddles.at(-1).life;
		h.passives = new Map([['hourglass', 5]]);
		r.recalcMods(h);
		h.weapons.get('flask').t = 0;
		r.updateWeapon(h, 'flask', h.weapons.get('flask'), dtt);
		assert.ok(Math.abs(r.puddles.at(-1).life - plain * 1.6) < 1e-9, 'Песочные часы 5: ×1.6');

		h.passives = new Map([['mail', 3]]);
		r.recalcMods(h);
		h.hp = 100;
		r.hurtPlayer(h, 10);
		assert.equal(h.hp, 93, 'Кольчуга 3: −3');
		h.iframes = 0;
		r.hurtPlayer(h, 2);
		assert.equal(h.hp, 92, 'at least 1 damage');
		console.log('artifacts echo/hourglass/mail: ok');
	}

	// Spitter: winds up, spits; the blob hits a standing player and misses one who steps aside.
	{
		const run = (dodge) => {
			const r = mkRoom();
			const h = r.heroes.get(1);
			h.weapons = new Map();
			const e = put(r, 'spitter', 290, 0, 1000);
			e.speed = ENEMIES.spitter.speed;
			e.shotT = 0;
			let wind = false, shot = false, hurt = false;
			for (let i = 0; i < 3 * TICK_HZ; i++) {
				if (dodge && shot) {
					h.lastPosT = r.time - 0.1;
					r.handle(1, { t: 'pos', x: h.x, y: h.y + 150 * dtt, fx: 0, fy: 1 });
				}
				r.fx = [];
				r.tick(dtt);
				wind ||= (r.enemyState(e) & ST.windup) !== 0;
				shot ||= r.fx.some((f) => f[0] === 'eshot');
				hurt ||= r.fx.some((f) => f[0] === 'hurt');
			}
			return { wind, shot, hurt };
		};
		const still = run(false);
		assert.ok(still.wind && still.shot && still.hurt, `spitter hits a standing player ${JSON.stringify(still)}`);
		const moving = run(true);
		assert.ok(moving.shot && !moving.hurt, 'stepping aside dodges the blob');
		console.log('spitter + hostile shots: ok');
	}

	// Bloater: contact lights a fuse, blast hurts players and enemies; killing it leaves a delayed blast.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		h.weapons = new Map();
		const b = put(r, 'bloater', 20, 0, 10);
		const other = put(r, 'brute', 40, 30, 1000);
		r.tick(dtt);
		assert.ok(b.fuseT > 0 && (r.enemyState(b) & ST.windup), 'fuse lit on contact');
		const hp = h.hp;
		r.fx = [];
		for (let i = 0; i < TICK_HZ; i++) r.tick(dtt);
		assert.ok(b.dead, 'bloater blew up');
		assert.ok(hp - h.hp >= ENEMIES.bloater.blastDmg * b.dmgMul - 0.01, 'player hurt by the blast');
		assert.equal(other.hp, 1000 - ENEMIES.bloater.blastEnemyDmg, 'enemies hurt by the blast');
		const b2 = put(r, 'bloater', 300, 0, 10);
		r.fx = [];
		r.hurtEnemy(b2, 50, h);
		assert.ok(r.fx.some((f) => f[0] === 'warn') && r.blasts.length === 1, 'kill leaves a telegraphed blast');
		for (let i = 0; i < TICK_HZ; i++) r.tick(dtt);
		assert.equal(r.blasts.length, 0);
		console.log('bloater: ok');
	}

	// Breakable props and pickups.
	{
		const r = mkRoom(['knight', 'witch']);
		const [h, h2] = [r.heroes.get(1), r.heroes.get(2)];
		let prop = null;
		for (let tx = -6; tx <= 6 && !prop; tx++) for (let ty = -6; ty <= 6 && !prop; ty++) prop = breakableAt(tx, ty);
		assert.ok(prop, 'props exist');
		let props = 0;
		for (let tx = -20; tx < 20; tx++) for (let ty = -20; ty < 20; ty++) if (breakableAt(tx, ty)) props++;
		assert.ok(props > 300 && props < 500, `prop density ~25%: ${props}`);
		r.fx = [];
		r.breakAround(prop.x, prop.y, 5, h);
		assert.ok(r.fx.some((f) => f[0] === 'brk' && f[1] === prop.tx && f[2] === prop.ty));
		const items0 = r.items.length;
		r.fx = [];
		r.breakAround(prop.x, prop.y, 5, h);
		assert.equal(r.fx.length, 0, 'breaks once');
		assert.ok(r.startMsg().broken.length === 2, 'broken props resent on reconnect');
		void items0;
		const pick = (type, setup = () => {}) => {
			r.items = [];
			const it = r.dropItem(type, h.x, h.y);
			setup();
			r.fx = [];
			r.updateItems(dtt, [h, h2]);
			assert.equal(r.items.length, 0, `${type} picked`);
			assert.ok(r.fx.some((f) => f[0] === 'item' && f[2] === it.type));
		};
		h.hp = 10;
		pick('dew');
		assert.equal(h.hp, 10 + ITEMS.dew.heal);
		const rr = h.rerolls;
		pick('feather');
		assert.equal(h.rerolls, rr + 1);
		h2.x = 100;
		pick('rage');
		assert.ok(h.rageT > r.time && h2.rageT > r.time, 'rage for allies nearby');
		r.gems = [{ id: 1, x: 2000, y: 0, xp: 5, gold: false, pull: null }];
		pick('magnet');
		assert.equal(r.gems[0].pull, h, 'magnet pulls every gem');
		r.enemies.length = 0; // only the two below: a kill that drops an item (an elite, the golden shade) would fail the check
		r.events.next = Infinity;
		const e1 = put(r, 'skel', 200, 0, 30), boss = put(r, 'boss', 300, 0, 1000);
		boss.boss = true;
		h.hp = h.maxHp; // a low-hp kill may drop «Чаша росы» (DEW_DROP) and leave an item behind
		pick('cracker');
		assert.ok(e1.dead && Math.abs(boss.hp - 900) < 1e-6, 'cracker: kills small, −10% to big');
		const e2 = put(r, 'skel', 200, 0);
		pick('slowtime');
		assert.ok(e2.slowT > r.time + 5 && e2.slow === ITEMS.slowtime.slow);
		sent.length = 0;
		h.offer = null;
		pick('chest');
		assert.ok(lastOffer(), 'chest gives an offer');
		console.log('props + pickups: ok');
	}

	// Elites and their reward.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		h.weapons = new Map();
		const e = put(r, 'skel', 300, 0, 100);
		r.fx = [];
		const el = r.makeElite([h]);
		assert.equal(el, e);
		assert.equal(e.maxHp, 100 * ELITE_HP_MUL);
		assert.ok(r.enemyState(e) & ST.elite);
		assert.ok(r.fx.some((f) => f[0] === 'elite' && f[1] === e.id && f[2] >= 0 && f[2] < ELITE_AFFIXES.length));
		const rnd = Math.random;
		Math.random = () => 0.01;
		try {
			r.hurtEnemy(e, 1e9, h);
		} finally {
			Math.random = rnd;
		}
		assert.ok(r.items.some((it) => ITEM_TYPES[it.type] === 'chest'), 'elite drops a chest');
		const e2 = put(r, 'skel', 300, 0, 100);
		r.setElite(e2, 'armored');
		const hp = e2.hp;
		r.hurtEnemy(e2, 10, h, { weapon: 'knives', tags: ['proj'] });
		r.hurtEnemy(e2, 10, h, { weapon: 'aura', tags: ['aoe'] });
		assert.equal(hp - e2.hp, 15, 'armored elite: −50% from projectiles');
		Math.random = () => 0.99;
		try {
			r.gems = [];
			r.hurtEnemy(e2, 1e9, h);
		} finally {
			Math.random = rnd;
		}
		assert.ok(r.gems.some((g) => g.gold) && r.snapshot().g.includes(3), 'otherwise a gold gem (tier 3)');
		// A gold gem from a regular kill is worth GOLD_GEM_MUL times its xp (it used to drop with plain xp).
		{
			const rg = mkRoom();
			const hg = rg.heroes.get(1);
			rg.gems = [];
			const orig = Math.random;
			Math.random = () => 0;
			try {
				const e = rg.spawnEnemy('ghoul', [hg], 1);
				rg.killEnemy(e, hg);
				const gem = rg.gems.find((g) => g.gold);
				assert.ok(gem && gem.xp === ENEMIES.ghoul.xp * C.GOLD_GEM_MUL, `gold gem xp ×${C.GOLD_GEM_MUL}: ${gem?.xp}`);
			} finally {
				Math.random = orig;
			}
		}
		// Elites start at 4:00.
		const r2 = mkRoom();
		r2.time = 230;
		for (let i = 0; i < 3; i++) put(r2, 'skel', 200 + i * 40, 0);
		for (let i = 0; i < 9 * TICK_HZ; i++) r2.tick(dtt);
		assert.equal(r2.enemies.filter((x) => x.elite).length, 0, 'no elites before 4:00');
		for (let i = 0; i < 2 * TICK_HZ; i++) r2.tick(dtt);
		assert.equal(r2.enemies.filter((x) => x.elite).length, 1, 'elite at 4:00');
		console.log('elites + small chest: ok');
	}

	// G1: at the gem cap the farthest gem folds into the new one; far gems are swept next to the player.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		r.gems = [];
		for (let i = 0; i < MAX_GEMS; i++) r.gems.push({ id: 10000 + i, x: 100 + i, y: 50, xp: 1, gold: false, pull: null });
		r.gems[7].x = 5000;
		r.gems[7].xp = 40;
		r.dropGem(30, 30, 2);
		assert.equal(r.gems.length, MAX_GEMS);
		assert.ok(!r.gems.some((g) => g.x === 5000), 'farthest gem folded');
		const total = r.gems.reduce((s, g) => s + g.xp, 0);
		assert.equal(total, MAX_GEMS - 1 + 40 + 2, 'no xp lost');
		r.gems = [
			{ id: 1, x: 3000, y: 0, xp: 7, gold: false, pull: null },
			{ id: 2, x: 3200, y: 100, xp: 5, gold: true, pull: null },
			{ id: 3, x: 50, y: 0, xp: 1, gold: false, pull: null },
		];
		r.sweepFarGems([h]);
		assert.equal(r.gems.length, 2);
		const big = r.gems.find((g) => g.xp === 12);
		assert.ok(big && !big.gold && Math.abs(Math.hypot(big.x - h.x, big.y - h.y) - 450) < 1, 'swept to the edge of the view');
		// Brutes drop «Зов углей» once per two minutes.
		r.time = 200;
		r.nextMagnetT = 120;
		r.items = [];
		r.hurtEnemy(put(r, 'brute', 300, 0, 5), 99, h);
		r.hurtEnemy(put(r, 'brute', 300, 0, 5), 99, h);
		assert.equal(r.items.filter((it) => ITEM_TYPES[it.type] === 'magnet').length, 1);
		console.log('G1 gems: ok');
	}
}

// --- duos (5.8): rules and every pair ---
{
	const dtt = 1 / TICK_HZ;
	const sent = [];
	const mkRoom = (heroes = ['knight']) => {
		sent.length = 0;
		const r = new Room('DUO', (pid, msg) => sent.push([pid, msg]));
		heroes.forEach((hero, i) => r.addPlayer(i + 1, `D${i + 1}`, hero));
		r.start();
		r.spawn = () => {};
		r.nextInvasionT = Infinity;
		r.nextEliteT = Infinity;
		for (const h of r.heroes.values()) { h.x = 0; h.y = 0; h.hp = h.maxHp = 1e6; }
		return r;
	};
	const put = (r, type, x, y, hp = 1e5) => {
		const e = r.spawnEnemy(type, [...r.heroes.values()], 1);
		e.x = x; e.y = y; e.hp = e.maxHp = hp; e.speed = 0; e.dmg = 0;
		return e;
	};
	const lastOffer = (pid = 1) => sent.filter(([p, m]) => p === pid && m.t === 'lvl').at(-1)?.[1];
	const fxAll = [];
	const run = (r, sec, each) => {
		for (let i = 0; i < sec * TICK_HZ; i++) {
			r.fx = [];
			const n0 = sent.length;
			r.tick(dtt);
			// A snapshot sent in this tick took the events with it.
			for (const [pid, m] of sent.slice(n0)) if (pid === 1 && m.t === 's') fxAll.push(...m.fx);
			fxAll.push(...r.fx);
			each?.();
		}
	};
	const take = (kind) => { const out = fxAll.filter((f) => f[0] === kind); return out; };
	const duo = (r, id, lvl = 1) => { const h = r.heroes.get(1); h.weapons = new Map([[id, { lvl, t: 0 }]]); r.updateSynergy(); return h; };

	assert.equal(DUO_IDS.length, 16, '13 duos of the plan + 3 for Spear and Trail (wave 2)');
	for (const [key, id] of Object.entries(DUO_BY_PAIR)) assert.equal(duoKey(...DUOS[id].parts), key);

	// Rules: card in slot 1 at 3 + 3, start level by sum, fusing frees a slot, parts are not offered again.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		h.weapons = new Map([['whip', { lvl: 2, t: 0 }], ['lightning', { lvl: 3, t: 0 }], ['bolt', { lvl: 1, t: 0 }]]);
		assert.ok(!r.makeChoices(h).some((c) => c.kind === 'duo'), 'no duo below 3 + 3');
		const hinted = r.makeChoices(h).concat(r.makeChoices(h), r.makeChoices(h)).filter((c) => c.duoHint);
		assert.ok(hinted.length > 0 && hinted.every((c) => c.duoHint.need === 3), 'pair hint on cards');
		h.weapons.get('whip').lvl = 4;
		const c = r.makeChoices(h);
		assert.equal(c[0].kind, 'duo', 'duo card in slot 1');
		assert.equal(c[0].id, 'thunderslash');
		assert.equal(c[0].level, 1, '4 + 3 = 7 → I');
		h.weapons.get('whip').lvl = 5;
		assert.equal(r.makeChoices(h)[0].level, 2, '5 + 3 = 8 → II');
		h.weapons.get('lightning').lvl = 5;
		assert.equal(r.makeChoices(h)[0].level, 3, '5 + 5 = 10 → III');
		// Decline: comes back after 2 offers (high level so the +10 xp does not open a new offer).
		h.level = 30;
		h.offer = r.makeChoices(h);
		r.handle(1, { t: 'skip' });
		assert.ok(!r.makeChoices(h).some((x) => x.kind === 'duo'), 'declined duo hides for the next offer');
		assert.ok(r.makeChoices(h).some((x) => x.kind === 'duo') || r.makeChoices(h).some((x) => x.kind === 'duo'), 'and comes back');
		h.offer = r.makeChoices(h);
		assert.equal(h.offer[0].kind, 'duo');
		r.fx = [];
		r.handle(1, { t: 'pick', i: 0 });
		assert.deepEqual([...h.weapons.keys()], ['thunderslash', 'bolt'], 'duo takes the first slot, the second is freed');
		assert.equal(h.weapons.get('thunderslash').lvl, 3);
		assert.ok(r.fx.some((f) => f[0] === 'duo' && f[1] === 1 && f[2] === 'thunderslash'), 'duo event');
		assert.ok(Math.abs(r.synergy - SYNERGY_PER) < 1e-9, '«Слаженность» +4%');
		for (let k = 0; k < 50; k++) for (const x of r.makeChoices(h)) assert.ok(!(x.kind === 'weapon' && ['whip', 'lightning'].includes(x.id)), 'fused parts are not offered');
		// Limit: 2 duos.
		h.weapons = new Map([['thunderslash', { lvl: 1, t: 0 }], ['orb', { lvl: 1, t: 0 }], ['bomb', { lvl: 5, t: 0 }], ['frost', { lvl: 5, t: 0 }]]);
		assert.ok(!r.makeChoices(h).some((x) => x.kind === 'duo'), 'no third duo');
		// Duo upgrades stop at III.
		h.weapons = new Map([['orb', { lvl: 2, t: 0 }]]);
		const up = r.makeChoices(h).find((x) => x.id === 'orb');
		assert.ok(up && up.level === 3);
		h.weapons.get('orb').lvl = 3;
		assert.ok(!r.makeChoices(h).some((x) => x.id === 'orb'), 'no upgrade past III');
		// Same duo twice in the team counts once.
		const r2 = mkRoom(['knight', 'witch', 'ranger']);
		r2.heroes.get(1).weapons = new Map([['orb', { lvl: 1, t: 0 }]]);
		r2.heroes.get(2).weapons = new Map([['orb', { lvl: 1, t: 0 }]]);
		r2.heroes.get(3).weapons = new Map([['censer', { lvl: 1, t: 0 }]]);
		r2.updateSynergy();
		assert.ok(Math.abs(r2.synergy - 2 * SYNERGY_PER) < 1e-9, 'unique duos only');
		console.log('duo rules: ok');
	}

	// 1. Громовой разрез: both sides, rods struck from the sky 0.3 s later, a fan every 3rd swing.
	{
		const r = mkRoom();
		const h = duo(r, 'thunderslash');
		const left = put(r, 'brute', -100, 0), right = put(r, 'brute', 100, 0);
		fxAll.length = 0;
		run(r, 2.5);
		assert.ok(left.hp < 1e5 && right.hp < 1e5, 'both sides');
		assert.ok(take('tslash').length >= 3, 'swings');
		assert.ok(take('zap').some((z) => z[2] === z[4] - 320), 'rod struck from the sky');
		assert.ok(take('tfan').length >= 1, 'fan on the 3rd swing');
		assert.ok(h.dmgBy.thunderslash > 0);
		console.log('duo thunderslash: ok');
	}
	// 2. Шаровая молния: slow orb pulses, then explodes.
	{
		const r = mkRoom();
		duo(r, 'orb');
		const e = put(r, 'brute', 250, 0);
		fxAll.length = 0;
		run(r, 6);
		assert.ok(take('orb').length >= 1 && take('orb')[0].length === 10);
		assert.ok(take('boom').some((b) => b[4] === 3), 'orb explodes');
		assert.ok(e.hp < 1e5 - 50);
		console.log('duo orb: ok');
	}
	// 3. Планетарий: a spark leaves the orbit at an enemy in range and comes back later.
	{
		const r = mkRoom();
		const h = duo(r, 'orrery');
		put(r, 'brute', 200, 0);
		fxAll.length = 0;
		run(r, 0.5);
		assert.ok(take('shot').length >= 1, 'spark launched');
		const w = h.weapons.get('orrery');
		const row = r.snapshot().p[0][12][0];
		assert.equal(row[0], 'orrery');
		assert.ok(row[3] !== (1 << DUOS.orrery.levels[0].count) - 1, 'mask shows the empty slot');
		void w;
		console.log('duo orrery: ok');
	}
	// 4. Мельница: long blades hit and knock back.
	{
		const r = mkRoom();
		duo(r, 'windmill');
		const e = put(r, 'brute', 150, 0);
		run(r, 2);
		assert.ok(e.hp < 1e5 && Math.hypot(e.x, e.y) > 150, 'hit and knocked back');
		console.log('duo windmill: ok');
	}
	// 5. Растяжка: a wire between traps cuts; a missed knife becomes a spike.
	{
		const r = mkRoom();
		const h = duo(r, 'tripwire');
		r.layTrap(h, { x: -100, y: 60, r: 28, dmg: 1, max: 6, src: undefined });
		r.layTrap(h, { x: 100, y: 60, r: 28, dmg: 1, max: 6 });
		const e = put(r, 'brute', 0, 60);
		r.time += 1;
		const hp0 = e.hp;
		run(r, 0.4);
		assert.ok(e.hp < hp0, 'wire hits the enemy between traps');
		// Its traps re-arm instead of vanishing, so the thread net survives a crowd.
		const t0 = r.traps.length;
		r.layTrap(h, { x: 0, y: -80, r: 28, dmg: 5, max: 6, rearm: 2.5 });
		const victim = put(r, 'brute', 0, -80);
		r.time += 1;
		run(r, 0.2);
		assert.ok(victim.hp < 1e5 && r.traps.length >= t0 + 1, 'tripwire trap stays after it bites');
		const r2 = mkRoom();
		duo(r2, 'tripwire');
		run(r2, 1.5);
		assert.ok(r2.traps.some((t) => t.kind === 3), 'missed knives become spikes');
		console.log('duo tripwire: ok');
	}
	// 6. Возвратный веер: knives come back and hit twice.
	{
		const r = mkRoom();
		duo(r, 'fanback');
		const e = put(r, 'brute', 150, 0);
		fxAll.length = 0;
		run(r, 1.2);
		assert.ok(take('shot').some((s) => s.length === 12 && s[2] === 1), 'returning knives');
		assert.ok(1e5 - e.hp >= 2 * 14 - 0.01, 'hit on both legs');
		console.log('duo fanback: ok');
	}
	// 7. Коктейль: blast + burning pool.
	{
		const r = mkRoom();
		duo(r, 'molotov');
		const e = put(r, 'brute', 200, 0);
		fxAll.length = 0;
		run(r, 2);
		assert.ok(take('lob').some((l) => l[8] === 1) && take('zk').some((z) => z[2] === 1), 'lob + fire pool');
		assert.ok(1e5 - e.hp > 30, 'blast and pool damage');
		console.log('duo molotov: ok');
	}
	// 8. Минное поле: a mine blows up and recharges instead of vanishing.
	{
		const r = mkRoom();
		const h = duo(r, 'minefield');
		r.layTrap(h, { kind: 1, x: 120, y: 0, r: 26, dmg: 45, blastR: 80, kb: 60, recharge: 6, max: 5 });
		r.time += 1;
		const e = put(r, 'brute', 120, 0);
		fxAll.length = 0;
		run(r, 0.2);
		assert.ok(take('boom').some((b) => b[4] === 5) && e.hp < 1e5, 'mine blast');
		const snap = r.snapshot();
		let recharging = false;
		for (let i = 0; i < snap.tr.length; i += 5) if (snap.tr[i + 3] === 2) recharging = true;
		assert.ok(recharging, 'mine stays and recharges');
		console.log('duo minefield: ok');
	}
	// 9. Ледяная граната: freeze, then shards.
	{
		const r = mkRoom();
		duo(r, 'icebomb');
		const e = put(r, 'brute', 200, 0);
		let frozen = false;
		fxAll.length = 0;
		run(r, 2, () => { frozen ||= e.frozenT > r.time; });
		assert.ok(frozen && take('shard').length >= 1, 'freeze + shards');
		console.log('duo icebomb: ok');
	}
	// 10. Полярное сияние: cold aura, a freezing ring every 3 s.
	{
		const r = mkRoom();
		duo(r, 'aurora');
		const e = put(r, 'brute', 80, 0), far = put(r, 'brute', 200, 0);
		let chilled = false, frozenFar = false;
		fxAll.length = 0;
		run(r, 3.5, () => { chilled ||= e.slowT > r.time; frozenFar ||= far.frozenT > r.time; });
		assert.ok(chilled && e.hp < 1e5, 'aura chills and hurts');
		assert.ok(frozenFar && take('frost').some((f) => f[2] === 220), 'ring to 2r freezes');
		console.log('duo aurora: ok');
	}
	// 11. Кадило: clouds hurt enemies and heal allies (not the owner).
	{
		const r = mkRoom(['herald', 'knight']);
		const [h, ally] = [r.heroes.get(1), r.heroes.get(2)];
		duo(r, 'censer');
		const e = put(r, 'brute', 0, 0);
		ally.hp = 100;
		h.hp = 100;
		run(r, 1);
		assert.ok(e.hp < 1e5 && ally.hp > 101 && h.hp === 100, 'damage enemies, heal allies');
		console.log('duo censer: ok');
	}
	// 12. Ледяной диск: ice trail slows, the way back freezes.
	{
		const r = mkRoom();
		duo(r, 'icedisc');
		const e = put(r, 'brute', 150, 0);
		let frozen = false;
		fxAll.length = 0;
		run(r, 2, () => { frozen ||= e.frozenT > r.time; });
		assert.ok(take('shot').some((s) => s[2] === PROJECTILE_KINDS.indexOf('icedisc') && s.length === 12));
		assert.ok(r.puddles.some((z) => z.hidden && z.slow > 0) || frozen, 'ice trail');
		assert.ok(frozen, 'frozen on the way back');
		console.log('duo icedisc: ok');
	}
	// Herald keeps healing allies with Aurora instead of Aura.
	{
		const r = mkRoom(['herald', 'knight']);
		const [h, ally] = [r.heroes.get(1), r.heroes.get(2)];
		h.weapons = new Map([['aurora', { lvl: 1, t: 0 }]]);
		ally.x = 40;
		ally.hp = 100;
		run(r, 1);
		assert.ok(ally.hp > 100.9, 'herald trait works with Aurora');
		console.log('duo herald trait: ok');
	}
}

// --- wave 3: team XP, evolutions, new weapons, embers, control caps ---
{
	const dtt = 1 / TICK_HZ;
	const sent = [];
	const mkRoom = (heroes = ['knight']) => {
		sent.length = 0;
		const r = new Room('EVO', (pid, msg) => sent.push([pid, msg]));
		heroes.forEach((hero, i) => r.addPlayer(i + 1, `E${i + 1}`, hero));
		r.start();
		r.spawn = () => {};
		r.nextInvasionT = Infinity;
		r.nextEliteT = Infinity;
		for (const h of r.heroes.values()) { h.x = 0; h.y = 0; h.hp = h.maxHp = 1e6; }
		return r;
	};
	const put = (r, type, x, y, hp = 1e5) => {
		const e = r.spawnEnemy(type, [...r.heroes.values()], 1);
		e.x = x; e.y = y; e.hp = e.maxHp = hp; e.speed = 0; e.dmg = 0;
		return e;
	};
	const fxAll = [];
	const run = (r, sec, each) => {
		for (let i = 0; i < sec * TICK_HZ; i++) {
			r.fx = [];
			const n0 = sent.length;
			r.tick(dtt);
			for (const [pid, m] of sent.slice(n0)) if (pid === 1 && m.t === 's') fxAll.push(...m.fx);
			fxAll.push(...r.fx);
			each?.();
		}
	};
	const take = (kind) => fxAll.filter((f) => f[0] === kind);
	const only = (r, id, lvl = 1) => { const h = r.heroes.get(1); h.weapons = new Map([[id, { lvl, t: 0 }]]); return h; };

	// Team XP: a gem gives its full XP to everyone, the downed included; the threshold scales so solo is unchanged.
	{
		assert.equal(xpForNext(5, 1), 5 + 4 * 8, 'solo threshold unchanged');
		assert.ok(Math.abs(teamXpMul(4) - 4 / 1.9) < 1e-9);
		const r = mkRoom(['knight', 'witch', 'ranger']);
		const [a, b, c] = [1, 2, 3].map((pid) => r.heroes.get(pid));
		for (const x of [a, b, c]) x.level = 30;
		r.hurtPlayer(c, 1e9);
		c.ward = 0;
		const before = [a.xp, b.xp, c.xp];
		r.collectGem(a, 10);
		assert.deepEqual([a.xp - before[0], b.xp - before[1], c.xp - before[2]], [10, 10, 10], 'everyone gets the full gem');
		const snap = r.snapshot();
		assert.equal(snap.p[0][7], xpForNext(30, 3), 'snapshot shows the team threshold');
		console.log('team xp: ok');
	}

	// Control caps: refreeze immunity after a thaw, knockback at most once per second.
	{
		const r = mkRoom();
		const e = put(r, 'brute', 100, 0);
		assert.ok(r.freeze(e, 0.5));
		r.time += 0.6;
		assert.ok(!r.freeze(e, 0.5), 'just thawed: immune');
		r.time += 1.5;
		assert.ok(r.freeze(e, 0.5), 'immunity wears off');
		const x0 = e.x;
		r.knock(e, 0, 0, 20);
		r.knock(e, 0, 0, 20);
		assert.equal(e.x, x0 + 20, 'one knockback per second');
		console.log('control caps: ok');
	}

	// Evolution card: weapon 5 + artifact → slot 1; picking replaces the weapon, the artifact stays.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		h.level = 30;
		h.weapons = new Map([['bolt', { lvl: 4, t: 0 }], ['whip', { lvl: 2, t: 0 }]]);
		h.passives = new Map([['echo', 1]]);
		r.recalcMods(h);
		assert.ok(!r.makeChoices(h).some((c) => c.kind === 'evo'), 'no evolution below level 5');
		h.weapons.get('bolt').lvl = 5;
		h.passives = new Map();
		assert.ok(!r.makeChoices(h).some((c) => c.kind === 'evo'), 'no evolution without the artifact');
		h.passives = new Map([['echo', 1]]);
		h.offer = r.makeChoices(h);
		assert.equal(h.offer[0].kind, 'evo');
		assert.equal(h.offer[0].id, 'swarm');
		r.fx = [];
		r.handle(1, { t: 'pick', i: 0 });
		assert.deepEqual([...h.weapons.keys()], ['swarm', 'whip'], 'evolution takes the weapon slot');
		assert.ok(h.passives.has('echo'));
		assert.ok(r.fx.some((f) => f[0] === 'evo' && f[2] === 'swarm'));
		for (let k = 0; k < 50; k++) for (const c of r.makeChoices(h)) assert.ok(!(c.kind === 'weapon' && c.id === 'bolt'), 'evolved weapon is not offered again');
		// Declined evolutions come back after 2 offers.
		const r2 = mkRoom();
		const h2 = r2.heroes.get(1);
		h2.level = 30;
		h2.weapons = new Map([['whip', { lvl: 5, t: 0 }]]);
		h2.passives = new Map([['might', 1]]);
		r2.recalcMods(h2);
		h2.offer = r2.makeChoices(h2);
		r2.handle(1, { t: 'skip' });
		assert.ok(!r2.makeChoices(h2).some((c) => c.kind === 'evo'));
		assert.ok(r2.makeChoices(h2).some((c) => c.kind === 'evo') || r2.makeChoices(h2).some((c) => c.kind === 'evo'));
		// A duo part cannot evolve, an evolved weapon cannot join a duo.
		h2.weapons = new Map([['crescent', { lvl: 1, t: 0 }], ['lightning', { lvl: 5, t: 0 }]]);
		assert.ok(!r2.makeChoices(h2).some((c) => c.kind === 'duo'), 'no duo with an evolved weapon');
		for (const id of EVO_IDS) assert.ok(PASSIVES[EVOS[id].requires] && WEAPONS[EVOS[id].from], `${id} parts exist`);
		console.log('evolution card: ok');
	}

	// Embers: a small permanent bonus per pick, stacking.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		h.hp = h.maxHp = 100;
		h.baseHp = 100;
		h.offer = r.emberCards(h, 3);
		r.handle(1, { t: 'pick', i: 0 });
		h.offer = r.emberCards(h, 3);
		r.handle(1, { t: 'pick', i: 0 });
		assert.ok(Math.abs(h.mods.dmgMul - 1.1) < 1e-9, 'two embers of rage: +10%');
		h.offer = r.emberCards(h, 3);
		r.handle(1, { t: 'pick', i: 2 });
		assert.equal(h.maxHp, 115);
		console.log('embers: ok');
	}

	// v15: luck artifacts have a combat side, ember without fire burns on every hit, ball lightning homes in.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		h.passives = new Map([['luck', 2], ['clover', 3]]);
		r.recalcMods(h);
		assert.ok(Math.abs(h.mods.critChance - 0.08) < 1e-9, 'Подкова 2: +8% crit');
		assert.ok(Math.abs(h.mods.dmgMul - 1.15) < 1e-9, 'Клевер 3: +15% damage');
		h.passives = new Map([['ember', 1]]);
		r.recalcMods(h);
		r.spawn = () => {};
		const burnOf = (fire) => {
			h.weapons = new Map([[fire ? 'bomb' : 'whip', { lvl: 1, t: 9 }]]);
			r.updateCombos(h);
			let n = 0;
			for (let k = 0; k < 200; k++) {
				const e = r.spawnEnemy('brute', [h], 100);
				r.hurtEnemy(e, 1, h, { weapon: 'whip', tags: ['phys'] });
				if (e.burnT > r.time) n++;
			}
			return n;
		};
		assert.equal(burnOf(false), 200, 'no fire weapon: every hit burns');
		const withFire = burnOf(true);
		assert.ok(withFire > 0 && withFire < 60, `fire weapon: the usual 8% chance (${withFire}/200)`);
		r.enemies.length = 0;
		// Homing: the orb turns toward the pack and tells clients with 'orbm'.
		h.x = h.y = 0;
		for (let i = 0; i < 6; i++) { const e = r.spawnEnemy('brute', [h], 100); e.x = 300 + i * 5; e.y = 0; e.speed = 0; }
		r.rebuildGrid();
		r.orbs = [{ id: 999, owner: h, x: 0, y: 0, tx: 0, ty: -300, speed: 200, life: 4, r: 70, dmg: 1, zap: 1, tick: 0.4, t: 0.4, boom: 0, boomR: 1, src: { weapon: 'orb', tags: ['shock', 'aoe'] }, aimT: 0 }];
		r.fx.length = 0;
		r.updateOrbs(1 / 30);
		assert.ok(r.orbs[0].tx > 250 && Math.abs(r.orbs[0].ty) < 20, 'orb re-aims at the pack');
		assert.ok(r.fx.some((f) => f[0] === 'orbm' && f[1] === 999), 'orbm fx sent');
		console.log('v15 artifacts + orb homing: ok');
	}

	// Every evolution works in place of its weapon.
	const evoHits = {
		swarm: (r) => take('shot').length > 6,
		crescent: (r) => take('crescent').length > 0,
		bladestorm: (r) => take('shot').length >= 6,
		millstones: () => true,
		tocsin: () => take('bell').length > 0,
		tempest: () => take('zap').length >= 5,
		moonblade: () => true,
		fireworks: () => take('lob').some((l) => l[8] === 3) && take('boom').some((b) => b[4] === 8),
		blizzard: () => take('frost').length > 0,
		pitfall: () => take('boom').some((b) => b[4] === 5),
		bastion: (r) => r.heroes.get(1).ward === 4,
		firepath: () => take('zk').length > 0,
		beacon: (r) => r.enemies.some((e) => e.beaconT > r.time),
		banner: () => take('banner').length > 0,
		quagmire: () => take('slowz').length > 0,
	};
	for (const id of EVO_IDS) {
		const r = mkRoom();
		const h = only(r, id);
		h.lastPosT = 0;
		r.handle(1, { t: 'pos', x: 5, y: 0, fx: 1, fy: 0 });
		const es = [];
		for (let i = 0; i < 8; i++) es.push(put(r, 'brute', Math.cos(i) * (60 + i * 25), Math.sin(i) * (60 + i * 25)));
		es.push(put(r, 'brute', 300, 0), put(r, 'brute', 0, 210), put(r, 'brute', -30, -45));
		fxAll.length = 0;
		let step = 0;
		// The fire path is laid only while moving.
		run(r, 4, id === 'firepath' ? () => r.handle(1, { t: 'pos', x: 5 + Math.sin(++step / 15) * 60, y: 0, fx: 1, fy: 0 }) : undefined);
		const hurt = es.filter((e) => e.hp < 1e5).length;
		assert.ok(id === 'bastion' || hurt > 0, `${id} hurts enemies`);
		assert.ok(evoHits[id](r), `${id} effect`);
		assert.ok(id === 'bastion' || h.dmgBy[id] > 0, `${id} damage is counted`);
	}
	console.log('evolutions x%d: ok', EVO_IDS.length);

	// New weapons.
	{
		// Lantern marks enemies in the cone: everyone's damage to them grows.
		const r = mkRoom();
		only(r, 'lantern');
		const e = put(r, 'brute', 120, 0);
		fxAll.length = 0;
		run(r, 0.6);
		assert.ok(take('cone').length > 0 && (r.enemyState(e) & ST.mark), 'lantern marks');
		const hp = e.hp;
		r.hurtEnemy(e, 100, r.heroes.get(2) ?? null, undefined);
		assert.ok(hp - e.hp > 100, 'marked enemy takes more damage');
		// Trail leaves burning fire on the path.
		const r2 = mkRoom();
		const h2 = only(r2, 'trail');
		const e2 = put(r2, 'brute', 0, 0);
		h2.lastPosT = 0;
		let burnt = false;
		run(r2, 1, () => { r2.handle(1, { t: 'pos', x: h2.x + (Math.random() - 0.5) * 6, y: 0, fx: 1, fy: 0 }); burnt ||= e2.burnT > r2.time; });
		assert.ok(burnt && e2.hp < 1e5, 'trail burns');
		// Spear goes for the toughest enemy and pierces a line.
		const r3 = mkRoom();
		only(r3, 'spear');
		const weak = put(r3, 'bat', 100, 0, 10), strong = put(r3, 'brute', -200, 0, 5000);
		const behind = put(r3, 'skel', -260, 0, 1000);
		run(r3, 1);
		assert.ok(strong.hp < 5000 && behind.hp < 1000 && weak.hp === 10, 'spear: toughest first, pierces');
		// Ward eats a hit and bursts when the last charge breaks.
		const r4 = mkRoom();
		const h4 = only(r4, 'ward');
		run(r4, 0.1);
		assert.equal(h4.ward, 1);
		const e4 = put(r4, 'skel', 60, 0, 1000);
		r4.rebuildGrid();
		const hp4 = h4.hp;
		fxAll.length = 0;
		r4.hurtPlayer(h4, 50);
		assert.equal(h4.hp, hp4, 'charge absorbs the hit');
		assert.equal(h4.ward, 0);
		assert.ok(e4.hp < 1000 && r4.fx.some((f) => f[0] === 'boom' && f[4] === 7), 'burst');
		assert.equal(r4.snapshot().p[0][13], 0);
		console.log('new weapons lantern/trail/spear/ward: ok');
	}
}

// --- bosses: schedule, telegraphs, mechanics ---
{
	const fxLog = [];
	const mk = (heroes = ['smith']) => {
		fxLog.length = 0;
		const r = new Room('BOSS', (pid, msg) => { if (msg.t === 's' && pid === 1) for (const f of msg.fx) fxLog.push([msg.tm, f]); });
		heroes.forEach((hero, i) => r.addPlayer(i + 1, `B${i + 1}`, hero));
		r.start();
		for (const h of r.heroes.values()) { h.x = 0; h.y = 0; h.weapons = new Map(); }
		return r;
	};
	const step = (r, sec, each) => {
		for (let i = 0; i < Math.round(sec * TICK_HZ); i++) {
			for (const h of r.heroes.values()) { h.hp = h.maxHp; r.handle(h.pid, { t: 'pos', x: h.x, y: h.y, fx: 1, fy: 0 }); }
			// A solo level-up offer pauses the room; decline it like a player would.
			for (const h of r.heroes.values()) while (h.offer) r.handle(h.pid, { t: 'skip' });
			each?.();
			r.tick(dt);
		}
	};
	const boss = (r, type, x = 300, y = 0) => {
		const b = r.spawnBoss(type, [...r.heroes.values()]);
		b.x = x;
		b.y = y;
		return b;
	};
	const firstFx = (kind, from = 0) => fxLog.find(([t, f]) => f[0] === kind && t >= from);

	// Schedule: 4 regular bosses in random order without repeats, then the Lord; hp grows with time and players.
	{
		const r = mk(['knight', 'witch']);
		const alive = [...r.heroes.values()];
		const order = [];
		for (const t of BOSS_TIMES.slice(0, 4)) {
			r.time = t;
			const before = r.bosses.length;
			r.spawn(0.001, alive);
			assert.equal(r.bosses.length, before + 1, `boss at ${t}`);
			order.push(ENEMY_TYPES[r.bosses.at(-1).type]);
		}
		assert.deepEqual([...order].sort(), [...BOSS_POOL].sort(), 'no repeats');
		// v21: the Lord comes 75 s before the end; his hp is the regular final-boss hp × FINALE.hpMul (finale-test.js
		// covers the finale itself: absorbing the bosses still alive, the arena, the win).
		assert.deepEqual(BOSS_TIMES, [180, 360, 540, 720, 825]);
		assert.equal(FINAL_BOSS.type, 'boss');
		assert.ok(bossHpScale(825, 2, 4) > bossHpScale(180, 2, 0) * 4, 'final is the strongest by the curve');
		assert.ok(bossHpScale(540, 4) > bossHpScale(540, 2) * 1.5 && bossHpScale(540, 2) > bossHpScale(540, 1) * 1.5, 'hp by players');
		assert.ok(r.runLog.bosses.length === 4 && r.runLog.bosses.every((b) => b.killedAt === null));
		// v15 log: damage dealt to a boss and seconds an alive player spent within 400 px of it.
		const h = alive[0], boss = r.bosses[0];
		boss.x = h.x + 100; boss.y = h.y;
		r.hurtEnemy(boss, 50, h, { weapon: 'whip', tags: [] });
		const t0 = r.time;
		for (let i = 1; i <= 30; i++) { r.time = t0 + i / 30; r.runLog.tick(r); }
		const lb = r.runLog.bosses[0];
		assert.ok(lb.dmg >= 50 && lb.by[h.name] >= 50, 'boss damage by player');
		assert.ok(Math.abs(lb.near - 1) < 0.05, `boss near seconds ${lb.near}`);
	}
	// Ram: a lane telegraph ≥ 0.6 s while standing still, then a fast dash.
	{
		const r = mk();
		const b = boss(r, 'ram');
		let x0 = null, tAim = null, tMove = null;
		step(r, 3, () => {
			if (b.bs === 'aim' && tAim === null) { tAim = r.time; x0 = b.x; }
			if (tAim !== null && tMove === null && b.x !== x0) tMove = r.time;
		});
		assert.ok(firstFx('bline'), 'lane fx');
		assert.ok(tMove - tAim >= 0.6, `ram telegraph ${tMove - tAim}`);
		assert.ok(Math.abs(b.x - x0) > 200, 'dashed');
	}
	// Gunner: windup glow ≥ 0.6 s, then a ring of 16 shards; standing in it hurts.
	{
		const r = mk();
		const b = boss(r, 'gunner');
		let tWind = null, glow = false;
		step(r, 6, () => {
			if (b.bs === 'wind' && tWind === null) tWind = r.time;
			if (b.windT > 0 && r.enemyState(b) & ST.windup) glow = true;
		});
		const shot = firstFx('eshot');
		assert.ok(glow && shot && shot[0] - tWind >= 0.6, 'gunner telegraph');
		assert.equal(fxLog.filter(([t, f]) => f[0] === 'eshot' && t === shot[0]).length, 16, 'ring of 16');
	}
	// Brood: warn circle, ×2 damage while calling, then a ring of bats.
	{
		const r = mk();
		const b = boss(r, 'brood');
		b.bcd = 0;
		r.spawn = () => {};
		const n0 = r.enemies.length;
		step(r, 0.2);
		assert.equal(b.bs, 'call');
		assert.ok(firstFx('warn'), 'call warn');
		assert.equal(r.hurtEnemy(b, 10, null), 20, 'vulnerable while calling');
		step(r, 1.5);
		assert.ok(r.enemies.filter((e) => ENEMY_TYPES[e.type] === 'bat').length >= 10 && r.enemies.length > n0, 'bats called');
	}
	// Twin: splits at half hp into two halves; the chest drops only after both; halves blink after a marked spot.
	{
		const r = mk();
		const b = boss(r, 'twin');
		r.spawn = () => {};
		b.hp = b.maxHp * 0.49;
		step(r, 0.1);
		const halves = r.bosses.filter((e) => ENEMY_TYPES[e.type] === 'twinhalf');
		assert.equal(halves.length, 2);
		assert.ok(b.dead && !r.bosses.includes(b));
		assert.ok(halves.every((h) => h.group === b.group && h.maxHp < b.maxHp * 0.5));
		const snapBar = r.snapshot().boss;
		assert.ok(snapBar[0] > halves[0].maxHp * 1.9 && snapBar[0] / snapBar[1] < 0.7 && ENEMY_TYPES[snapBar[2]] === 'twinhalf', 'one bar for both halves, continued');
		halves[0].x = 600;
		let tWarn = null, tJump = null, xBefore = halves[0].x;
		step(r, 5, () => {
			if (halves[0].bs === 'blink' && tWarn === null) tWarn = r.time;
			if (tWarn !== null && tJump === null && halves[0].bs !== 'blink') tJump = r.time;
		});
		assert.ok(tJump - tWarn >= 0.6 && halves[0].x < xBefore - 100, 'blink after a warn');
		fxLog.length = 0;
		r.hurtEnemy(halves[0], 1e9, null);
		step(r, 0.2);
		assert.ok(!fxLog.some(([, f]) => f[0] === 'chest'), 'no chest while a half lives');
		r.hurtEnemy(halves[1], 1e9, null);
		step(r, 0.2);
		assert.ok(fxLog.some(([, f]) => f[0] === 'chest'), 'chest after both');
		const lb = r.runLog.bosses[0];
		assert.ok(lb.type === 'twin' && lb.killedAt !== null && lb.sec > 0, 'log: twin killed');
	}
	// Lord: the shock ring is marked ≥ 0.6 s before it hits; a player who stays inside gets hurt, one who leaves does not.
	{
		const r = mk(['smith', 'knight']);
		r.spawn = () => {};
		const b = boss(r, 'boss', 150, 0);
		b.speed = 0;
		const [h1, h2] = [r.heroes.get(1), r.heroes.get(2)];
		b.bcd = 0;
		let warned = null;
		const hp1 = [];
		for (let i = 0; i < 2 * TICK_HZ; i++) {
			h2.x = 2000;
			r.handle(1, { t: 'pos', x: h1.x, y: h1.y, fx: 1, fy: 0 });
			r.tick(dt);
			hp1.push([r.time, h1.hp]);
			if (warned === null && r.blasts.some((x) => x.from === 'boss:wave')) warned = r.time;
		}
		const hit = hp1.find(([, v]) => v < h1.maxHp);
		assert.ok(warned !== null && hit && hit[0] - warned >= C.WARN_MIN - 0.05, `lord wave telegraph ≥ ${C.WARN_MIN} s`);
		const dn = r.runLog.p.get(1).taken['boss:wave'];
		assert.ok(dn > 0, 'log: damage from the boss attack');
	}
	console.log('bosses x5: schedule, telegraphs, mechanics: ok');
}

// --- peaks (G5): schedule, warnings, ring, tide, dawn speed and burn, run log ---
{
	const dt = 1 / TICK_HZ;
	// Schedule by run length: in order, inside the run, warning and start never near a boss, dawn ends the run.
	for (const len of [RUN_SECONDS, 600]) {
		const S = peakSchedule(len, BOSS_TIMES);
		for (let i = 0; i < S.length; i++) {
			const p = S[i];
			assert.ok(p.at - PEAK_WARN > (S[i - 1] ? S[i - 1].at + S[i - 1].dur : 0), `peak ${p.id} order (${len})`);
			assert.ok(p.at + p.dur <= len && p.dur >= 8, `peak ${p.id} inside the run (${len})`);
			// v21: «Светает» is the end of the fight with the Lord and is not moved away from him.
			if (!p.last) for (const b of BOSS_TIMES) for (const t of [p.at - PEAK_WARN, p.at]) assert.ok(Math.abs(t - b) >= PEAK_BOSS_GAP, `peak ${p.id} vs boss at ${b} (${len})`);
		}
		assert.ok(S.at(-1).burn && S.at(-1).at + S.at(-1).dur === len, `dawn closes the run (${len})`);
	}
	assert.deepEqual(peakSchedule().map((p) => p.at), [150, 450, 750, 885], '15:00: «Светает» is the last 15 s');
	assert.deepEqual(peakSchedule(600, []).map((p) => p.at), [100, 300, 500, 585], '10:00 by fractions');

	const fx = [];
	const r = new Room('PK', (pid, m) => { if (m.t === 's' && pid === 1) fx.push(...m.fx.map((f) => [m.tm, f])); });
	r.addPlayer(1, 'Аня', 'knight');
	r.addPlayer(2, 'Боря', 'witch');
	r.start();
	const [a, b] = [r.heroes.get(1), r.heroes.get(2)];
	const hold = () => { for (const h of r.heroes.values()) { h.hp = h.maxHp; h.iframes = 99; } };
	const ring = r.peaks.find((p) => p.ring);
	// Two players far apart get one ring each; together they would share one.
	a.x = 0; a.y = 0; b.x = 3000; b.y = 0;
	r.time = ring.at - PEAK_WARN - 0.5;
	r.enemies = [];
	r.nextInvasionT = 1e9;
	r.nextEliteT = 1e9;
	while (r.time < ring.at + 0.2) { hold(); a.x = 0; a.y = 0; b.x = 3000; b.y = 0; r.tick(dt); }
	const warnAt = fx.find(([, f]) => f[0] === 'peakw' && r.peaks[f[1]] === ring)?.[0];
	const startAt = fx.find(([, f]) => f[0] === 'peak' && r.peaks[f[1]] === ring)?.[0];
	assert.ok(warnAt !== undefined && startAt !== undefined && startAt - warnAt >= PEAK_WARN - 0.2, 'warned ahead');
	const rings = fx.filter(([, f]) => f[0] === 'pring').map(([, f]) => f);
	assert.equal(rings.length, 2, 'one ring per cluster');
	const per = Math.round(ring.ring.count * spawnRateScale(1));
	const near = (cx) => r.enemies.filter((e) => e.type === ENEMY_TYPES.indexOf(ring.ring.type) && Math.abs(Math.hypot(e.x - cx, e.y) - ring.ring.r) < 50).length;
	assert.ok(near(0) >= per * 0.9 && near(3000) >= per * 0.9, `ring of ~${per} shades around each`);
	assert.equal(r.runLog.peaks[0].id, 'ring');
	assert.ok(r.runLog.peaks[0].spawned >= per * 2 * 0.9);

	// Tide: spawn rate ×spawnMul and no invasion inside it.
	const tide = r.peaks.find((p) => p.id === 'tide');
	const spawnedIn = (t0, secs) => {
		r.time = t0;
		r.enemies = [];
		r.spawnAcc = 0;
		r.nextInvasionT = 1e9;
		r.bossIdx = BOSS_TIMES.length;
		let n = 0;
		for (let i = 0; i < secs * TICK_HZ; i++) {
			const before = r.enemies.length;
			r.updatePeaks([a, b]);
			r.spawn(dt, [a, b]);
			n += r.enemies.length - before;
			r.enemies = [];
		}
		return n;
	};
	const base = spawnedIn(tide.at - 15, 5);
	r.peakIdx = r.peaks.indexOf(tide); r.peakWarned = r.peakIdx; r.peak = null;
	const rampN = spawnedIn(tide.at + 0.01, 2);
	r.peakIdx = r.peaks.indexOf(tide); r.peakWarned = r.peakIdx; r.peak = null;
	const peakN = spawnedIn(tide.at + tide.ramp, 5);
	assert.equal(tide.spawnMul, 2, 'v15: tide ×2');
	assert.ok(peakN > base * (tide.spawnMul - 0.4) && peakN < base * (tide.spawnMul + 0.4), `tide spawns ×${tide.spawnMul} after the ramp: ${base} -> ${peakN}`);
	assert.ok(rampN < base * 0.4 * 1.5, `tide ramps up smoothly: first 2 s ${rampN} vs ${base} per 5 s`);
	r.time = tide.at + 1;
	r.nextInvasionT = r.time;
	const invBefore = fx.filter(([, f]) => f[0] === 'inv').length;
	hold();
	r.tick(dt);
	r.snapshot();
	assert.equal(fx.filter(([, f]) => f[0] === 'inv').length, invBefore, 'no invasion inside a peak');

	// Eclipse is announced in the snapshot as pk.
	const ecl = r.peaks.find((p) => p.sight);
	r.peakIdx = r.peaks.indexOf(ecl); r.peakWarned = r.peakIdx; r.peak = null;
	r.time = ecl.at;
	hold();
	r.tick(dt);
	const snap = r.snapshot();
	assert.deepEqual([snap.pk[0], Math.round(snap.pk[1]), snap.pk[2]], [r.peaks.indexOf(ecl), ecl.dur, ecl.dur]);

	// Dawn: enemies run faster, then everything burns at the end and the run is won.
	const dawn = r.peaks.find((p) => p.burn);
	r.peakIdx = r.peaks.indexOf(dawn); r.peakWarned = r.peakIdx; r.peak = null;
	r.time = dawn.at;
	r.bossIdx = BOSS_TIMES.length;
	r.enemies = [];
	r.updatePeaks([a, b]);
	const e1 = r.spawnEnemy('ghoul', [a, b], 1);
	e1.x = a.x + 400; e1.y = a.y;
	e1.speed = 60;
	r.moveEnemies(dt, [a]);
	assert.ok(Math.abs((a.x + 400 - e1.x) - 60 * (dawn.speedMul) * dt) < 0.01, 'dawn speed');
	r.time = r.runLength - dt / 2;
	for (let i = 0; i < 5; i++) r.spawnEnemy('skel', [a, b], 1);
	hold();
	r.tick(dt);
	assert.equal(r.state, 'over');
	assert.equal(r.lastLog.win, true);
	assert.ok(r.enemies.every((e) => e.dead), 'all burned');
	assert.ok(fx.some(([, f]) => f[0] === 'dawn' && f[1] >= 5), 'dawn fx before over');
	const pk = r.lastLog.peaks.find((p) => p.id === 'dawn');
	assert.ok(pk && pk.burned >= 5 && pk.end !== null, 'dawn in the log');
	assert.ok(r.lastLog.summary.some((l) => l.startsWith('Пики: ') && l.includes('Светает')), 'summary line');
	console.log('peaks (G5): schedule, ring, tide, eclipse, dawn, run log: ok');
}

// --- run log: shooters within 600 px at a down (#W364B5: fell to spit with 3 enemies close) ---
{
	const r = new Room('SHOOT', () => {});
	r.addPlayer(1, 'S', 'knight');
	r.start();
	r.enemies.length = 0;
	const h = r.heroes.get(1);
	h.ward = 0;
	const put = (type, x, y) => { const e = r.spawnEnemy(type, [h], 1); e.x = h.x + x; e.y = h.y + y; };
	put('ghoul', 100, 0);
	put('spitter', 400, 0);
	put('spitter', 0, -550);
	put('spitter', 700, 0);
	r.hurtPlayer(h, 1e9, 'spitter:shot');
	const d = r.runLog.p.get(1).deaths[0];
	assert.equal(d.crowd, 1, 'crowd in 300 px');
	assert.equal(d.shooters, 2, 'shooters in 600 px');
	console.log('run log shooters: ok');
}

// --- run log: choices, store on disk, /api/runs over HTTP ---
{
	const sent = [];
	const r = new Room('LOGS', (pid, msg) => sent.push(msg));
	r.addPlayer(1, 'Аня', 'witch');
	r.start();
	const h = r.heroes.get(1);
	r.addXp(h, xpForNext(1, 1) + xpForNext(2, 1) + xpForNext(3, 1) + 1);
	r.handle(1, { t: 'reroll' });
	r.handle(1, { t: 'skip' });
	r.handle(1, { t: 'pick', i: 0 });
	const acts = r.runLog.p.get(1).picks.map((e) => e[2]);
	assert.deepEqual(acts.slice(0, 3), ['reroll', 'skip', 'pick']);
	assert.ok(r.runLog.p.get(1).picks.every((e) => e[1] >= 2 && typeof e[e.length - 1] === 'string'), 'offer list kept');
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horde-runs-'));
	runStore.persist(dir);
	r.time = 125;
	r.finish(true);
	const log = r.lastLog;
	assert.ok(fs.existsSync(path.join(dir, `${log.id}.json`)) || await new Promise((ok) => setTimeout(() => ok(fs.existsSync(path.join(dir, `${log.id}.json`))), 200)), 'written to disk');
	assert.equal(log.win, true);
	assert.ok(/победа на 2:05/.test(log.summary[0]));
	runStore.dir = null;
	for (let i = 0; i < 35; i++) runStore.add({ ...log, id: 'Z' + String(i).padStart(5, '0') });
	assert.equal(runStore.runs.length, 30, 'keeps last 30 in memory');
	// Soft start: solo and groups share the same curve before 3:00 (v15: early grace on top); groups get harder after it.
	const grace = (t, E) => (t >= E.until ? 1 : E.from + (1 - E.from) * t / E.until);
	for (const n of [1, 2, 4]) assert.ok(Math.abs(enemyHpScale(170, n) - grace(170, C.EARLY_HP) * (1 + 0.12 * 2) * (1 + 0.55 * (n - 1) + 0.05 * (n - 1) ** 2)) < 1e-9, 'pre-3:00 hp curve');
	assert.ok(enemyHpScale(600, 2) / enemyHpScale(180, 2) > 1.4 * (enemyHpScale(600, 1) / enemyHpScale(180, 1)), 'groups ramp after 3:00');
	assert.equal(enemyDmgScale(780, 2), enemyDmgScale(780, 1), 'v17: pairs hit like solo');
	assert.ok(Math.abs(enemyHpScale(600, 1) - (1 + 0.12 * 10 + 0.02 * 49) * (1 + 0.08 * 0.4) * (1 + 0.035 * 7)) < 1e-9, 'solo: +3.5%/min after 3:00 (v15)');
	assert.equal(enemyDmgScale(600, 1), 1 + 0.06 * 7);
	assert.ok(enemyDmgScale(0, 1) === C.EARLY_DMG.from && enemyDmgScale(C.EARLY_DMG.until / 2, 1) < 1, 'early hits are softer');
	assert.ok(enemyDmgScale(600, 4) > enemyDmgScale(600, 2));

	// HTTP: a fresh server loads the stored runs from disk.
	const port = 3600 + Math.floor(Math.random() * 300);
	const srv = spawn(process.execPath, [new URL('./server.js', import.meta.url).pathname], { env: { ...process.env, PORT: String(port), HORDE_RUNS_DIR: dir }, stdio: 'ignore' });
	try {
		const get = async (p) => {
			for (let i = 0; i < 50; i++) {
				try { return await fetch(`http://127.0.0.1:${port}${p}`); } catch { await new Promise((ok) => setTimeout(ok, 100)); }
			}
			throw new Error('server did not start');
		};
		const list = await (await get('/api/runs')).json();
		assert.ok(list.runs.some((x) => x.id === log.id && x.win === true && x.players[0].name === 'Аня'), 'list');
		const one = await get(`/api/runs/${log.id}`);
		assert.equal(one.status, 200);
		assert.equal((await one.json()).id, log.id);
		const txt = await (await get(`/api/runs/${log.id.toLowerCase()}.txt`)).text();
		assert.ok(txt.startsWith('Ночная орда') && txt.includes(`"id":"${log.id}"`));
		assert.equal((await get('/api/runs/NOPE00')).status, 404);
		assert.equal((await get('/api/runs/../../etc')).status, 404);
		const busy = await (await get('/api/busy')).json();
		assert.deepEqual(busy, { playing: 0, players: 0, online: 0, v: GAME_VERSION }, '/api/busy: idle server');
	} finally {
		srv.kill();
		fs.rmSync(dir, { recursive: true, force: true });
	}
	{
		const hub = new Hub(() => {});
		hub.addPlayer(1, 'A'); hub.addPlayer(2, 'B'); hub.addPlayer(3, 'C');
		const room = new Room('BUSY', () => {});
		room.addPlayer(1, 'A', 'knight'); room.addPlayer(2, 'B', 'witch');
		hub.rooms.set('BUSY', room);
		assert.deepEqual(hub.busy(), { playing: 0, players: 0, online: 3 }, 'lobby is not busy');
		room.start();
		assert.deepEqual(hub.busy(), { playing: 1, players: 2, online: 3 }, 'a run in progress');
	}
	console.log('run log store + /api/runs + /api/busy: ok');
}

// Card rarity: table distribution, final numbers, weapon levels, chest floors, fortune, rerolls, run log.
{
	const N = 40000;
	const cnt = [0, 0, 0, 0];
	for (let k = 0; k < N; k++) cnt[rollRarity(0)]++;
	const tot = RARITIES.reduce((s, R) => s + R.w, 0);
	RARITIES.forEach((R, i) => {
		const want = R.w / tot, got = cnt[i] / N;
		assert.ok(Math.abs(got - want) < Math.max(0.01, want * 0.25), `rarity ${R.id}: ${got.toFixed(3)} vs ${want}`);
	});
	assert.deepEqual(RARITIES.map((R) => R.mul), [1, 1.5, 2.2, 3.5]);
	assert.deepEqual(RARITIES.map((R) => R.levels), [1, 1, 2, 2]);
	for (let k = 0; k < 2000; k++) assert.ok(rollRarity(0, 2) >= 2, 'floor');
	const lucky = rarityWeights(1);
	assert.ok(lucky[3] / lucky[0] > rarityWeights(0)[3] / rarityWeights(0)[0] * 3.5, 'fortune shifts to legendary');
	// Expected artifact step stays at or below the old one.
	const mean = RARITIES.reduce((s, R) => s + R.w * R.mul, 0) / tot;
	assert.ok(mean * PASSIVE_BASE <= 1, `mean artifact step ×${(mean * PASSIVE_BASE).toFixed(2)}`);
	for (const id of ['might', 'haste', 'vigor', 'regen', 'mail', 'clover']) {
		RARITIES.forEach((R, i) => {
			const want = PASSIVES[id].perLevel * PASSIVE_BASE * R.mul;
			assert.ok(Math.abs(passiveStep(id, i) - want) <= (id === 'vigor' ? 0.5 : 0.05) + 1e-9, `${id} step ${i}`);
		});
		assert.ok(Math.abs(passiveStep(id, 3)) > Math.abs(passiveStep(id, 0)) * 3);
	}
	assert.equal(passiveDesc('might', 0.17), '+17% урона');
	assert.equal(passiveDesc('haste', -0.09), '−9% перезарядки');
	assert.equal(passiveDesc('regen', 0.4), '+0,4 здоровья в секунду');
	assert.equal(passiveDesc('vigor', 23), '+23 к макс. здоровью');
	assert.ok(PASSIVES.clover && PASSIVES.clover.stat === 'fortune' && PASSIVES.luck.name === 'Подкова');

	const sent = [];
	const r = new Room('RAR', (pid, msg) => sent.push([pid, msg]));
	r.addPlayer(1, 'R', 'knight');
	r.start();
	r.spawn = () => {};
	const h = r.heroes.get(1);
	const plain = (c) => (c.kind === 'weapon' && WEAPONS[c.id]) || (c.kind === 'passive' && !PASSIVES[c.id].noRarity);
	// Offers: every plain card has a rarity, duos/evos/heal/forge do not; numbers in desc match the card.
	const seen = [0, 0, 0, 0];
	let n = 0;
	for (let k = 0; k < 3000; k++) {
		h.passives = new Map();
		h.pval = {};
		for (const c of r.makeChoices(h)) {
			if (!plain(c)) { assert.equal(c.rar, undefined, `${c.kind} has no rarity`); continue; }
			assert.ok(c.rar >= 0 && c.rar <= 3);
			seen[c.rar]++;
			n++;
			if (c.kind === 'passive') assert.equal(c.desc, passiveDesc(c.id, passiveStep(c.id, c.rar)));
		}
	}
	RARITIES.forEach((R, i) => assert.ok(Math.abs(seen[i] / n - R.w / tot) < Math.max(0.015, (R.w / tot) * 0.35), `offer rarity ${R.id}: ${(seen[i] / n).toFixed(3)}`));
	// Artifact pick applies the rarity value.
	h.passives = new Map();
	h.pval = {};
	h.offer = [{ id: 'might', kind: 'passive', name: 'Сила', level: 1 }];
	r.setRarity(h, h.offer[0], 3);
	r.handle(1, { t: 'pick', i: 0 });
	assert.ok(Math.abs(h.mods.dmgMul - 1 - passiveStep('might', 3)) < 1e-9, `legendary might ${h.mods.dmgMul}`);
	h.offer = [{ id: 'might', kind: 'passive', name: 'Сила', level: 2 }];
	r.setRarity(h, h.offer[0], 0);
	r.handle(1, { t: 'pick', i: 0 });
	assert.ok(Math.abs(h.mods.dmgMul - 1 - passiveStep('might', 3) - passiveStep('might', 0)) < 1e-9 && h.passives.get('might') === 2);
	// Weapon: epic +2 levels (capped), rare/legendary +1 reroll.
	h.weapons = new Map([['whip', { lvl: 1, t: 0 }]]);
	h.offer = [{ id: 'whip', kind: 'weapon', name: 'Клинок', level: 2 }];
	r.setRarity(h, h.offer[0], 2);
	assert.equal(h.offer[0].level, 3);
	assert.ok(h.offer[0].desc.includes('14→22'), h.offer[0].desc);
	r.handle(1, { t: 'pick', i: 0 });
	assert.equal(h.weapons.get('whip').lvl, 3);
	h.weapons.get('whip').lvl = 4;
	const rr = h.rerolls;
	h.offer = [{ id: 'whip', kind: 'weapon', name: 'Клинок', level: 5 }];
	r.setRarity(h, h.offer[0], 3);
	assert.equal(h.offer[0].level, 5, 'capped at max');
	r.handle(1, { t: 'pick', i: 0 });
	assert.equal(h.weapons.get('whip').lvl, 5);
	assert.equal(h.rerolls, rr + 1, 'legendary weapon: +1 reroll');
	h.offer = [{ id: 'bolt', kind: 'weapon', name: 'Искра', level: 1 }];
	r.setRarity(h, h.offer[0], 2);
	r.handle(1, { t: 'pick', i: 0 });
	assert.equal(h.weapons.get('bolt').lvl, 2, 'epic new weapon starts at 2');
	// Chest floors (elite ≥ rare, boss ≥ epic) survive a reroll.
	const best = (o) => Math.max(-1, ...o.filter(plain).map((c) => c.rar));
	for (let k = 0; k < 300; k++) {
		h.offer = null;
		h.passives = new Map();
		h.pval = {};
		h.weapons = new Map([['whip', { lvl: 1, t: 0 }]]);
		h.hp = h.maxHp;
		r.grantOffer(h, true, CHEST_FLOOR.elite);
		assert.ok(best(h.offer) >= 1, 'elite chest: at least rare');
		h.rerolls = 1;
		r.handle(1, { t: 'reroll' });
		assert.ok(best(h.offer) >= 1, 'reroll keeps the floor');
		h.offer = null;
		r.grantOffer(h, false, CHEST_FLOOR.boss);
		assert.ok(best(h.offer) >= 2, 'boss chest: at least epic');
	}
	// Fortune (Клевер) raises the share of rare cards.
	const share = (fortune) => {
		let hi = 0, all = 0;
		h.mods.fortune = fortune;
		for (let k = 0; k < 2000; k++) for (const c of r.makeChoices(h).filter(plain)) { all++; if (c.rar >= 2) hi++; }
		return hi / all;
	};
	assert.ok(share(1) > share(0) * 2, 'clover: more epic+ cards');
	h.mods.fortune = 0;
	// Run log counts rarity seen and taken.
	h.offer = null;
	h.passives = new Map();
	r.grantOffer(h, false, CHEST_FLOOR.boss);
	const c0 = h.offer.find((c) => c.rar >= 2);
	r.handle(1, { t: 'pick', i: h.offer.indexOf(c0) });
	const log = r.runLog.build(r, false);
	assert.equal(log.team[0].rarity.took.reduce((a, b) => a + b, 0) >= 1, true);
	assert.ok(log.rarity.took[c0.rar] >= 1 && log.rarity.seen.reduce((a, b) => a + b, 0) >= log.rarity.took.reduce((a, b) => a + b, 0));
	const last = log.team[0].picks[log.team[0].picks.length - 1];
	assert.equal(last[6], c0.rar, 'pick entry keeps rarity');
	assert.ok(log.summary.some((l) => l.startsWith('Редкость карточек:')));
	console.log(`card rarity: ok (offers ${seen.map((x) => (x / n * 100).toFixed(1)).join('/')}%)`);
}

// --- v14: «Обед» (10 min), solo pause, hero unlocks ---
{
	const dt1 = 1 / C.TICK_HZ;
	// Lunch: bosses, waves, peaks and dawn squeeze into 10:00; night time runs 1.5× faster; xp follows.
	{
		const r = new Room('LNCH', () => {});
		assert.ok(r.setMode('lunch') && r.runLength === 600);
		r.addPlayer(1, 'L', 'knight');
		r.start();
		assert.equal(r.tscale, 1.5);
		assert.equal(r.xpMul, C.MODES.lunch.xpMul);
		assert.deepEqual(r.bossAt, [120, 240, 360, 480, 540]); // v21: the Lord's fight is the last 60 s
		const pk = Object.fromEntries(r.peaks.map((p) => [p.id, p]));
		assert.equal(pk.ring.at, 100);
		assert.equal(pk.tide.at, 300);
		assert.ok(pk.eclipse.at >= 490 && pk.eclipse.at < 520);
		assert.ok(pk.dawn.burn && pk.dawn.at === 585 && pk.dawn.at + pk.dawn.dur === 600, 'dawn ends the lunch');
		assert.equal(r.nextEliteT, C.ELITE_START / 1.5);
		assert.equal(r.nextInvasionT, C.INVASION.from / 1.5);
		r.time = 400;
		assert.equal(r.nt, 600);
		assert.equal(r.currentWave().at, 600, 'wave by night time');
		const night = new Room('NGHT', () => {});
		night.addPlayer(1, 'N', 'knight');
		night.start();
		night.time = 600;
		assert.equal(enemyHpScaleOf(r), enemyHpScaleOf(night), 'pressure by night time');
		// Gems are worth xpMul more in lunch.
		const h = r.heroes.get(1), hn = night.heroes.get(1);
		r.collectGem(h, 2);
		night.collectGem(hn, 2);
		assert.ok(Math.abs(h.xp - hn.xp * C.MODES.lunch.xpMul) < 1e-9);
		// The run ends at 10:00 with the dawn burn and a win.
		const out = [];
		const r2 = new Room('LN2', (pid, m) => out.push(m));
		r2.setMode('lunch');
		r2.addPlayer(1, 'L', 'knight');
		r2.start();
		r2.spawn = () => {};
		const h2 = r2.heroes.get(1);
		h2.iframes = 1e9;
		r2.time = 599.9;
		for (let i = 0; i < 10 && r2.state === 'play'; i++) { while (h2.offer) r2.handle(1, { t: 'skip' }); r2.tick(dt1); }
		const over = out.find((m) => m.t === 'over');
		assert.ok(over && over.win && over.mode === 'lunch' && over.len === 600, 'lunch win at 10:00');
		assert.ok(over.log.mode === 'lunch' && over.log.summary[0].includes('«Обед»'), 'run log shows the mode');
		// Mode in the lobby and the room list; only the host changes it.
		const msgs = [];
		const hub = new Hub((pid, m) => msgs.push([pid, m]));
		hub.addPlayer(1, 'A');
		hub.addPlayer(2, 'B');
		hub.handle(1, { t: 'create', hero: 'knight', mode: 'lunch' });
		const room = hub.players.get(1).room;
		assert.equal(room.mode, 'lunch');
		assert.equal(hub.roomList()[0].mode, 'lunch');
		hub.handle(2, { t: 'join', code: room.code, hero: 'witch' });
		hub.handle(2, { t: 'mode', mode: 'night' });
		assert.equal(room.mode, 'lunch', 'guest cannot change the mode');
		hub.handle(1, { t: 'mode', mode: 'night' });
		assert.equal(room.mode, 'night');
		assert.equal(msgs.filter(([pid, m]) => pid === 2 && m.t === 'lobby').pop()[1].mode, 'night', 'everyone sees the mode');
		// Lunch groups get extra enemy hp (balance), solo does not; the night has none.
		assert.equal(r.modeHp, 1);
		const pair = new Room('LP', () => {});
		pair.setMode('lunch');
		pair.addPlayer(1, 'A', 'knight');
		pair.addPlayer(2, 'B', 'witch');
		pair.start();
		assert.equal(pair.modeHp, C.modeHpMul('lunch', 2));
		assert.ok(pair.modeHp > 1 && night.modeHp === 1);
		const eL = pair.spawnEnemy('bat', [...pair.heroes.values()], 1);
		assert.ok(Math.abs(eL.maxHp - C.ENEMIES.bat.hp * pair.modeHp) < 1e-9);
		console.log('lunch mode: ok');
	}
	// Solo pause: menu pause and an open offer stop the clock; groups cannot pause.
	{
		const out = [];
		const r = new Room('PAUS', (pid, m) => out.push(m));
		r.addPlayer(1, 'S', 'witch');
		r.start();
		const h = r.heroes.get(1);
		for (let i = 0; i < 30; i++) { while (h.offer) r.handle(1, { t: 'skip' }); r.tick(dt1); }
		r.handle(1, { t: 'pause', v: true });
		assert.ok(r.frozen && out.some((m) => m.t === 'pause' && m.on && m.menu));
		const t0 = r.time, e0 = r.enemies.length, cd0 = JSON.stringify([...h.weapons]), x0 = h.x;
		for (let i = 0; i < 90; i++) r.tick(dt1);
		r.handle(1, { t: 'pos', x: h.x + 50, y: h.y, fx: 1, fy: 0 });
		assert.equal(r.time, t0, 'clock stands');
		assert.equal(r.enemies.length, e0);
		assert.equal(JSON.stringify([...h.weapons]), cd0, 'cooldowns stand');
		assert.equal(h.x, x0, 'no moving while paused');
		r.handle(1, { t: 'pause', v: false });
		assert.ok(!r.frozen && out[out.length - 1].t === 'pause' && !out[out.length - 1].on);
		r.tick(dt1);
		assert.ok(r.time > t0, 'clock goes on');
		// Level-up offer pauses solo.
		r.grantOffer(h);
		r.tick(dt1);
		const t1 = r.time;
		for (let i = 0; i < 30; i++) r.tick(dt1);
		assert.ok(r.frozen && r.time === t1, 'offer pauses solo');
		r.handle(1, { t: 'pick', i: 0 });
		while (h.offer) r.handle(1, { t: 'skip' });
		r.tick(dt1);
		assert.ok(!r.frozen && r.time > t1);
		// Quit to the lobby.
		r.handle(1, { t: 'pause', v: true });
		r.handle(1, { t: 'quit' });
		assert.ok(r.state === 'lobby' && !r.frozen && !r.paused);
		// Two players: no pause, offers do not stop the clock.
		const g = new Room('DUO', () => {});
		g.addPlayer(1, 'A', 'knight');
		g.addPlayer(2, 'B', 'witch');
		g.start();
		g.handle(1, { t: 'pause', v: true });
		g.grantOffer(g.heroes.get(1));
		const tg = g.time;
		for (let i = 0; i < 10; i++) g.tick(dt1);
		assert.ok(!g.frozen && !g.paused && g.time > tg, 'no pause in a group');
		g.handle(2, { t: 'quit' });
		assert.equal(g.state, 'play', 'no quit in a group');
		console.log('solo pause: ok');
	}
	// Hero unlocks: start heroes, server-side run stats, merge on the client, locked picks refused.
	{
		assert.deepEqual(C.unlockedHeroes({}), C.START_HEROES);
		assert.equal(new Set(C.START_HEROES.map((id) => C.HEROES[id])).size, 3);
		for (const id of Object.keys(C.HEROES)) assert.ok(C.START_HEROES.includes(id) || C.UNLOCKS[id], `${id} has a way to open`);
		let tot = {};
		tot = C.mergeAchStats(tot, { wins: 0, knightBest: 200, revives: 3, knifeKills: 100 });
		tot = C.mergeAchStats(tot, { wins: 1, knightBest: 120, revives: 4, knifeKills: 50 });
		assert.deepEqual(tot, { wins: 1, knightBest: 200, revives: 7, knifeKills: 150, bosses: 0, lords: 0 });
		assert.ok(C.unlockedHeroes(tot).includes('stormcaller') && !C.unlockedHeroes(tot).includes('smith'));
		assert.equal(C.unlockProgress('herald', tot), 'Поднимите союзников: 7/10');
		assert.equal(C.unlockProgress('smith', tot), 'Продержитесь 5:00 Стражем: 3:20/5:00');
		tot = C.mergeAchStats(tot, { knightBest: 301 });
		assert.ok(C.unlockedHeroes(tot).includes('smith'));
		// Server counts revives given, knife kills, the knight's time and the win.
		const out = [];
		const r = new Room('ACH', (pid, m) => out.push([pid, m]));
		r.addPlayer(1, 'K', 'knight', new Set(['knight', 'witch', 'alchemist']));
		r.addPlayer(2, 'R', 'ranger');
		r.handle(1, { t: 'hero', hero: 'smith' });
		assert.equal(r.members.get(1).hero, 'knight', 'locked hero refused');
		assert.ok(out.some(([pid, m]) => pid === 1 && m.t === 'err'));
		r.addPlayer(3, 'X', 'smith', new Set(['witch']));
		assert.equal(r.members.get(3).hero, 'witch', 'locked start hero falls back');
		r.removePlayer(3);
		r.handle(1, { t: 'heroes', heroes: ['knight', 'witch', 'alchemist', 'stormcaller'] });
		r.handle(1, { t: 'hero', hero: 'stormcaller' });
		assert.equal(r.members.get(1).hero, 'stormcaller', 'hero opened mid-session');
		r.handle(1, { t: 'hero', hero: 'knight' });
		r.start();
		const k = r.heroes.get(1), rg = r.heroes.get(2);
		r.spawn = () => {};
		k.iframes = rg.iframes = 1e9;
		rg.st = 1;
		rg.x = k.x + 10;
		rg.y = k.y;
		for (let i = 0; i < 4 * C.TICK_HZ && rg.st === 1; i++) { r.handle(1, { t: 'pos', x: k.x, y: k.y }); r.tick(dt1); }
		assert.equal(rg.st, 0);
		assert.equal(k.revives, 1, 'revive credited to the helper');
		const e = r.spawnEnemy('bat', [k], 1);
		r.hurtEnemy(e, 1e6, rg, { weapon: 'knives', tags: ['phys', 'proj'] });
		assert.equal(rg.knifeKills, 1);
		r.time = 320;
		r.finish(true);
		const over = out.filter(([, m]) => m.t === 'over').pop()[1];
		const a1 = over.stats.find((s) => s.pid === 1).ach, a2 = over.stats.find((s) => s.pid === 2).ach;
		assert.deepEqual(a1, { wins: 1, knightBest: 320, revives: 1, knifeKills: 0, bosses: 0, lords: 0 });
		assert.deepEqual(a2, { wins: 1, knightBest: 0, revives: 0, knifeKills: 1, bosses: 0, lords: 0 });
		assert.ok(C.unlockedHeroes(C.mergeAchStats({}, a1)).includes('smith'), 'knight 5:20 opens the smith');
		// Boss kills count for every player in the room (Копейщица).
		const rb = new Room('BK', () => {});
		rb.addPlayer(1, 'A', 'witch');
		rb.addPlayer(2, 'B', 'knight');
		rb.start();
		const bb = rb.spawnBoss('ram', [...rb.heroes.values()]);
		rb.hurtEnemy(bb, 1e9, rb.heroes.get(1));
		assert.equal(rb.runAchievements(rb.heroes.get(2), false).bosses, 1);
		assert.ok(C.unlockedHeroes({ bosses: 5 }).includes('spearmaiden') && !C.unlockedHeroes({ bosses: 4 }).includes('spearmaiden'));
		// «Таран»: her spear hits the 3rd pierced enemy harder and knocks back twice as far as a plain spear.
		const hit = (hero) => {
			const r = new Room('RAM', () => {});
			r.addPlayer(1, 'S', hero);
			r.start();
			r.spawn = () => {};
			const h = r.heroes.get(1);
			h.weapons = new Map();
			const es = [0, 1, 2].map((i) => { const e = r.spawnEnemy('brute', [h], 100); e.x = 60 + i * 50; e.y = 0; e.speed = 0; return e; });
			r.rebuildGrid();
			r.addProjectile(h, 'spear', 0, 700, 30, 5, 0.5, null, 0, { src: { weapon: 'spear', tags: ['phys', 'proj'] }, kb: 40, r: 8 });
			for (let i = 0; i < 12; i++) { r.rebuildGrid(); r.updateProjectiles(dt1); }
			return es.map((e) => [e.maxHp - e.hp, e.x]);
		};
		const plain = hit('witch'), ram = hit('spearmaiden');
		assert.ok(Math.abs(ram[0][0] - plain[0][0]) < 1e-6 && ram[2][0] > plain[2][0] * 1.2, 'ram: more damage deeper in the line');
		assert.ok(ram[0][1] - 60 > (plain[0][1] - 60) * 1.8, 'ram: knockback ×2');
		console.log('hero unlocks: ok');
	}
}

console.log('OK');
process.exit(0);
