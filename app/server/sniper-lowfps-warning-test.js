import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Room } from './game.js';
import { packFx } from './snapshot-codec.js';
import { unpackFx } from '../public/js/snapshot-codec.js';
import { ENEMIES, enemyHpScale, SNAPSHOT_HZ, TICK_HZ } from '../public/shared/content.js';

// Issue #23, PR #33 review: a late Иней whose freeze outlasts the Трубач windup. The server lets the windup run out
// with the lanes and aims anew after the thaw, so the client must drop the old lanes by then even when it renders
// slowly (main.js caps a frame's dt at 50 ms). Real path: Room ticks → 10 Hz snapshots through the fx codec → the
// client Game on its render clock at 15/30/60 FPS. One fan on screen at a time; every volley flies along the last one.
let wall = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => wall * 1000 }, configurable: true, writable: true });
const file = new URL('../public/js/game.js', import.meta.url);
const source = fs.readFileSync(file, 'utf8').replace("'/shared/content.js'", JSON.stringify(new URL('../public/shared/content.js', import.meta.url).href));
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const S = ENEMIES.sniper, W = S.windup, FAN = S.fan, dt = 1 / TICK_HZ, EVERY = Math.round(TICK_HZ / SNAPSHOT_HZ);
const LATENCY = 0.06, idle = { vector: () => ({ x: 0, y: 0 }) };

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
function run({ kind, mode, fps, phase, at, dur }) {
	const { r, h, e } = arena(kind, mode);
	const label = `${mode} ${kind} ${fps} FPS, snapshot phase ${phase}, Иней ${dur} s at ${at} s of the windup`;
	wall = 100;
	const g = new Game({ send() {} }); g.me = 1;
	g.begin({ players: [{ pid: 1, hero: 'knight', name: 'One', x: h.x, y: h.y }] });
	const seenOrb = new Set();
	const inbox = [];
	let fx = [], ticks = phase, lastFan = null, volleys = 0, fans = 0, firstVolleyFans = 0, freezeAt = null;
	const t0 = r.time, end = t0 + at + dur + 2.5 * W;
	let nextFrame = wall + LATENCY + 0.5 / fps;
	while (r.time < end) {
		r.time += dt; r.fx.length = 0;
		if (freezeAt === null && e.windT > 0 && r.time - t0 >= at) { assert.ok(r.freeze(e, dur)); freezeAt = r.time; }
		if (freezeAt !== null && r.time < freezeAt + dur) h.y += 220 * dt; // the hero moves away during the control
		r.moveEnemies(dt, [h]);
		fans += r.fx.filter(ev => ev[0] === 'bline').length / FAN;
		if (r.fx.some(ev => ev[0] === 'eorb')) {
			firstVolleyFans ||= fans;
			r.hostile.length = 0; // the hero stays unhurt
		}
		fx.push(...r.fx);
		if (++ticks % EVERY) continue;
		const tm = Math.round(r.time * 100) / 100, packed = packFx(fx, Math.round(tm * 1000));
		inbox.push({ arrive: 100 + (r.time - t0) + LATENCY, msg: { t: 's', tm, fx: unpackFx(packed.f, packed.fv, packed.fn, Math.round(tm * 1000)) } });
		fx = [];
		// Render every frame up to the newest server time, with the frame cap of main.js.
		while (nextFrame <= 100 + (r.time - t0) + LATENCY) {
			while (inbox.length && inbox[0].arrive <= nextFrame) g.onSnapshot(inbox.shift().msg);
			const raw = nextFrame - wall;
			wall = nextFrame;
			g.update(Math.min(0.05, Math.max(0, raw)), idle);
			const lanes = g.blines.length;
			assert.ok(lanes === 0 || lanes === FAN, `${label}: one fan on screen, not ${lanes} lanes`);
			const now = lanes ? g.blines.map(angle) : null;
			for (const [id, o] of g.hostile) if (o.show && o.r && !seenOrb.has(id)) {
				// An orb shows up on the client: it flies along the lanes still on screen, or the ones just gone.
				seenOrb.add(id);
				const shown = now ?? lastFan, a = Math.atan2(o.vy, o.vx);
				assert.ok(shown, `${label}: a volley never comes without lanes`);
				assert.ok(shown.some(b => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.03), `${label}: orb along the fan last shown`);
				volleys += 1 / FAN;
			}
			if (now) lastFan = now;
			nextFrame += 1 / fps;
		}
	}
	assert.ok(freezeAt !== null && volleys >= 1, `${label}: frozen, then fires`);
	return { reaimed: firstVolleyFans > 1 }; // the windup ran out in the freeze, a new fan came after it
}

let cases = 0, reaimed = 0;
for (const mode of ['lunch', 'night']) for (const kind of ['guard', 'ordinary']) for (const fps of [15, 30, 60])
	for (const phase of [0, 1, 2]) for (const at of [0.5, 0.7, 0.85]) for (const dur of [0.25, 0.45, 0.65]) {
		reaimed += run({ kind, mode, fps, phase, at, dur }).reaimed;
		cases++;
	}
assert.ok(reaimed >= cases / 3, `the windup ran out in the freeze in ${reaimed}/${cases} cases`);
console.log(`late Иней at 15/30/60 FPS, ${cases} cases (${reaimed} aimed anew after the thaw): never more than one fan on screen, every volley along it: OK`);
