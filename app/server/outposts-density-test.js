import assert from 'node:assert/strict';
import { Room } from './game.js';
import { ENEMY_TYPES, MAX_ENEMIES } from '../public/shared/content.js';

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
		assert.ok(guards.filter(e => e.ai === 'sniper').length <= 4);
		for (const e of guards) { assert.ok(!ids.has(e.id)); ids.add(e.id); types.push(ENEMY_TYPES[e.type]); r.killEnemy(e, hs[0]); }
		r.compactEnemies();
	}
	assert.equal(p.spawned, total); assert.equal(p.killed, total); assert.equal(p.chest, 1);
	assert.equal(ids.size, total, 'no revived or recycled guards');
	assert.ok(types.every(t => ['skel', 'brute', 'shield', 'sniper'].includes(t)), 'roster never runs past its finite archetypes');
	assert.ok(Math.abs(types.filter(t => t === 'sniper').length / total - .1) < .02);
	r.updateOutposts(hs); assert.equal(liveGuards(r, p).length, 0, 'cleared post never replenishes');
	console.log(`density ${mode}/${n}: total=${total}, liveLimit=${net.liveLimit}, finite roster=${types.length}`);
}

// Eight old camps cannot consume the ninth camp's reserved slots or the 350 ordinary slots.
{
	const { r, hs, net } = setup(8);
	fillOrdinary(r, hs, MAX_ENEMIES); allPosts(r, hs);
	assert.equal(ordinary(r).length, 350);
	assert.equal(liveGuards(r).length, 288);
	assert.deepEqual(net.posts.map(p => liveGuards(r, p).length), Array(9).fill(32));
	assert.equal(r.enemies.length, 638);
	const p = net.posts.at(-1), dead = liveGuards(r, p)[0]; r.killEnemy(dead, hs[0]); r.compactEnemies();
	r.updateOutposts(hs);
	assert.equal(liveGuards(r, p).length, 32, 'reinforcement uses its own reserved slot');
	assert.equal(p.spawned, 33); assert.equal(ordinary(r).length, 350);
	const snap = r.snapshot();
	assert.equal(snap.op.guards, 360); assert.ok(snap.op.posts.every(p => p[6] === 40));
	const before = net.guardsPerPost; r.removePlayer(8);
	assert.equal(net.guardsPerPost, before); assert.equal(net.target, 9); assert.equal(net.liveLimit, 32);
	r.resync(1); assert.equal(r.snapshot().op.guards, 360, 'reconnect never recalculates the roster');
	console.log('density dispersed 8→9 posts: 32×9 guards + 350 ordinary; reinforcement/leave/reconnect: OK');
}

// Killing melee first must not accumulate snipers past four, lose the pending tail, or win early.
{
	const { r, hs, net, sent } = setup(8); const last = net.posts.at(-1);
	for (const p of net.posts) {
		approach(r, hs, p);
		for (let round = 0; round < 10; round++) {
			const guards = liveGuards(r, p);
			assert.ok(guards.filter(e => e.ai === 'sniper').length <= 4);
			const melee = guards.filter(e => e.ai !== 'sniper');
			if (!melee.length) break;
			for (const e of melee) r.killEnemy(e, hs[0]);
			r.compactEnemies(); r.updateOutposts(hs);
		}
		while (p.killed < p.total) {
			const guards = liveGuards(r, p);
			assert.ok(guards.length && guards.length <= 4, 'blocked ranged reserves remain finite and reachable');
			assert.equal(p.chest, 0);
			for (const e of guards) {
				if (p === last) assert.equal(net.status, 'active', 'last combat death is required');
				r.killEnemy(e, hs[0]);
			}
			r.compactEnemies(); r.updateOutposts(hs);
		}
	}
	assert.equal(net.status, 'won');
	assert.equal(sent.filter(({ m }) => m.t === 'reforge').length, 8, 'one shared reward per hero');
	r.updateOutposts(hs); assert.equal(liveGuards(r).length, 0);
	console.log('density ranged backlog, finite reinforcement, last death and one-time team reward: OK');
}

console.log('Outpost density: finite population, dispersed reservation, ranged backlog and fixed totals: OK');
