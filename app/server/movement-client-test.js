import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { Room } from './game.js';
import { HEROES } from '../public/shared/content.js';
const source = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8').replace("'/shared/content.js'", JSON.stringify(new URL('../public/shared/content.js', import.meta.url).href));
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const dt = 1 / 60;
function fixture() {
	let now = 0; const pending = [], snaps = [];
	const old = globalThis.performance;
	globalThis.performance = { now: () => now * 1000 };
	const room = new Room('MOVE', (pid, msg) => { if (pid === 1 && msg.t === 's') { snaps.push(msg); pending.push({ at: now + 1.1, msg }); } else if (pid === 1 && msg.t === 'pause') pending.push({ at: now + 1.1, msg }); });
	room.addPlayer(1, 'One', 'knight'); room.start(); room.spawn = () => {};
	const game = new Game({ send: (msg) => room.handle(1, msg) }); game.me = 1;
	const h = room.heroes.get(1); h.x = h.y = 0;
	game.begin({ players: [{ pid: 1, hero: 'knight', x: 0, y: 0 }] });
	return { game, room, pending, snaps, now: (v) => { now = v; }, restore: () => { globalThis.performance = old; } };
}
test('late snapshots compare acknowledged authored position and do not repeatedly reset a moving hero', () => {
	const f = fixture(); const jumps = [];
	try {
		for (let frame = 1; frame <= 360; frame++) {
			const time = frame * dt; f.now(time);
			while (f.pending[0]?.at <= time) { const before = f.game.local.x; f.game.onSnapshot(f.pending.shift().msg); if (before - f.game.local.x > 50) jumps.push([before, f.game.local.x]); }
			f.game.update(dt, { vector: () => ({ x: 1, y: 0 }) });
			if (frame % 2 === 0) f.room.tick(1 / 30);
		}
		assert.deepEqual(jumps, [], 'healthy server with 1100ms downstream latency must not repeatedly move hero backwards');
		assert.ok(f.game.local.x > 600, `movement continues after snapshots start arriving, x=${f.game.local.x}`);
		assert.ok(f.snaps.some((s) => s.pa?.some(([pid, seq]) => pid === 1 && seq > 0)), 'server snapshots acknowledge position sequence');
	} finally { f.restore(); }
});
test('total snapshot loss permits bounded movement, explicit solo pause freezes both position and render time', () => {
	const f = fixture();
	try {
		f.room.snapshot(); f.now(0); f.game.onSnapshot(f.snaps.at(-1));
		for (let frame = 1; frame <= 120; frame++) { f.now(frame * dt); f.game.update(dt, { vector: () => ({ x: 1, y: 0 }) }); }
		assert.ok(f.game.local.x <= HEROES.knight.speed * .55, `prediction is bounded after snapshots stop, x=${f.game.local.x}`);
		const tm = f.game.view.tm;
		f.game.setPause(true, true);
		const x = f.game.myRow()[1];
		assert.equal(f.game.local.x, x, 'pause discards unacknowledged prediction even during snapshot loss');
		for (let frame = 121; frame <= 180; frame++) { f.now(frame * dt); f.game.update(dt, { vector: () => ({ x: 1, y: 0 }) }); }
		assert.equal(f.game.local.x, x); assert.equal(f.game.view.tm, tm);
		f.game.setPause(false, false); f.now(4); f.game.update(dt, { vector: () => ({ x: 1, y: 0 }) });
		assert.equal(f.game.view.tm, tm, 'resume waits for fresh server progress');
	} finally { f.restore(); }
});

test('optional movement epochs reject old acknowledgements without requiring a dash implementation', () => {
	const f = fixture();
	try {
		f.game.pendingPositions.set(10, { x: 0, y: 0, epoch: 0 });
		f.game.moveEpoch = 1; f.game.local.x = 500;
		f.room.heroes.get(1).x = 0;
		const old = f.room.snapshot(); old.pa = [[1, 10, 0]];
		f.game.onSnapshot(old); assert.equal(f.game.local.x, 500);
		f.game.pendingPositions.set(11, { x: 500, y: 0, epoch: 1 });
		f.now(.1); const next = f.room.snapshot(); next.tm = .1; next.pa = [[1, 11, 1]];
		f.game.onSnapshot(next); assert.equal(f.game.local.x, 0, 'a real server correction in current epoch still applies');
	} finally { f.restore(); }
});

test('live incoming snapshots cannot extend prediction when outgoing positions make no acknowledgement progress', () => {
	const f = fixture(); const queued = [];
	try {
		f.room.snapshot(); f.game.onSnapshot(f.snaps.at(-1));
		f.game.net.send = (msg) => { if (msg.t === 'pos') queued.push(msg); };
		for (let frame = 1; frame <= 288; frame++) {
			f.now(frame * dt); f.game.update(dt, { vector: () => ({ x: 1, y: 0 }) });
			if (frame % 2 === 0) { f.room.tick(1 / 30); f.game.onSnapshot(f.snaps.at(-1)); }
		}
		assert.ok(f.game.local.x <= HEROES.knight.speed * .55, `outgoing outage must be bounded independently of fresh snapshots, x=${f.game.local.x}`);
		assert.equal(f.room.heroes.get(1).x, 0);
		const before = f.game.local.x;
		for (const msg of queued) f.room.handle(1, msg);
		f.room.snapshot(); f.game.onSnapshot(f.snaps.at(-1));
		assert.ok(Math.abs(f.game.local.x - before) <= 1, 'recovered acknowledgements do not cause a large rollback');
		f.game.net.send = (msg) => f.room.handle(1, msg);
		for (let frame = 289; frame <= 348; frame++) {
			f.now(frame * dt); f.game.update(dt, { vector: () => ({ x: 1, y: 0 }) });
			if (frame % 2 === 0) { f.room.tick(1 / 30); f.game.onSnapshot(f.snaps.at(-1)); }
		}
		assert.ok(f.game.local.x > before + 100, 'stationary position probes allow movement to recover after the outage');
	} finally { f.restore(); }
});

test('an outgoing stall after established 1100ms latency has a bounded tail and recovers without backwards correction', () => {
	const f = fixture(); const queued = []; let blocked = false, acceptedAtBlock, maxTail = 0;
	f.game.net.send = (msg) => { if (blocked && msg.t === 'pos') queued.push(msg); else f.room.handle(1, msg); };
	try {
		for (let frame = 1; frame <= 600; frame++) {
			const time = frame * dt; f.now(time);
			if (frame === 181) { blocked = true; acceptedAtBlock = f.room.heroes.get(1).x; }
			if (frame === 469) { blocked = false; for (const msg of queued) f.room.handle(1, msg); }
			while (f.pending[0]?.at <= time) {
				const before = f.game.local.x; f.game.onSnapshot(f.pending.shift().msg);
				assert.ok(before - f.game.local.x < 50, `no large recovery rollback at ${time}: ${before} -> ${f.game.local.x}`);
			}
			f.game.update(dt, { vector: () => ({ x: 1, y: 0 }) });
			if (blocked) maxTail = Math.max(maxTail, f.game.local.x - acceptedAtBlock);
			if (frame % 2 === 0) f.room.tick(1 / 30);
		}
		assert.ok(maxTail <= HEROES.knight.speed * 1.55, `acknowledged latency budget cannot grow forever: ${maxTail}`);
		assert.ok(f.game.local.x > acceptedAtBlock + maxTail + 50, 'motion resumes after acknowledgements recover');
		assert.ok(f.game.pendingPositions.size <= 256);
	} finally { f.restore(); }
});

test('delayed solo pause discards the rejected prediction tail before resume with input released', () => {
	const f = fixture(); let frozenX, rejectedTail = 0;
	try {
		for (let frame = 1; frame <= 420; frame++) {
			const time = frame * dt; f.now(time);
			if (frame === 192) { f.room.setPaused(true); frozenX = f.room.heroes.get(1).x; }
			if (frame === 300) f.room.setPaused(false);
			while (f.pending[0]?.at <= time) {
				const { msg } = f.pending.shift();
				if (msg.t === 'pause') f.game.setPause(msg.on, msg.menu); else f.game.onSnapshot(msg);
			}
			f.game.update(dt, { vector: () => ({ x: time < 4.5 ? 1 : 0, y: 0 }) });
			if (time > 3.2 && time < 4.2) rejectedTail = Math.max(rejectedTail, f.game.local.x - frozenX);
			if (frame % 2 === 0) f.room.tick(1 / 30);
		}
		assert.ok(rejectedTail > 100, `fixture includes substantial unaccepted movement before pause arrives: ${rejectedTail}`);
		assert.ok(Math.abs(f.room.heroes.get(1).x - frozenX) < .2, `resume without input cannot commit the rejected tail: ${frozenX} -> ${f.room.heroes.get(1).x}`);
		assert.ok(Math.abs(f.game.local.x - frozenX) < .2, 'client stays at accepted paused coordinate');
	} finally { f.restore(); }
});
