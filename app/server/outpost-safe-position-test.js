import assert from 'node:assert/strict';
import { Room } from './game.js';
import { OUTPOST } from './outposts.js';

const live = (r, p) => r.enemies.filter(e => !e.dead && e.outpost === p);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function setup(mode) {
	const random = Math.random; let seed = 19;
	Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
	try {
		const sent = [], r = new Room('SAFE-POSITION', (pid, m) => sent.push({ pid, m })); r.setMode(mode);
		for (let pid = 1; pid <= 8; pid++) r.addPlayer(pid, `P${pid}`, 'knight');
		r.start(); r.enemies.length = 0; r.time = r.runLength * 2 / 3;
		const hs = [...r.heroes.values()]; r.updateOutposts(hs);
		const isolation = p => Math.min(...r.outposts.posts.filter(q => q !== p).map(q => distance(p, q)));
		const p = [...r.outposts.posts].sort((a, b) => isolation(b) - isolation(a))[0];
		assert.equal(r.outposts.posts.length, 9);
		assert.ok(isolation(p) > OUTPOST.activation + 300, 'the constructed formation activates only this natural, unchanged post');
		assert.ok(hs.every(h => distance(h, p) >= OUTPOST.minDistance));
		hs[0].x = p.x; hs[0].y = p.y; r.updateOutposts(hs);
		assert.equal(p.spawned, 32); assert.equal(p.pending.length, 8);
		return { r, hs, p, sent, originalPost: { x: p.x, y: p.y } };
	} finally { Math.random = random; }
}
function reserve(mode, remainingLive) {
	const fixture = setup(mode), { r, hs, p } = fixture;
	for (const e of live(r, p).slice(0, 4)) r.killEnemy(e, hs[0]);
	r.compactEnemies(); r.updateOutposts(hs);
	assert.equal(p.spawned, 36); assert.equal(p.killed, 4);
	for (const e of live(r, p).slice(0, 32 - remainingLive)) r.killEnemy(e, hs[0]);
	r.compactEnemies();
	assert.equal(p.spawned, 36); assert.equal(p.killed, 36 - remainingLive);
	assert.equal(live(r, p).length, remainingLive); assert.equal(p.pending.length, 4);
	return fixture;
}
function formation(hs, p, count, radius) {
	for (let i = 0; i < count; i++) {
		hs[i].x = p.x + Math.cos(i * Math.PI * 2 / count) * radius;
		hs[i].y = p.y + Math.sin(i * Math.PI * 2 / count) * radius;
	}
}

// Preserve the native first candidate when the preferred ring is already safe.
for (const mode of ['night', 'lunch']) {
	const { r, p } = setup(mode);
	for (const [i, e] of live(r, p).entries()) {
		const radius = [240, 295, 350, 405][i % 4], angle = i * 2.39996;
		assert.ok(Math.abs(e.x - (p.x + Math.cos(angle) * radius)) < 1e-8);
		assert.ok(Math.abs(e.y - (p.y + Math.sin(angle) * radius)) < 1e-8);
	}
}

// Native dispatch/deaths produce a finite reserve; no post counters or coordinates are overwritten.
for (const mode of ['night', 'lunch']) for (const remainingLive of [0, 31]) {
	const { r, hs, p, sent, originalPost } = reserve(mode, remainingLive);
	formation(hs, p, 4, 130);
	assert.ok(Math.sqrt(240 ** 2 + 130 ** 2 - 2 * 240 * 130 * Math.cos(Math.PI / 4)) < OUTPOST.safeSpawn, 'even the furthest point on R240 is blocked by this formation');
	assert.ok(hs.every(h => distance(h, { x: p.x + 405, y: p.y }) >= OUTPOST.safeSpawn), 'an existing alternative ring has legal points');
	const ids = new Set(r.enemies.map(e => e.id)), killed = p.killed, want = Math.min(4, 32 - remainingLive);
	r.updateOutposts(hs);
	assert.equal(p.spawned, 36 + want, `${mode}/${remainingLive}: safe reserves dispatch without moving the formation`);
	assert.equal(p.pending.length, 4 - want); assert.equal(p.killed, killed, 'search does not fabricate combat deaths');
	assert.equal(live(r, p).length, remainingLive + want); assert.equal(p.chest, 0);
	const fresh = live(r, p).filter(e => !ids.has(e.id));
	assert.equal(fresh.length, want);
	assert.ok(Math.abs(distance(fresh[0], p) - 295) < 1e-8, 'the next existing ring is tried before later rings');
	for (const e of fresh) {
		assert.ok(hs.every(h => distance(e, h) >= 200 - 1e-8), 'every actual spawn keeps safe distance 200');
		assert.ok(distance(e, p) <= 405 + 1e-8 && distance(e, p) < OUTPOST.leash);
		assert.equal(e.guardReadyAt, r.time + .9, 'the full preparation window remains');
	}
	assert.equal(r.outposts.creationNt, 600); assert.equal(r.outposts.liveLimit, 32);
	assert.deepEqual({ x: p.x, y: p.y }, originalPost);
	assert.equal(sent.filter(({ m }) => m.t === 'reforge').length, 0, 'spawning reserves grants no victory reward');
	console.log(`safe position ${mode}: native spawned36/live${remainingLive}/pending4 → spawned${p.spawned}/live${live(r, p).length}/pending${p.pending.length}; R295 safe fallback: OK`);
}

// With all existing rings covered, each update must stop after exactly 128 candidate positions.
for (const mode of ['night', 'lunch']) {
	const { r, hs, p, sent, originalPost } = reserve(mode, 0);
	formation(hs, p, 8, 300);
	const outerWorstDistance = Math.sqrt(405 ** 2 + 300 ** 2 - 2 * 405 * 300 * Math.cos(Math.PI / 8));
	assert.ok(outerWorstDistance < OUTPOST.safeSpawn, 'the outermost ring is covered even between octagon vertices');
	const before = { spawned: p.spawned, killed: p.killed, pending: [...p.pending] };
	for (let attempt = 0; attempt < 10; attempt++) {
		const cos = Math.cos; let candidates = 0;
		// An isolated blocked post cannot call spawnEnemy; cos observes only the actual position probes.
		Math.cos = angle => { candidates++; return cos(angle); };
		try { r.updateOutposts(hs); } finally { Math.cos = cos; }
		assert.equal(candidates, 128, 'bounded search visits all 4×32 existing samples once');
		assert.deepEqual({ spawned: p.spawned, killed: p.killed, pending: p.pending }, before);
		assert.equal(live(r, p).length, 0); assert.equal(p.chest, 0); assert.equal(r.outposts.status, 'active');
		r.time += .5;
	}
	assert.deepEqual({ x: p.x, y: p.y }, originalPost);
	assert.equal(sent.filter(({ m }) => m.t === 'reforge').length, 0);
	// Opening the formation releases the same finite reserves, without any reset or invented kills.
	for (const h of hs) { h.x = 0; h.y = 0; }
	hs[0].x = p.x; hs[0].y = p.y; r.updateOutposts(hs);
	assert.equal(p.spawned, 40); assert.equal(p.pending.length, 0); assert.equal(live(r, p).length, 4); assert.equal(p.killed, 36);
	console.log(`safe position ${mode}: all rings blocked for 10 updates, 128 probes/update, no underfoot spawn/death/reward; release: OK`);
}
console.log('Outpost safe positions: preserved first choice, legal alternative rings and bounded fully-blocked control: OK');
