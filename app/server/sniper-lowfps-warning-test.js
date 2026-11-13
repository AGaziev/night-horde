import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Room, Hub } from './game.js';
import { packFx } from './snapshot-codec.js';
import { PROTO, unpackFx } from '../public/js/snapshot-codec.js';
import { ENEMIES, enemyHpScale, SNAPSHOT_HZ, TICK_HZ } from '../public/shared/content.js';

// Issue #23, PR #33 reviews: one Трубач fan on screen at a time, and every volley along lanes shown before it, when
// frames come slowly (main.js caps a frame's dt at 50 ms), stop for a while (a hidden tab) or stop over a pause that
// starts and ends between two frames. Real path in wall time: Room ticks at 30 Hz → 10 Hz snapshots through the fx
// codec, 60 ms late → the client Game on its own frames, with the pause messages of the server.
let seed = 1;
Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
let wall = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => wall * 1000 }, configurable: true, writable: true });
const file = new URL('../public/js/game.js', import.meta.url);
const source = fs.readFileSync(file, 'utf8').replace("'/shared/content.js'", JSON.stringify(new URL('../public/shared/content.js', import.meta.url).href));
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const S = ENEMIES.sniper, FAN = S.fan, dt = 1 / TICK_HZ, EVERY = Math.round(TICK_HZ / SNAPSHOT_HZ);
const LATENCY = 0.06, T0 = 100, eps = 1e-6, idle = { vector: () => ({ x: 0, y: 0 }) };

function arena(kind, mode) {
	const r = new Room('LOWFPS', () => {}); r.setMode(mode); r.addPlayer(1, 'One', 'knight'); r.start();
	r.enemies.length = 0; r.time = r.runLength * 2 / 3;
	const h = r.heroes.get(1); h.weapons.clear(); h.perk.readyAt = Infinity; h.hp = h.maxHp = 1e9;
	let e;
	if (kind === 'guard') {
		r.updateOutposts([h]); const post = r.outposts.posts[0]; h.x = post.x; h.y = post.y; r.updateOutposts([h]);
		e = r.enemies.find(e => e.outpost === post && e.ai === 'sniper'); assert.ok(e);
		for (const other of r.enemies) if (other !== e) r.killEnemy(other, h);
		r.compactEnemies(); r.time = Math.max(r.time, e.guardReadyAt ?? 0);
		e.x = post.x + 210; e.y = post.y;
	} else {
		e = r.spawnEnemy('sniper', [h], enemyHpScale(r.nt, 1));
		e.x = h.x + 500; e.y = h.y;
	}
	e.shotT = 0; e.windT = 0; e.hp = e.maxHp = 1e9;
	r.fx.length = 0;
	return { r, h, e };
}

const angle = (l) => Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
const along = (a, fan) => fan.some(b => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.03);

// One run in wall time from T0. The sniper aims `warm` s in (out of range before, so the client clock settles).
// Times below are seconds after that aim: `freeze` {at, dur} with the hero moving away meanwhile, `hide` [from, to]
// without frames, `pause` [from, to] on the server (the client gets it LATENCY later). `fps` of the frames.
function run({ kind = 'ordinary', mode = 'lunch', fps = 60, warm = 2, freeze, hide, pause, until = 2.5, label }) {
	seed = 1;
	const { r, h, e } = arena(kind, mode);
	wall = T0;
	const g = new Game({ send() {} }); g.me = 1;
	g.begin({ players: [{ pid: 1, hero: 'knight', name: 'One', x: h.x, y: h.y }] });
	const near = e.x - h.x; // the arena's distance, in range
	e.x = h.x + 3000; e.shotT = 1e9;
	const aim = T0 + warm, end = aim + until;
	const at = (t) => aim + t; // wall time of a moment after the aim
	const queue = []; // client-side arrivals {at, kind, msg | on}
	let fx = [], ticks = 0, tickAt = T0, frameAt = T0 + LATENCY, freezeAt = null, lastFrame = null, gapEnd = T0;
	let lastFan = null, fanSeenAt = -Infinity, volleys = 0, reaimed = 0, fans = 0, lanesAfterPause = null, lanesBeforeHide = 0;
	const orbs = new Set();
	const paused = (t) => pause && t >= at(pause[0]) && t < at(pause[1]);
	if (pause) queue.push({ at: at(pause[0]) + LATENCY, kind: 'pause', on: true }, { at: at(pause[1]) + LATENCY, kind: 'pause', on: false });
	while (Math.min(tickAt, frameAt) < end) {
		if (tickAt <= frameAt) {
			const now = tickAt;
			tickAt += dt;
			if (paused(now)) continue;
			r.time += dt; r.fx.length = 0;
			if (e.shotT > 1e8 && now >= aim - eps) { e.x = h.x + near; e.shotT = 0; }
			if (freeze && freezeAt === null && e.windT > 0 && now >= at(freeze.at) - eps) { assert.ok(r.freeze(e, freeze.dur)); freezeAt = r.time; }
			if (freezeAt !== null && r.time < freezeAt + freeze.dur) h.y += 220 * dt;
			r.moveEnemies(dt, [h]);
			if (r.fx.some(ev => ev[0] === 'bline') && fans++ && !volleys) reaimed++;
			if (r.fx.some(ev => ev[0] === 'eorb')) { volleys++; r.hostile.length = 0; }
			fx.push(...r.fx);
			if (++ticks % EVERY) continue;
			const tm = Math.round(r.time * 100) / 100, packed = packFx(fx, Math.round(tm * 1000));
			queue.push({ at: now + LATENCY, kind: 'snap', msg: { t: 's', tm, fx: unpackFx(packed.f, packed.fv, packed.fn, Math.round(tm * 1000)) } });
			fx = [];
			continue;
		}
		const now = frameAt;
		frameAt += 1 / fps;
		queue.sort((a, b) => a.at - b.at);
		while (queue.length && queue[0].at <= now) {
			const m = queue.shift();
			wall = m.at; // messages arrive between frames
			if (m.kind === 'snap') g.onSnapshot(m.msg); else g.setPause(m.on, true);
		}
		if (hide && now > at(hide[0]) && now < at(hide[1])) continue;
		if (lastFrame !== null && now - lastFrame > 1.5 / fps) gapEnd = now;
		const raw = lastFrame === null ? 1 / fps : now - lastFrame;
		wall = now; lastFrame = now;
		g.update(Math.min(0.05, Math.max(0, raw)), idle);
		const lanes = g.blines.length;
		assert.ok(lanes === 0 || lanes === FAN, `${label}: one fan on screen, not ${lanes} lanes`);
		if (pause && lanesAfterPause === null && now > at(pause[1]) + LATENCY) lanesAfterPause = lanes;
		if (hide && now <= at(hide[0])) lanesBeforeHide = lanes;
		const fan = lanes ? g.blines.map(angle) : null;
		for (const [id, o] of g.hostile) if (o.show && o.r && !orbs.has(id)) {
			orbs.add(id);
			// With frames for a while before it, the volley shows along the fan on screen a moment ago.
			if (now - gapEnd < 0.1) continue;
			// (the lanes may end a tick and a frame early: a windup takes 0.9 s or one tick more on the server)
			assert.ok(fan || now - fanSeenAt < 2 / fps + dt + eps, `${label}: a volley never comes without lanes`);
			assert.ok(along(Math.atan2(o.vy, o.vx), fan ?? lastFan), `${label}: orb along the fan last shown`);
		}
		if (fan) { lastFan = fan; fanSeenAt = now; }
	}
	return { volleys, reaimed, orbs: orbs.size / FAN, lanesAfterPause, lanesBeforeHide };
}

// 1. A late Иней at 12/15/30/60 FPS: the windup runs out in the freeze, a new fan comes after it.
let cases = 0, reaimed = 0;
for (const mode of ['lunch', 'night']) for (const kind of ['guard', 'ordinary']) for (const fps of [12, 15, 30, 60])
	for (const warm of [2, 2 + 1 / 30, 2 + 2 / 30]) for (const at of [0.5, 0.7, 0.85]) for (const dur of [0.25, 0.45, 0.65]) {
		const label = `${mode} ${kind} ${fps} FPS, Иней ${dur} s at ${at} s of the windup (phase ${Math.round((warm - 2) * 30)})`;
		const res = run({ kind, mode, fps, warm, freeze: { at, dur }, until: 3, label });
		assert.ok(res.volleys >= 1 && res.orbs >= 1, `${label}: the sniper fires`);
		reaimed += res.reaimed > 0;
		cases++;
	}
assert.ok(reaimed >= cases / 3, `the windup ran out in the freeze in ${reaimed}/${cases} cases`);
console.log(`late Иней at 12/15/30/60 FPS, ${cases} cases (${reaimed} aimed anew after the thaw): one fan on screen, volleys along it: OK`);

// 2. A hidden tab (no frames, snapshots keep coming) around a late Иней, back at any moment: the warnings that came
// meanwhile are as old as their server time, so the old fan is gone before the new one and a windup under way shows.
cases = 0;
for (const kind of ['guard', 'ordinary']) for (const at of [0.5, 0.7, 0.85]) for (const dur of [0.25, 0.45, 0.65])
	for (const from of [-1.5, -0.2, 0.3]) for (const back of [0.55, 0.85, 1.0, 1.15, 1.3, 1.6, 2.0]) {
		const label = `${kind} tab hidden ${from}…${back} s around a windup, Иней ${dur} s at ${at} s`;
		run({ kind, warm: 2, freeze: { at, dur }, hide: [from, back], until: 3.5, label });
		cases++;
	}
// Hidden long, back during a later windup.
for (const hide of [3.6, 3.8, 4.0, 4.2, 10]) {
	run({ warm: 12, hide: [0.3, 0.3 + hide], until: hide + 2, label: `hidden ${hide} s from 0.3 s into a windup` });
	cases++;
}
console.log(`hidden tab around late Иней and windups, ${cases} cases: one fan on screen, volleys along the lanes shown: OK`);

// 3. A pause that starts and ends between two frames keeps the lanes: the server stood still meanwhile.
cases = 0;
for (const kind of ['guard', 'ordinary']) for (const fps of [15, 60]) for (const from of [0.35, 0.5, 0.7]) for (const len of [0.3, 1.5, 4]) {
	const label = `${kind} ${fps} FPS, pause ${len} s at ${from} s of the windup between two frames`;
	const res = run({ kind, fps, warm: 2, pause: [from, from + len], hide: [from - 0.05, from + len + 0.2], until: len + 2.5, label });
	assert.equal(res.lanesBeforeHide, FAN, `${label}: the lanes were on screen before the frames stopped`);
	assert.equal(res.lanesAfterPause, FAN, `${label}: the lanes are on screen after the pause`);
	assert.ok(res.orbs >= 1, `${label}: the volley comes`);
	cases++;
}
console.log(`pause between frames, ${cases} cases: lanes kept over it, the volley along them: OK`);

// 4. A page opened before this fix (PROTO 24 ages lanes by its capped frame dt) reloads on the server's welcome.
{
	assert.equal(PROTO, 25);
	const netFile = new URL('../public/js/net.js', import.meta.url);
	const codecUrl = new URL('../public/js/snapshot-codec.js', import.meta.url).href;
	const netSource = fs.readFileSync(netFile, 'utf8').replace("'./snapshot-codec.js'", JSON.stringify(codecUrl));
	const oldSource = 'const PROTO = 24;\n' + netSource.replace('import { PROTO, SnapshotDecoder }', 'import { SnapshotDecoder }');
	const { Net: OldNet } = await import('data:text/javascript;base64,' + Buffer.from(oldSource).toString('base64'));
	const { Net } = await import('data:text/javascript;base64,' + Buffer.from(netSource).toString('base64'));
	let welcome;
	const hub = new Hub((pid, msg) => { if (msg.t === 'welcome') welcome = msg; });
	hub.addPlayer(1, 'One'); hub.welcome(1);
	const storage = new Map();
	let reloads = 0, emitted = 0;
	Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) } });
	Object.defineProperty(globalThis, 'location', { configurable: true, value: { reload() { reloads++; } } });
	const old = Object.create(OldNet.prototype); old.emit = () => emitted++; old.dispatch(welcome);
	assert.equal(reloads, 1, 'a PROTO 24 page reloads to the client that ages lanes on server time');
	assert.equal(emitted, 0, 'the old page does not go on with this welcome');
	const current = Object.create(Net.prototype); current.emit = () => emitted++; current.dispatch(welcome);
	assert.equal(reloads, 1, 'the current page is not reloaded'); assert.equal(emitted, 1);
	delete globalThis.sessionStorage; delete globalThis.location;
	console.log('PROTO 25: a page opened before the fix reloads on the welcome, the current one goes on: OK');
}
