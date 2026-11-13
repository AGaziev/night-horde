import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { HORDE_PACKS } from '../public/shared/horde-content.js';

const raw = { weapon: 'other', tags: [], raw: true };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} !== ${b}`);
function encounter(count = 1) {
	const room = new Room('R2', () => {});
	room.addPlayer(1, 'Director', 'witch'); room.setRuleset('horde');
	for (let i = 0; i < count; i++) room.addPlayer(i + 2, 'Hero' + i, 'witch');
	room.start();
	return { room, heroes: [...room.heroes.values()] };
}
function paid(room, id, artifacts = {}) {
	room.horde.build = { packs: { [id]: 1 }, weapons: {}, artifacts };
	room.time = Math.max(room.time, HORDE_PACKS[id].at);
	const before = new Set(room.enemies.map((e) => e.id));
	room.horde.resource = room.horde.resourceCap;
	assert.equal(room.horde.buy(HORDE_PACKS[id], -1000, 0), null);
	room.time += 2; room.horde.tick(0, [...room.heroes.values()]);
	const result = room.enemies.filter((e) => e.hordeSource === 'manual' && !before.has(e.id));
	assert.ok(result.length);
	return result;
}

test('a paid bomber has a full warned blast and cannot create an instant friendly-fire chain', () => {
	const { room, heroes: [hero] } = encounter();
	const bombers = paid(room, 'bombers').filter((e) => e.ai === 'exploder');
	for (const [i, e] of bombers.entries()) { e.x = i * 45; e.y = 0; }
	hero.x = 176.1; hero.y = 0; const hp = hero.hp;
	room.rebuildGrid(); room.fx = [];
	room.hurtEnemy(bombers[0], 10000, hero, raw);
	assert.equal(room.blasts.length, 1);
	assert.ok(room.blasts[0].t - room.time >= 1.2 - 1e-8);
	assert.equal(room.blasts[0].edmg, 0, 'Horde native explosions must not recursively kill adjacent bombers');
	room.time = room.blasts[0].t; room.updateBlasts();
	assert.ok(bombers.slice(1).every((e) => !e.dead));
	assert.equal(hero.hp, hp, 'a hero outside the warned area is not hit by an unannounced secondary zone');
});

test('killing an already fusing Horde bomber cannot skip the blast warning', () => {
	const { room, heroes: [hero] } = encounter();
	const bomber = paid(room, 'bombers').find((e) => e.ai === 'exploder');
	bomber.x = hero.x; bomber.y = hero.y; bomber.fuseT = 0.25;
	const hp = hero.hp;
	room.hurtEnemy(bomber, 10000, hero, raw);
	assert.equal(hero.hp, hp, 'death must not detonate immediately');
	assert.equal(room.blasts.length, 1);
	assert.ok(room.blasts[0].t - room.time >= 1.2 - 1e-8);
});

test('a fully blocked noncritical knife cannot inherit critical piercing from a previous hit', () => {
	const { room, heroes: [hero] } = encounter();
	const cohort = paid(room, 'brutes', { carapace: 3 });
	const target = cohort[0]; target.x = 80; target.y = 0;
	cohort.slice(1).forEach((e) => { e.x = -1000; });
	hero.x = 0; hero.y = 0; hero.mods.critChance = 0.06;
	hero.weapons = new Map([['knives', { lvl: 1, t: 0 }]]);
	room.rebuildGrid(); room.lastCrit = true;
	const original = Math.random; Math.random = () => 0.99;
	try {
		room.updateWeapon(hero, 'knives', hero.weapons.get('knives'), 0.1);
		const projectile = room.projectiles[0]; assert.ok(projectile);
		const hp = target.hp;
		room.updateProjectiles((target.x - projectile.x) / projectile.vx);
		assert.equal(target.hp, hp, 'barrier fully absorbs the real knife hit');
		assert.ok(projectile.hit.includes(target.id));
		assert.equal(Boolean(projectile.critPierced), false);
		assert.equal(room.lastCrit, false);
	} finally { Math.random = original; }
});

test('Horde movement shares one time-based budget across packets and resyncs, including slow', () => {
	for (const slow of [0, 0.18]) {
		const { room, heroes: [hero] } = encounter();
		if (slow) room.horde.combat.chill(hero, { duration: 10 });
		for (let i = 0; i < 100; i++) room.onPos(hero.pid, { x: 1700, y: 0 });
		assert.ok(hero.x <= 30 + 1e-7, 'same-tick packets cannot repeatedly spend the jitter allowance');
		const before = hero.x; room.resync(hero.pid);
		for (let i = 0; i < 100; i++) room.onPos(hero.pid, { x: 1700, y: 0 });
		close(hero.x, before);
		for (let frame = 1; frame <= 30; frame++) {
			room.time = frame / 30;
			for (let i = 0; i < 5; i++) room.onPos(hero.pid, { x: 1700, y: 0 });
		}
		assert.ok(hero.x <= 30 + hero.speed * (1 - slow) * 1.1 + 1e-6);
	}
});

test('normal paced Horde movement remains available without a per-message movement bonus', () => {
	const { room, heroes: [hero] } = encounter();
	for (let frame = 1; frame <= 60; frame++) {
		room.time = frame / 30;
		room.onPos(hero.pid, { x: hero.speed * room.time, y: 0 });
	}
	close(hero.x, hero.speed * 2);
});

test('Horde terminal heroes-left results retain the whole original hero roster and statistics', () => {
	const { room, heroes } = encounter(2);
	heroes[0].kills = 7; heroes[1].kills = 11;
	room.time = 91;
	room.removePlayer(heroes[0].pid); room.removePlayer(heroes[1].pid);
	assert.equal(room.state, 'over'); assert.equal(room.overMsg.reason, 'heroes-left');
	assert.deepEqual(room.overMsg.stats.map((p) => [p.name, p.kills]), [['Hero0', 7], ['Hero1', 11]]);
	assert.deepEqual(room.lastLog.team.map((p) => p.name), ['Hero0', 'Hero1']);
	assert.ok(room.lastLog.minutes.every((row) => Number.isFinite(row.maxHp)));
});

test('mark support through a flat barrier equals the actual additional HP damage', () => {
	function strike(marked) {
		const { room, heroes: [attacker, marker] } = encounter(2);
		const e = paid(room, 'brutes', { carapace: 3 })[0];
		e.hp = e.maxHp = 10000; e.hordeBarrier = 20;
		attacker.mods.critChance = 0;
		if (marked) { e.markT = room.time + 10; e.markMul = 0.2; e.markOwner = marker; }
		const hp = e.hp;
		room.hurtEnemy(e, 50, attacker, { weapon: 'whip', tags: [] });
		return { dealt: hp - e.hp, support: marker.supportDamage };
	}
	const control = strike(false), marked = strike(true);
	assert.ok(marked.dealt > control.dealt);
	close(marked.support, marked.dealt - control.dealt);
});
