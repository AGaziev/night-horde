// v22 checks: progress in the app storage — migration merge, storage failures, guests, write queue, weekly records.
// The storage is a stub; nothing goes to the network. node server/v22-test.js
import assert from 'node:assert/strict';
import { Room } from './game.js';
import {
	ProgressStore, bitrixUid, mergeProgress, sanitizeAch, isoWeek, playerKey, boardKey, ACH_LIMITS, SCHEMA, progressMsg,
	PLAYER_MIN_INTERVAL_MS, BOARD_MIN_INTERVAL_MS, unlockedOf, vibeBackend,
} from './storage.js';
import { GAME_VERSION, START_HEROES, TICK_HZ } from '../public/shared/content.js';
import { PROTO } from './snapshot-codec.js';

const quiet = { warn() {} };
const tick = () => new Promise((r) => setImmediate(r));
async function settle(n = 5) {
	for (let i = 0; i < n; i++) await tick();
}

// Stub storage: objects in a Map; `fail` makes calls throw; `gate` holds puts until released; counts concurrency.
function stub(initial = {}) {
	const s = {
		data: new Map(Object.entries(initial)), fail: false, gets: 0, puts: [], inflight: 0, maxInflight: 0, gate: null,
		async get(key) {
			s.gets++;
			await tick();
			if (s.fail) throw new Error('503');
			return s.data.has(key) ? s.data.get(key) : null;
		},
		async put(key, text) {
			s.inflight++;
			s.maxInflight = Math.max(s.maxInflight, s.inflight);
			try {
				if (s.gate) await s.gate.promise;
				await tick();
				if (s.fail) throw new Error('503');
				s.data.set(key, text);
				s.puts.push(key);
			} finally {
				s.inflight--;
			}
		},
	};
	return s;
}
const gate = () => {
	let release;
	const promise = new Promise((r) => (release = r));
	return { promise, release };
};
function makeStore(backend, t0 = Date.UTC(2026, 10, 10, 12)) {
	const clock = { t: t0 };
	const st = new ProgressStore({ backend, log: quiet, now: () => clock.t });
	return { st, clock };
}

assert.equal(GAME_VERSION, 'v22');
assert.equal(PROTO, 19);

// --- ids: only plain numbers are portal users ---
assert.equal(bitrixUid('42'), '42');
assert.equal(bitrixUid('999999999'), '999999999');
for (const bad of [undefined, '', '0', '0042', 'net_5', 'share:abc', 'vibe:7', '12a', ' 42', '1234567890123', 42]) assert.equal(bitrixUid(bad), null, String(bad));

// --- ISO weeks ---
assert.equal(isoWeek(new Date(Date.UTC(2026, 10, 10))), '2026-W46');
assert.equal(isoWeek(new Date(Date.UTC(2021, 0, 3))), '2020-W53'); // Sunday 3 Jan 2021 belongs to the last week of 2020
assert.equal(isoWeek(new Date(Date.UTC(2024, 11, 30))), '2025-W01'); // Monday 30 Dec 2024 opens 2025-W01
assert.equal(isoWeek(new Date(Date.UTC(2026, 0, 1))), '2026-W01');
assert.equal(boardKey('2026-W46'), 'leaderboard/week-2026-W46.json');

// --- sanitizing what a browser sends ---
{
	const a = sanitizeAch({ wins: '7', knightBest: 99999, revives: -5, knifeKills: 1e12, bosses: NaN, lords: 50, extra: 1 });
	assert.deepEqual(a, { wins: 7, knightBest: ACH_LIMITS.knightBest, revives: 0, knifeKills: ACH_LIMITS.knifeKills, bosses: 0, lords: 7 });
	assert.ok(!('extra' in a));
}

// --- merge: bigger progress wins, nothing closes ---
{
	const server = { ach: { wins: 3, knightBest: 200, revives: 12, knifeKills: 100, bosses: 1, lords: 1 }, duos: ['thunderslash'] };
	const local = { ach: { wins: 1, knightBest: 320, revives: 2, knifeKills: 900, bosses: 6, lords: 0 }, duos: ['thunderslash', 'nope', 42] };
	const m = mergeProgress(server, local);
	assert.deepEqual(m.ach, { wins: 3, knightBest: 320, revives: 12, knifeKills: 900, bosses: 6, lords: 1 });
	assert.ok(m.duos.every((id) => id !== 'nope'));
	assert.deepEqual(mergeProgress(local, server), m); // order does not matter
}

// --- migration through the store: once per user, server object written ---
{
	const b = stub({ [playerKey('42')]: JSON.stringify({ schema: 1, uid: '42', ach: { wins: 2, bosses: 1 }, duos: [], migrated: false, runs: 2 }) });
	const { st, clock } = makeStore(b);
	const rec = await st.retain('42');
	assert.equal(rec.ach.wins, 2);
	assert.equal(progressMsg(st, rec).mig, false);
	st.migrate('42', { ach: { wins: 1, bosses: 9, revives: 10 }, duos: [] });
	assert.deepEqual([rec.ach.wins, rec.ach.bosses, rec.ach.revives], [2, 9, 10]);
	assert.ok(unlockedOf(rec).includes('herald') && unlockedOf(rec).includes('spearmaiden') && unlockedOf(rec).includes('stormcaller'));
	// A second hand-over is ignored: the server is the source of truth now.
	st.migrate('42', { ach: { wins: 999 } });
	assert.equal(rec.ach.wins, 2);
	clock.t += PLAYER_MIN_INTERVAL_MS;
	await Promise.all(st.tick());
	const saved = JSON.parse(b.data.get(playerKey('42')));
	assert.equal(saved.schema, SCHEMA);
	assert.equal(saved.migrated, true);
	assert.equal(saved.ach.bosses, 9);
}

// --- a new user: no object yet (404) is an empty record, not a failure ---
{
	const b = stub();
	const { st } = makeStore(b);
	const rec = await st.retain('7');
	assert.ok(rec);
	assert.deepEqual(unlockedOf(rec), START_HEROES);
	assert.equal(st.errors.read, 0);
}

// --- storage down: nothing breaks, nothing is written, the read is retried later ---
{
	const b = stub();
	b.fail = true;
	const { st, clock } = makeStore(b);
	const rec = await st.retain('42');
	assert.equal(rec, null);
	assert.equal(st.errors.read, 1);
	assert.equal(progressMsg(st, null).srv, false);
	// A run ending meanwhile is kept and applied after the read; the unread object is never overwritten.
	assert.equal(st.addRun('42', { ach: { wins: 1 }, duos: [] }), null);
	// A second session right away does not hit the failing storage again before the retry time.
	assert.equal(await st.retain('42'), null);
	assert.equal(b.gets, 1);
	st.release('42');
	clock.t += 60_000;
	await Promise.all(st.tick());
	await settle();
	assert.equal(b.puts.length, 0);
	b.data.set(playerKey('42'), JSON.stringify({ schema: 1, ach: { wins: 5 }, migrated: true }));
	b.fail = false;
	const loaded = [];
	st.onLoaded = (uid) => loaded.push(uid);
	clock.t += 10 * 60_000;
	st.tick();
	await settle();
	assert.deepEqual(loaded, ['42']);
	assert.equal(st.record('42').ach.wins, 6);
	// Write failure: counted, retried, the data survives in the cache.
	b.fail = true;
	clock.t += PLAYER_MIN_INTERVAL_MS;
	await Promise.all(st.tick());
	assert.equal(st.errors.write, 1);
	b.fail = false;
	clock.t += 10 * 60_000;
	await Promise.all(st.tick());
	assert.equal(JSON.parse(b.data.get(playerKey('42'))).ach.wins, 6);
}

// --- no key at all: the store is off and every call is harmless ---
{
	const st = new ProgressStore({ backend: null, log: quiet });
	assert.equal(st.enabled, false);
	assert.equal(await st.retain('42'), null);
	assert.equal(st.addRun('42', { ach: { wins: 1 } }), null);
	st.addResult('42', { hero: 'knight', win: true });
	assert.deepEqual(st.tick(), []);
	await st.flush();
	assert.deepEqual(progressMsg(st, null), { t: 'prog', board: false, srv: false });
}

// --- guests and prefixed ids never touch the storage ---
{
	const b = stub();
	const { st, clock } = makeStore(b);
	for (const id of [null, 'net_5', 'share:x', 'vibe:9']) {
		assert.equal(await st.retain(id), null);
		assert.equal(st.addRun(id, { ach: { wins: 1 } }), null);
		st.addResult(id, { hero: 'knight', win: true, time: 900 });
	}
	clock.t += 60_000;
	await Promise.all(st.tick());
	await settle();
	assert.equal(b.gets, 0);
	assert.equal(b.puts.length, 0);
	assert.equal(st.players.size, 0);
}

// --- concurrent writes: one at a time per object, batched, the last state wins ---
{
	const b = stub();
	const { st, clock } = makeStore(b);
	await st.retain('42');
	b.gate = gate();
	for (let i = 0; i < 5; i++) st.addRun('42', { ach: { knifeKills: 10 }, duos: [] });
	clock.t += PLAYER_MIN_INTERVAL_MS;
	const first = st.tick();
	assert.equal(first.length, 1); // five changes → one write
	st.addRun('42', { ach: { knifeKills: 10 }, duos: [] }); // a change while the write is in flight
	clock.t += PLAYER_MIN_INTERVAL_MS * 2;
	assert.equal(st.tick().length, 0); // the same object is not written twice at once
	const flushing = st.flush(1000);
	b.gate.release();
	b.gate = null;
	await Promise.all(first);
	await flushing;
	await settle();
	assert.equal(b.maxInflight, 1);
	assert.equal(JSON.parse(b.data.get(playerKey('42'))).ach.knifeKills, 60);
	// Rate limit: a change right after a write waits for the interval.
	st.addRun('42', { ach: { knifeKills: 1 }, duos: [] });
	assert.equal(st.tick().length, 0);
	clock.t += PLAYER_MIN_INTERVAL_MS;
	assert.equal(st.tick().length, 1);
}

// --- two sessions of one user share one cached object and one read ---
{
	const b = stub();
	const { st } = makeStore(b);
	const [a, c] = await Promise.all([st.retain('5'), st.retain('5')]);
	assert.equal(a, c);
	assert.equal(b.gets, 1);
	st.release('5');
	st.tick();
	assert.ok(st.record('5'));
	st.release('5');
	st.tick();
	assert.equal(st.record('5'), null); // idle and clean → dropped from the cache
}

// --- newer schema on the storage: left alone ---
{
	const b = stub({ [playerKey('9')]: JSON.stringify({ schema: SCHEMA + 1, ach: { wins: 3 } }) });
	const { st } = makeStore(b);
	assert.equal(await st.retain('9'), null);
	st.addRun('9', { ach: { wins: 1 } });
	await Promise.all(st.tick());
	assert.equal(b.puts.length, 0);
}

// --- weekly records: best per player, written only after the week was read, top 10 ---
{
	const week = '2026-W46';
	const old = { '1': { name: 'Старый', hero: 'witch', win: false, lord: false, time: 400, kills: 900, mode: 'night', players: 1, at: 1 } };
	const b = stub({ [boardKey(week)]: JSON.stringify({ schema: 1, week, rows: old }) });
	const { st, clock } = makeStore(b);
	st.addResult('1', { name: 'Старый', hero: 'witch', win: false, time: 300, kills: 5000 }); // worse: shorter
	st.addResult('2', { name: 'Вторая', hero: 'knight', win: true, time: 900, kills: 2000 });
	assert.equal(st.top(week), null); // not read yet
	await settle();
	assert.equal(st.top(week).length, 2);
	assert.equal(st.top(week)[0].name, 'Вторая');
	assert.equal(st.top(week)[1].time, 400); // the worse run did not replace the better one
	st.addResult('2', { name: 'Вторая', hero: 'knight', win: true, time: 900, kills: 1500 }); // same rank, fewer kills
	st.addResult('3', { name: 'Третий', hero: 'spearmaiden', lord: true, time: 870, kills: 1200 });
	st.addResult('4', { name: '<b>x</b>', hero: 'nobody', win: true, time: 900 }); // unknown hero → dropped
	for (let i = 10; i < 25; i++) st.addResult(String(i), { name: 'P' + i, hero: 'knight', time: i * 10, kills: i });
	const top = st.top(week, '2');
	assert.equal(top.length, 10);
	assert.equal(top[0].name, 'Третий');
	assert.equal(top[0].lord, true);
	assert.equal(top[1].kills, 2000);
	assert.equal(top[1].me, true);
	assert.ok(top.every((r) => !('uid' in r)));
	clock.t += BOARD_MIN_INTERVAL_MS;
	await Promise.all(st.tick());
	const saved = JSON.parse(b.data.get(boardKey(week)));
	assert.equal(Object.keys(saved.rows).length, 18);
	assert.ok(!saved.rows['4']);
	// A new week starts its own object.
	const next = new Date(Date.UTC(2026, 10, 16, 0, 30));
	st.addResult('2', { name: 'Вторая', hero: 'knight', time: 60, kills: 3 }, next);
	await settle();
	assert.equal(st.top('2026-W47').length, 1);
	assert.equal(st.top(week)[0].name, 'Третий');
}

// --- the weekly board while the storage is down: kept in memory, not written over an unread object ---
{
	const b = stub();
	b.fail = true;
	const { st, clock } = makeStore(b);
	st.addResult('2', { name: 'Вторая', hero: 'knight', win: true, time: 900, kills: 10 });
	await settle();
	clock.t += 60_000;
	await Promise.all(st.tick());
	await settle();
	assert.equal(b.puts.length, 0);
	b.fail = false;
	b.data.set(boardKey(isoWeek(new Date(clock.t))), JSON.stringify({ schema: 1, rows: { '8': { name: 'Был', hero: 'witch', time: 100, kills: 1 } } }));
	clock.t += 10 * 60_000;
	st.tick();
	await settle();
	assert.equal(st.top(isoWeek(new Date(clock.t))).length, 2);
}

// --- the room's run-end hook: server counts, `tot` in `over` for portal users only ---
{
	const sent = [];
	const r = new Room('V22', (pid, msg) => sent.push([pid, msg]));
	r.setMode('lunch');
	r.addPlayer(1, 'Портал', 'knight');
	r.addPlayer(2, 'Гость', 'witch');
	const calls = [];
	r.onRunEnd = (info) => {
		calls.push(info);
		return new Map([[1, { wins: 1, knightBest: 0, revives: 0, knifeKills: 0, bosses: 0, lords: 0 }]]);
	};
	r.start();
	r.enemies.length = 0;
	r.time = 120;
	r.heroes.get(1).weapons.set('thunderslash', { lvl: 1, t: 0 });
	r.finish(true);
	const over = sent.filter(([, m]) => m.t === 'over').at(-1)[1];
	assert.equal(calls.length, 1);
	assert.equal(calls[0].mode, 'lunch');
	assert.equal(calls[0].players, 2);
	assert.equal(calls[0].stats.find((s) => s.pid === 1).ach.wins, 1);
	assert.deepEqual(calls[0].duos.get(1), ['thunderslash']);
	assert.deepEqual(over.stats.find((s) => s.pid === 1).tot.wins, 1);
	assert.equal(over.stats.find((s) => s.pid === 2).tot, undefined);
	// A broken hook does not stop the results.
	const r2 = new Room('V22B', (pid, msg) => sent.push([pid, msg]));
	r2.addPlayer(1, 'P', 'knight');
	r2.onRunEnd = () => {
		throw new Error('boom');
	};
	r2.start();
	const errLog = console.error;
	console.error = () => {};
	r2.finish(false);
	console.error = errLog;
	assert.equal(r2.state, 'over');
	void TICK_HZ;
}

// --- the real backend: 404/410 are «no object», 302 is followed without the key, errors throw ---
{
	const calls = [];
	const fake = async (url, opts = {}) => {
		calls.push({ url, key: opts.headers?.['X-Api-Key'] ?? null, method: opts.method ?? 'GET' });
		const res = (status, body = '', headers = {}) => new Response(status === 302 || status === 204 ? null : body, { status, headers });
		if (url.includes('missing')) return res(404, '{"error":{"code":"STORAGE_OBJECT_NOT_FOUND"}}');
		if (url.includes('gone')) return res(410, '{"error":{"code":"STORAGE_OBJECT_DELETED"}}');
		if (url.includes('busy')) return res(409, '{"error":{"code":"STORAGE_KEY_CONFLICT"}}');
		if (url.startsWith('https://s3.example/')) return res(200, '{"schema":1}');
		if (url.includes('/upload')) return res(opts.body.get('key').includes('busy') ? 409 : 200, '{"error":{"code":"STORAGE_KEY_CONFLICT"},"object":{}}');
		return res(302, '', { location: 'https://s3.example/obj?sig=1' });
	};
	const be = vibeBackend('test-key', { fetchImpl: fake });
	assert.equal(await be.get('players/missing.json'), null);
	assert.equal(await be.get('players/gone.json'), null);
	assert.equal(await be.get('players/1.json'), '{"schema":1}');
	assert.equal(calls.find((c) => c.url.startsWith('https://s3.example/')).key, null);
	await be.put('players/1.json', '{}');
	await assert.rejects(be.put('players/busy.json', '{}'), /409 STORAGE_KEY_CONFLICT/);
	await assert.rejects(be.get('players/busy.json'), /409/);
}

console.log('v22-test: ok');
