// Snapshot codec test: node server/codec-test.js
// A client decoder fed the delta stream (with dropped messages and reconnects) must rebuild exactly the plain snapshot.
import assert from 'node:assert/strict';
import { SnapshotEncoder, packFx, KEY_EVERY } from './snapshot-codec.js';
import { SnapshotDecoder, unpackFx, tmMilliOf } from '../public/js/snapshot-codec.js';

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const STRIDES = { e: 6, g: 4, z: 4, tr: 5, it: 4 };
const world = { tm: 0, nextId: 1, enemies: [], gems: [], players: [] };
for (let pid = 1; pid <= 4; pid++) world.players.push({ pid, x: ri(-500, 500), y: ri(-500, 500), w: [['bolt', 1]] });

function step() {
	world.tm = Math.round((world.tm + 0.1) * 100) / 100;
	for (const en of world.enemies) {
		const far = rnd() < 0.02;
		en.x += far ? ri(-400, 400) : ri(-9, 9);
		en.y += far ? ri(-400, 400) : ri(-9, 9);
		if (rnd() < 0.15) en.hp = Math.max(1, en.hp - ri(1, 20));
		if (rnd() < 0.05) en.st ^= 1 << ri(0, 8);
	}
	world.enemies = world.enemies.filter(() => rnd() > 0.03);
	// Swap-remove, like the server does for some lists: order changes, the set does not.
	for (let k = 0; k < 3 && world.gems.length > 1; k++) {
		const i = ri(0, world.gems.length - 2);
		world.gems[i] = world.gems.pop();
	}
	const add = world.enemies.length < 300 ? ri(5, 40) : ri(0, 8);
	for (let i = 0; i < add; i++) world.enemies.push({ id: world.nextId++, type: ri(0, 20), x: ri(-3000, 3000), y: ri(-3000, 3000), hp: 100, st: 0 });
	if (rnd() < 0.3) world.gems.push({ id: world.nextId++, x: ri(-900, 900), y: ri(-900, 900), t: ri(0, 3) });
	world.gems = world.gems.filter(() => rnd() > 0.02);
	for (const g of world.gems) if (rnd() < 0.05) { g.x += ri(-40, 40); g.y += ri(-12, 12); }
	for (const p of world.players) {
		p.x += ri(-20, 20);
		p.y += ri(-20, 20);
		if (rnd() < 0.05) p.w = [...p.w, ['knives', ri(1, 5)]];
	}
}

function plain() {
	const e = [];
	for (const en of world.enemies) e.push(en.id, en.type, en.x, en.y, en.hp, en.st);
	const g = [];
	for (const gm of world.gems) g.push(gm.id, gm.x, gm.y, gm.t);
	const t = world.tm;
	const msg = {
		t: 's', tm: t, k: world.nextId, syn: 10, boss: rnd() < 0.5 ? null : [100, 200, 3],
		p: world.players.map((p) => [p.pid, p.x, p.y, 50, 100, 3, 1.5, 20, 0, 0, 0.71, -0.71, p.w, 0]),
		e, b: [], g, z: [], tr: rnd() < 0.5 ? [] : [world.nextId, 1, 2, 0, 1], it: [],
		fx: [
			['hit', ri(-3000, 3000), ri(-3000, 3000), ri(1, 999)], ['hit', 10, 20, 30, 1, 2],
			['shot', 9, 2, 1.5, -2.25, 312.5, -0.333, 1.2, -1, Math.round((t - 0.033) * 1000) / 1000],
			['pend', 9, 3, 4, Math.round((t - 0.067) * 1000) / 1000], ['boss', 'Владыка ночи'],
			['newfx', 1, 'str', [1, 2], null, true, 1e300, -0.5], ['zap', 0, -320, 0, 0], 'oddity',
			['peakw', 2], ['peak', 0], ['pring', -120, 340, 431], ['dawn', 57],
		],
	};
	// Optional top-level field (active peak) comes and goes between snapshots.
	if (rnd() < 0.4) msg.pk = [ri(0, 3), Math.round(rnd() * 300) / 10, 30];
	return msg;
}

// Rows are compared as sets: the delta chain keeps arrival order, the server may reorder its lists.
const STR = { ...STRIDES, b: 5 };
const canon = (s) => {
	const o = JSON.parse(JSON.stringify(s));
	delete o.sq;
	for (const [k, w] of Object.entries(STR)) {
		const rows = [];
		for (let i = 0; i < o[k].length; i += w) rows.push(JSON.stringify(o[k].slice(i, i + w)));
		o[k] = rows.sort();
	}
	o.p = o.p.map((r) => JSON.stringify(r)).sort();
	return o;
};

// fx round trip is exact, including floats and unknown names.
{
	const s = plain();
	const p = packFx(s.fx, tmMilliOf(s.tm));
	assert.deepEqual(unpackFx(p.f, JSON.parse(JSON.stringify(p.fv)), p.fn, tmMilliOf(s.tm)), JSON.parse(JSON.stringify(s.fx)));
}

const enc = new SnapshotEncoder(STRIDES);
// Clients: a steady one, a lossy one, one that reconnects; plus a late joiner.
const clients = [
	{ name: 'steady', dec: new SnapshotDecoder(), drop: 0, needKey: true },
	{ name: 'lossy', dec: new SnapshotDecoder(), drop: 0.1, needKey: true },
	{ name: 'reconnect', dec: new SnapshotDecoder(), drop: 0, needKey: true },
];
let bytesDelta = 0, bytesPlain = 0, gaps = 0, n = 0;
for (let i = 0; i < 600; i++) {
	step();
	const s = plain();
	const out = enc.encode(s);
	const dj = JSON.stringify(out.delta);
	bytesDelta += out.isKey ? JSON.stringify(out.key()).length : dj.length;
	bytesPlain += JSON.stringify(s).length;
	n++;
	if (i === 200) clients.push({ name: 'late', dec: new SnapshotDecoder(), drop: 0, needKey: true });
	for (const c of clients) {
		if (c.name === 'reconnect' && i % 97 === 50) { c.dec.reset(); c.needKey = true; } // server sees resync
		if (rnd() < c.drop) continue; // dropped in transit; the next delta reveals the gap
		const wire = JSON.parse(c.needKey || out.isKey ? JSON.stringify(out.key()) : dj);
		c.needKey = false;
		const got = c.dec.decode(wire);
		if (!got) { gaps++; c.needKey = true; continue; } // client asks for a key
		assert.deepEqual(canon(got), canon(s), `${c.name} at ${i}`);
	}
}
assert.ok(gaps > 10, 'lossy client hit gaps');
console.log(`codec: ok (${n} snapshots, ${gaps} gaps recovered, wire ${Math.round(bytesDelta / n)} B vs plain ${Math.round(bytesPlain / n)} B, key every ${KEY_EVERY})`);
