// v19 checks (audit of v18.1): dropped connections, a player leaving mid-run, the cursed chest wave, warning times,
// the Knight's time, spawn with a downed ally. node server/v19-test.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { Room, Hub } from './game.js';
import {
	TICK_HZ, ENEMIES, WARN_MIN, EVENTS, EVENT_INDEX, enemyHpScale, bossHpScale, enemyDmgScale, modeDmgMul, modeHpMul,
	spawnRateScale, REVIVE_SECONDS,
} from '../public/shared/content.js';

const dt = 1 / TICK_HZ;
const sent = [];
function room(heroes = ['knight', 'witch'], mode = 'night') {
	const r = new Room('V19', (pid, msg) => sent.push([pid, msg]));
	r.setMode(mode);
	heroes.forEach((hero, i) => r.addPlayer(i + 1, 'P' + (i + 1), hero));
	r.start();
	r.enemies.length = 0;
	r.time = 400;
	r.events.next = Infinity;
	return r;
}
const hero = (r, pid) => r.heroes.get(pid);
const alive = (r) => [...r.heroes.values()].filter((h) => h.st === 0);

// --- 2. dropped connection: the hero lies down, can be lifted; nobody online — the run waits ---
{
	const r = room();
	const [a, b] = [hero(r, 1), hero(r, 2)];
	r.setOffline(2, true);
	assert.equal(b.st, 1, 'dropped hero lies down at once');
	assert.ok(r.fx.some((f) => f[0] === 'down' && f[1] === 2));
	assert.equal(r.state, 'play');
	assert.ok(!r.frozen, 'the other one keeps playing');
	assert.deepEqual(r.runLog.p.get(2).downs.at(-1)[1], 'offline');
	// The ally lifts it.
	a.x = b.x + 20;
	a.y = b.y;
	for (let i = 0; i < (REVIVE_SECONDS + 0.5) * TICK_HZ; i++) {
		r.time += dt;
		r.updateRevive(dt);
	}
	assert.equal(b.st, 0, 'an ally can lift a dropped hero');
	// Both away: the run waits instead of ending.
	r.setOffline(1, true);
	assert.ok(r.frozen && r.state === 'play', 'all offline → frozen, not lost');
	assert.equal(a.st, 0, 'the last one online is not downed');
	r.setOffline(1, false);
	assert.ok(!r.frozen, 'back online → the run goes on');
	assert.deepEqual(r.runLog.p.get(1).drops.at(-1).length, 2);
	assert.ok(r.runLog.p.get(1).drops.at(-1)[1] !== null, 'return logged');
	// Solo: never downed by a drop, the run just waits.
	const s = room(['knight']);
	s.setOffline(1, true);
	assert.ok(s.frozen && hero(s, 1).st === 0, 'solo drop pauses');
	s.setOffline(1, false);
	assert.ok(!s.frozen);
	// Hub: a dropped player in a run is reported, a lobby player is not.
	const hub = new Hub(() => {});
	hub.addPlayer(7, 'X');
	assert.equal(hub.inRun(7), false);
	console.log('offline: OK');
}

// --- 3. a player leaves mid-run: enemies, bosses and mode multipliers follow the new size ---
for (const mode of ['night', 'lunch']) {
	const r = room(['knight', 'witch'], mode);
	r.time = mode === 'night' ? 540 : 360;
	const nt = r.nt;
	const e = r.spawnEnemy('skel', alive(r), enemyHpScale(nt, 2));
	const boss = r.spawnBoss('ram', alive(r), 2);
	const [hp, bhp, dmg] = [e.maxHp, boss.maxHp, e.dmg];
	r.removePlayer(2);
	const k = (enemyHpScale(nt, 1) / enemyHpScale(nt, 2)) * (modeHpMul(mode, 1) / modeHpMul(mode, 2));
	assert.ok(Math.abs(e.maxHp / hp - k) < 1e-9, `${mode}: enemy hp rescaled`);
	assert.ok(Math.abs(boss.maxHp / bhp - (bossHpScale(nt, 1) / bossHpScale(nt, 2)) * (modeHpMul(mode, 1) / modeHpMul(mode, 2))) < 1e-9, `${mode}: boss hp rescaled`);
	assert.ok(boss.maxHp < bhp * 0.6, `${mode}: a solo boss is much weaker`);
	const dk = (enemyDmgScale(nt, 1) / enemyDmgScale(nt, 2)) * (modeDmgMul(mode, 1) / modeDmgMul(mode, 2));
	assert.ok(Math.abs(e.dmg / dmg - dk) < 1e-9, `${mode}: damage rescaled (pair discount gone)`);
	assert.equal(r.modeDmg, modeDmgMul(mode, 1));
	const fresh = r.spawnEnemy('skel', alive(r), enemyHpScale(r.nt, 1));
	assert.ok(Math.abs(fresh.dmg - e.dmg) < 1e-9, `${mode}: old and new enemies hit alike`);
	assert.deepEqual(r.runLog.left.at(-1).slice(1), [2, 1]);
}
console.log('leave rescale: OK');

// --- 4. cursed chest: the wave counts alive players inside the ring around the opener ---
{
	const count = (heroes, far) => {
		const r = room(heroes);
		r.events.force = 'cursed';
		r.events.next = 0;
		r.events.tick(alive(r));
		const ev = r.events.active;
		const list = [...r.heroes.values()];
		list.forEach((h, i) => { h.x = ev.x + (i && far ? 2000 : i * 30); h.y = ev.y; });
		r.events.tick(alive(r));
		return r.events.cur.log.wave;
	};
	const C = EVENTS[EVENT_INDEX.cursed];
	const solo = count(['knight'], false);
	assert.equal(count(['knight', 'witch', 'ranger', 'herald'], true), solo, 'others far away: a solo-sized wave');
	const all = count(['knight', 'witch', 'ranger', 'herald'], false);
	assert.ok(Math.abs(all / solo - spawnRateScale(4)) < 0.15, `all four inside: ×${spawnRateScale(4)} (${all} vs ${solo})`);
	assert.ok(C.ring > 0);
	console.log('cursed wave: OK');
}

// --- 6. warnings ≥ WARN_MIN for charges, blinks and the Lord's wave ---
{
	for (const id of ['ram', 'brood', 'shield']) assert.ok(ENEMIES[id].dashWarn >= WARN_MIN, `${id} dash warn`);
	assert.ok(ENEMIES.twinhalf.blinkWarn >= WARN_MIN, 'twin half blink warn');
	assert.ok(ENEMIES.boss.wave.warn >= WARN_MIN, 'lord wave warn');
	assert.ok(ENEMIES.bloater.fuse < WARN_MIN, 'the bloater stays short on purpose');
	// The emitted telegraph carries it.
	const r = room(['knight']);
	const ram = r.spawnBoss('ram', alive(r), 0);
	ram.x = 300;
	ram.y = 0;
	ram.dcd = 0;
	r.fx.length = 0;
	r.dashTick(ram, hero(r, 1), 300, dt, true);
	const lane = r.fx.find((f) => f[0] === 'bline');
	assert.ok(lane && lane[6] >= WARN_MIN, 'ram lane lasts ≥ 1.2 s');
	console.log('warnings: OK');
}

// --- 7. the Knight's time counts to his last down; a lifted Knight goes on ---
{
	const r = room(['knight', 'witch']);
	const k = hero(r, 1);
	r.time = 70;
	k.iframes = 0;
	r.hurtPlayer(k, 1e6, 'test');
	assert.equal(k.st, 1);
	r.time = 305;
	assert.equal(r.runAchievements(k, true).knightBest, 70, 'downed Knight: time to the down');
	k.st = 0;
	k.hp = 50;
	assert.equal(r.runAchievements(k, true).knightBest, 305, 'lifted Knight: counts on');
	console.log('knight time: OK');
}

// --- 9. spawn rate with a downed ally: max(alive, players − 1) ---
{
	const rate = (heroes, down) => {
		const r = room(heroes);
		r.time = 200;
		r.bossIdx = r.bossAt.length;
		for (let i = 0; i < down; i++) hero(r, heroes.length - i).st = 1;
		r.spawnAcc = 0;
		r.spawn(1, alive(r));
		return r.enemies.length + r.spawnAcc;
	};
	const two = rate(['knight', 'witch'], 0), twoDown = rate(['knight', 'witch'], 1), solo = rate(['knight'], 0);
	assert.ok(Math.abs(twoDown - solo) < 1e-6, `pair with one down spawns like solo (${twoDown} vs ${solo})`);
	assert.ok(two > twoDown);
	const four = rate(['knight', 'witch', 'ranger', 'herald'], 0), fourTwoDown = rate(['knight', 'witch', 'ranger', 'herald'], 2);
	assert.ok(Math.abs(fourTwoDown / four - spawnRateScale(3) / spawnRateScale(4)) < 1e-6, 'four with two down spawn like three');
	console.log('spawn with downed: OK');
}
// --- 2 on the real server: a dropped player lies down, comes back to the same run (plain snapshots, protocol 10) ---
{
	const port = 3900 + Math.floor(Math.random() * 90);
	const srv = spawn(process.execPath, [new URL('./server.js', import.meta.url).pathname], { env: { ...process.env, PORT: String(port), HORDE_RUNS_DIR: '/tmp/horde-v19-test' }, stdio: 'ignore' });
	const base = `http://127.0.0.1:${port}`;
	const session = async () => {
		for (let i = 0; i < 50; i++) {
			try { return await (await fetch(`${base}/api/session`)).json(); } catch { await new Promise((ok) => setTimeout(ok, 100)); }
		}
		throw new Error('server did not start');
	};
	const client = (sid) => new Promise((ok) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?sid=${sid}&v=10`);
		const c = { ws, msgs: [], send: (m) => ws.send(JSON.stringify(m)), wait: async (pred, ms = 4000) => {
			const t0 = Date.now();
			for (;;) {
				const m = c.msgs.find(pred);
				if (m) return m;
				if (Date.now() - t0 > ms) throw new Error('timeout');
				await new Promise((r) => setTimeout(r, 30));
			}
		} };
		ws.on('message', (d) => c.msgs.push(JSON.parse(String(d))));
		ws.on('open', () => ok(c));
	});
	try {
		const [s1, s2] = [await session(), await session()];
		const a = await client(s1.sid), b = await client(s2.sid);
		const wb = await b.wait((m) => m.t === 'welcome');
		a.send({ t: 'create', hero: 'knight', mode: 'night' });
		const lobby = await a.wait((m) => m.t === 'lobby');
		b.send({ t: 'join', code: lobby.code, hero: 'witch' });
		await a.wait((m) => m.t === 'lobby' && m.players.length === 2);
		a.send({ t: 'start' });
		await b.wait((m) => m.t === 'start');
		b.ws.close();
		const down = await a.wait((m) => m.t === 's' && m.p.some((r) => r[0] === wb.pid && r[8] === 1));
		assert.ok(down, 'the dropped hero lies down for the others');
		const b2 = await client(s2.sid);
		const back = await b2.wait((m) => m.t === 'welcome');
		assert.equal(back.room, lobby.code, 'back into the same room');
		await b2.wait((m) => m.t === 'start');
		await b2.wait((m) => m.t === 's' && m.p.some((r) => r[0] === wb.pid));
		a.ws.close();
		b2.ws.close();
		console.log('offline on the server: OK');
	} finally {
		srv.kill();
	}
}
console.log('v19-test: OK');
