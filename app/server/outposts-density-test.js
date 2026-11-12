import assert from 'node:assert/strict';
import { Room } from './game.js';
import { ENEMIES, ENEMY_TYPES, MAX_ENEMIES } from '../public/shared/content.js';

function setup(n = 1, mode = 'night') {
	const sent = [], r = new Room('DENSITY', (pid, m) => sent.push({ pid, m }));
	r.setMode(mode);
	for (let i = 1; i <= n; i++) r.addPlayer(i, `P${i}`, 'knight');
	r.start(); r.enemies.length = 0; r.time = r.runLength * 2 / 3;
	r.bossIdx = r.bossAt.length;
	const hs = [...r.heroes.values()];
	r.updateOutposts(hs);
	return { r, hs, net: r.outposts, sent };
}
const liveGuards = (r, p) => r.enemies.filter(e => !e.dead && e.outpost && (!p || e.outpost === p));
const ordinary = r => r.enemies.filter(e => !e.dead && !e.outpost);
function approach(r, hs, p) { hs[0].x = p.x; hs[0].y = p.y; r.updateOutposts(hs); }
function allPosts(r, hs) {
	// Real separation: previously activated camps stay alive after the visitor leaves.
	r.outposts.posts.forEach((p, i) => { p.x = i * 2400; p.y = 5000; });
	for (const p of r.outposts.posts) approach(r, hs, p);
}
function fillOrdinary(r, hs, n) { while (ordinary(r).length < n) r.spawnEnemy('bat', hs, 1); }
const composition = types => types.reduce((counts, type) => { counts[type] = (counts[type] ?? 0) + 1; return counts; }, {});
const roster = { skel: 36, brute: 2, shield: 1, sniper: 1 };
// Preserve the exact v3.2 initial wave; only the finite tail changes.
const firstWave = ['brute', 'shield', 'brute', 'sniper'].flatMap(type => [...Array(7).fill('skel'), type]);

// Counts are fixed at network creation, including finite reserves, in both modes.
for (const n of [1, 2, 4, 7, 8]) for (const mode of ['night', 'lunch']) {
	const { r, hs, net } = setup(n, mode), total = 40, p = net.posts[0];
	approach(r, hs, p);
	assert.equal(p.spawned, Math.min(40, Math.floor(288 / (n + 1))), `${mode}/${n}: reserved live garrison`);
	assert.equal(p.total, total);
	assert.equal(net.guardsPerPost, total);
	assert.equal(net.liveLimit, Math.min(40, Math.floor(288 / (n + 1))));
	const ids = new Set(), types = [];
	for (let wave = 0; wave < 10 && p.killed < total; wave++) {
		r.updateOutposts(hs);
		const guards = liveGuards(r, p);
		assert.ok(guards.length <= net.liveLimit);
		assert.ok(guards.filter(e => e.ai === 'sniper').length <= 4, 'the global ranged safety limit is preserved');
		for (const e of guards) { assert.ok(!ids.has(e.id)); ids.add(e.id); types.push(ENEMY_TYPES[e.type]); r.killEnemy(e, hs[0]); }
		r.compactEnemies();
	}
	assert.equal(p.spawned, total); assert.equal(p.killed, total); assert.equal(p.chest, 1);
	assert.equal(ids.size, total, 'no revived or recycled guards');
	assert.ok(types.every(t => ['skel', 'brute', 'shield', 'sniper'].includes(t)), 'roster never runs past its finite archetypes');
	assert.deepEqual(types.slice(0, 32), firstWave, 'the first32 dispatches preserve their exact previous order');
	assert.deepEqual(composition(types), roster, 'actual dispatched roster has the approved mix at every party size');
	assert.equal(types.reduce((sum, type) => sum + ENEMIES[type].hp, 0) / total, 38.25, 'base health of the actual finite roster');
	assert.deepEqual(types.slice(32), Array(8).fill('skel'), 'the finite final8 are actual skeletons');
	r.updateOutposts(hs); assert.equal(liveGuards(r, p).length, 0, 'cleared post never replenishes');
	console.log(`density ${mode}/${n}: total=${total}, liveLimit=${net.liveLimit}, exact first32 preserved, actual mix=${JSON.stringify(composition(types))}, mean baseHP=38.25`);
}

// Eight old camps cannot consume the ninth camp's reserved slots or the 350 ordinary slots.
for (const mode of ['night', 'lunch']) {
	const { r, hs, net } = setup(8, mode);
	fillOrdinary(r, hs, MAX_ENEMIES);
	const ordinaryIds = ordinary(r).map(e => e.id);
	allPosts(r, hs);
	assert.equal(ordinary(r).length, 350);
	assert.equal(liveGuards(r).length, 288);
	assert.deepEqual(net.posts.map(p => liveGuards(r, p).length), Array(9).fill(32));
	for (const p of net.posts) {
		assert.deepEqual(liveGuards(r, p).map(e => ENEMY_TYPES[e.type]), firstWave, 'each of the nine first waves retains its exact order');
		assert.deepEqual(composition(liveGuards(r, p).map(e => ENEMY_TYPES[e.type])), { skel: 28, brute: 2, shield: 1, sniper: 1 }, 'every first wave includes the strong archetypes');
		assert.equal(p.pending.length, 8, 'every post retains its own finite tail');
	}
	assert.equal(r.enemies.length, 638);
	const p = net.posts.at(-1), dead = liveGuards(r, p)[0]; r.killEnemy(dead, hs[0]); r.compactEnemies();
	r.updateOutposts(hs);
	assert.equal(liveGuards(r, p).length, 32, 'reinforcement uses its own reserved slot');
	assert.equal(p.spawned, 33); assert.equal(ordinary(r).length, 350);
	assert.deepEqual(ordinary(r).map(e => e.id), ordinaryIds, 'activating and reinforcing the ninth post preserves all ordinary enemies');
	const snap = r.snapshot();
	assert.equal(snap.op.guards, 360); assert.ok(snap.op.posts.every(p => p[6] === 40));
	const before = net.guardsPerPost; r.removePlayer(8);
	assert.equal(net.guardsPerPost, before); assert.equal(net.target, 9); assert.equal(net.liveLimit, 32);
	r.resync(1); assert.equal(r.snapshot().op.guards, 360, 'reconnect never recalculates the roster');
	console.log(`density ${mode} dispersed 8→9 posts: 32×9 mixed guards + 350 ordinary; finite tail/leave/reconnect: OK`);
}

// Kill the first wave, dispatch the actual pending eight, and require the last combat death for the reward.
{
	const { r, hs, net, sent } = setup(8); const last = net.posts.at(-1);
	for (const p of net.posts) {
		approach(r, hs, p);
		const first = liveGuards(r, p), types = first.map(e => ENEMY_TYPES[e.type]);
		assert.equal(first.length, 32); assert.equal(p.spawned, 32);
		assert.deepEqual(types, firstWave, 'initial threat and dispatch order stay unchanged');
		for (const e of first) r.killEnemy(e, hs[0]);
		r.compactEnemies(); assert.equal(p.killed, 32); assert.equal(p.chest, 0);
		r.updateOutposts(hs);
		const tail = liveGuards(r, p);
		assert.equal(tail.length, 8); assert.equal(p.spawned, 40); assert.equal(p.pending.length, 0);
		assert.deepEqual(tail.map(e => ENEMY_TYPES[e.type]), Array(8).fill('skel'), 'all eight actual reserves are finite skeletons');
		assert.deepEqual(composition([...types, ...tail.map(e => ENEMY_TYPES[e.type])]), roster, 'every completed post has the exact full composition');
		for (const e of tail) {
			assert.equal(p.chest, 0, 'pending tail cannot be treated as already cleared');
			if (p === last) assert.equal(net.status, 'active', 'last combat death is required');
			assert.equal(sent.filter(({ m }) => m.t === 'reforge').length, 0, 'no shared reward before the last combat death');
			r.killEnemy(e, hs[0]);
		}
		assert.equal(p.killed, 40); assert.equal(p.chest, 1);
		r.compactEnemies();
	}
	assert.equal(net.status, 'won');
	assert.equal(sent.filter(({ m }) => m.t === 'reforge').length, 8, 'one shared reward per hero');
	for (const h of hs) assert.equal(sent.filter(({ pid, m }) => pid === h.pid && m.t === 'reforge').length, 1, 'each hero receives exactly one reward');
	r.updateOutposts(hs); assert.equal(liveGuards(r).length, 0);
	console.log('density exact first32 and36/2/1/1 mix on all9 posts, actual skeleton tail8, final combat death and one-time team reward: OK');
}

console.log('Outpost density: exact finite composition, dispersed reservation, real pending tail and fixed totals: OK');
