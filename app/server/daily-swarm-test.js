import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { dailyFor } from '../public/shared/daily.js';
import { xpForNext } from '../public/shared/content.js';
import { initSwarm, resolveSwarm, swarmSnapshot, tagSwarmEnemy } from './daily-swarm.js';

function setup(mode = 'night', n = 1, version = 2) {
	const r = new Room('SWARM', () => {}); r.setMode(mode);
	for (let i = 1; i <= n; i++) r.addPlayer(i, 'P' + i, 'witch');
	r.handle(1, { t: 'daily', enabled: true });
	let at = Date.UTC(2026, 10, 14); while (dailyFor(at).id !== 'swarm') at += 86400000;
	r.lockDaily(at);
	if (version === 1) r.daily = { ...r.daily, version: 1, mods: { enemyRate: 1.15, xp: 1.15 } };
	r.start();
	for (const h of r.heroes.values()) { h.weapons.clear(); h.perk.readyAt = Infinity; }
	return r;
}
function begin(r, c) {
	r.time = c.at; r.updatePeaks([...r.heroes.values()].filter(h => h.st === 0));
	return r.enemies.filter(e => e.swarmCohort === c);
}

for (const mode of ['lunch', 'night']) test(`Swarmv2 ${mode}: cumulative cohort, two finite rewards, down/offline recipients`, () => {
	const r = setup(mode, 2), h = r.heroes.get(1), down = r.heroes.get(2);
	assert.deepEqual(r.swarm.cohorts.map(c => c.id), ['ring', 'tide']);
	assert.ok(r.swarm.cohorts.every(c => c.end <= r.finPlan.pre));
	for (const c of r.swarm.cohorts) {
		const enemies = begin(r, c);
		if (!enemies.length) { r.spawnAcc = 10; r.bossAt = []; r.spawn(0, [h]); enemies.push(...r.enemies.filter(e => e.swarmCohort === c)); }
		assert.ok(enemies.length > 0);
		const total = c.spawned, target = Math.ceil(total * .7);
		r.setElite(enemies[0], 'fast');
		for (const e of enemies.slice(0, target)) r.killEnemy(e, h);
		r.killEnemy(enemies[0], h); r.compactEnemies();
		assert.equal(c.spawned, total); assert.equal(c.killed, target);
		assert.equal(c.resolved, false); assert.equal(r.swarm.wins, r.swarm.cohorts.indexOf(c));
		assert.deepEqual(swarmSnapshot(r), { killed: target, spawned: total, end: c.end });
		h.xp = down.xp = 0; h.hp = 40; down.hp = 0; down.st = 1; down.offline = true;
		const reward = xpForNext(h.level, 2) * .15;
		r.time = c.end; resolveSwarm(r);
		assert.equal(c.resolved, true); assert.equal(c.success, true);
		assert.equal(h.xp, reward); assert.equal(down.xp, reward);
		assert.equal(h.hp, 40); assert.equal(down.hp, 0); assert.equal(down.st, 1);
		resolveSwarm(r); r.resync(1); assert.equal(h.xp, reward);
	}
	assert.equal(r.swarm.wins, 2);
	assert.equal(swarmSnapshot(r), null);
});

test('Swarmv2: later ordinary births enlarge denominator; late kills and empty/failed windows never award', () => {
	const r = setup(), h = r.heroes.get(1), c = r.swarm.cohorts[0];
	const enemies = begin(r, c);
	for (const e of enemies.slice(0, Math.ceil(enemies.length * .7))) r.killEnemy(e, h);
	const old = c.spawned; r.spawnAcc = 40; r.bossAt = []; r.spawn(0, [h]);
	assert.equal(c.spawned, old + 40);
	const killed = c.killed;
	h.xp = 0; r.time = c.end;
	for (const e of r.enemies.filter(e => !e.dead)) r.killEnemy(e, h);
	assert.equal(c.killed, killed);
	resolveSwarm(r); assert.equal(c.success, false); assert.equal(h.xp, 0);
	const second = r.swarm.cohorts[1]; r.time = second.end; resolveSwarm(r);
	assert.equal(second.spawned, 0); assert.equal(second.success, false);
});

test('Swarmv2: spawnEnemy/special/boss/summon-like births are not tagged globally; non-Swarm helper consumes no RNG/IDs', () => {
	const r = setup(), c = r.swarm.cohorts[0], h = r.heroes.get(1); begin(r, c);
	const count = c.spawned;
	for (const type of ['skel', 'shield', 'sniper', 'boss']) r.spawnEnemy(type, [h], 1);
	assert.equal(c.spawned, count);
	const ordinary = new Room('NORMAL', () => {}), random = Math.random;
	ordinary.swarm = null; ordinary.nextId = 123;
	Math.random = () => { throw Error('unexpected RNG'); };
	try { tagSwarmEnemy(ordinary, { def: {} }); } finally { Math.random = random; }
	assert.equal(ordinary.nextId, 123);
});

test('Swarmv2: resolves before combat and marks the cohort resolved before calling addXp', () => {
	const r = setup(), c = r.swarm.cohorts[0], h = r.heroes.get(1); begin(r, c);
	for (const e of [...r.enemies]) r.killEnemy(e, h);
	const add = r.addXp.bind(r); let called = false;
	r.addXp = (hero, xp) => { assert.equal(c.resolved, true); called = true; add(hero, xp); };
	r.time = c.end - 1 / 30; r.updatePlayers = () => assert.equal(called, true);
	r.step(1 / 30); assert.equal(called, true);
});

test('Swarmv1: an already started contract and its XP stay unchanged on reconnect', () => {
	const r = setup('night', 1, 1), before = structuredClone(r.daily), h = r.heroes.get(1);
	assert.equal(r.swarm, null); r.resync(1); assert.deepEqual(r.daily, before);
	r.addXp(h, 1); assert.equal(h.xp, 1.15);
});

test('Swarm result metadata is absent before resolution, then stable and read-only',async()=>{
 const{swarmResultSnapshot}=await import('./daily-swarm.js');const r=setup(),h=r.heroes.get(1),c=r.swarm.cohorts[0];begin(r,c);
 assert.equal(swarmResultSnapshot(r),null);for(const e of [...r.enemies])r.killEnemy(e,h);r.time=c.end;resolveSwarm(r);
 const before=JSON.stringify({swarm:r.swarm,xp:h.xp,hp:h.hp,paused:r.paused,ids:r.nextId});
 assert.deepEqual(swarmResultSnapshot(r),{end:c.end,success:true,killed:c.killed,spawned:c.spawned});r.snapshot();r.resync(1);
 assert.equal(JSON.stringify({swarm:r.swarm,xp:h.xp,hp:h.hp,paused:r.paused,ids:r.nextId}),before);
});
