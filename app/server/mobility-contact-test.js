import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { ENEMIES, PLAYER_RADIUS, TICK_HZ } from '../public/shared/content.js';
import { OUTPOST } from './outposts.js';

const dt = 1 / TICK_HZ;
function setup({ type = 'ram', x, y, dx = 0, dy = 0, dash = true, speed, partial = false } = {}) {
	const room = new Room('CONTACT', () => {});
	room.addPlayer(1, 'P', 'witch'); room.start();
	// Keep the production step/moveEnemies/updatePlayers path; no wave or prop randomness.
	room.spawn = () => {}; room.breakAround = () => {};
	const hero = room.heroes.get(1);
	Object.assign(hero, { x: 0, y: 0, hp: 100, maxHp: 100, ward: 0, iframes: 0 });
	hero.weapons.clear(); hero.perk.readyAt = Infinity;
	const enemy = room.spawnEnemy(type, [hero], 1);
	Object.assign(enemy, { x, y, bs: 'dash', bt: ENEMIES.ram.dashTime, bvx: dx, bvy: dy, immuneT: 0, frozenT: 0, rootT: 0 });
	if (speed !== undefined) enemy.def = { ...enemy.def, dashSpeed: speed };
	if (dash) {
		room.handle(1, { t: 'dash', x: 1, y: 0, run: room.runLog.id, request: 1, expiresAt: Date.now() + 1500 });
		if (partial) hero.dash.left = dt / 2;
	}
	return { room, hero, enemy };
}

for (const [name, x, y, dy, hit, distance] of [
	['safe sideways dodge', 0, 70, -1, false, 62.609903369994115],
	['moving contact', 35, 40, 1, true, 51.42956348249517],
	['stationary contact', 20, 40, 0, true, 40],
	['stationary clear', 20, 60, 0, false, 60],
]) {
	test(`native 30 Hz: ${name}`, () => {
		const { room, hero, enemy } = setup({ x, y, dy });
		room.step(dt);
		assert.equal(hero.x, 40);
		assert.equal(enemy.x, x); assert.equal(enemy.y, y + dy * 20);
		assert.equal(enemy.r + PLAYER_RADIUS, 52);
		assert.equal(distance < 52, hit, 'independent review trajectory expectation');
		assert.equal(hero.hp < 100, hit, `relative minimum ${distance}, HP ${hero.hp}`);
	});
}

for (const [name, x, y, hit] of [['partial stop stays clear', -30, -43, false], ['partial stop meets enemy', 33, 41, true]]) {
	test(`native 30 Hz: ${name}`, () => {
		const { room, hero, enemy } = setup({ x, y, dy: 1, partial: true });
		room.step(dt);
		assert.equal(hero.x, 20); assert.equal(hero.dash, null);
		assert.equal(enemy.y, y + 20);
		assert.equal(hero.hp < 100, hit, 'travel for half the tick, then stand still');
	});
}

test('native 30 Hz: fast enemy crossing is considered outside the endpoint grid query', () => {
	// Boundary stress fixture, not a claim that an ordinary ram moves at this speed.
	const { room, hero, enemy } = setup({ x: -300, y: 0, dx: 1, speed: 18000 });
	room.step(dt);
	assert.equal(enemy.x, 300); assert.equal(hero.x, 40);
	assert.ok(hero.hp < 100, 'the endpoint is far away, but the simultaneous paths cross');
});

test('native 30 Hz: guard confinement runs before dash contact', () => {
	const { room, hero, enemy } = setup({ x: 510, y: 0, dx: 1 });
	hero.x = 480;
	enemy.outpost = { x: 0, y: 0 }; enemy.guardReadyAt = 0;
	room.step(dt);
	assert.equal(enemy.x, OUTPOST.leash); assert.equal(hero.x, 520);
	assert.ok(hero.hp < 100);
});

for (const [end, hit] of [[200, false], [40, true]]) {
	test(`native 30 Hz: far respawn keeps endpoint semantics (${end})`, () => {
		const { room, hero, enemy } = setup({ x: -2000, y: 0 });
		room.randomRingPos = () => [end, 0];
		room.step(dt);
		assert.equal(enemy.x, end);
		assert.equal(hero.hp < 100, hit, 'respawning is not physical travel across the arena');
	});
}

test('native 30 Hz: an actual elite blink does not sweep its old contact position', () => {
	const { room, hero, enemy } = setup({ type: 'skel', x: 0, y: 27 });
	Object.assign(enemy, { elite: 'blink', auxT: 0, speed: 0, bs: 0 });
	room.step(dt);
	assert.ok(room.fx.some(fx => fx[0] === 'blink'));
	assert.ok(enemy.x > 0, 'the elite really teleported');
	assert.ok(Math.abs(Math.hypot(enemy.x - hero.x, enemy.y - hero.y) - (enemy.r + PLAYER_RADIUS + 20)) < 1e-8);
	assert.equal(hero.hp, 100);
});

test('native 30 Hz: a zero-distance elite blink cannot erase ordinary dash contact', () => {
	const { room, hero, enemy } = setup({ type: 'skel', x: 0, y: 20 });
	Object.assign(enemy, { elite: 'blink', auxT: 0, speed: 0, bs: 0 });
	room.step(dt);
	assert.equal(enemy.x, 0); assert.equal(enemy.y, 20);
	assert.ok(hero.hp < 100, 'an unchanged position is continuous, even with a cosmetic blink event');
});

for (const [end, hit] of [[200, false], [20, true]]) {
	test(`native 30 Hz: twin half blink keeps endpoint semantics (${end})`, () => {
		const { room, hero, enemy } = setup({ type: 'twinhalf', x: -200, y: 0 });
		Object.assign(enemy, { bs: 'blink', bt: dt / 2, tx: end, ty: 0 });
		room.step(dt);
		assert.equal(enemy.x, end);
		assert.equal(hero.hp < 100, hit);
	});
}

for (const [name, y, speed, hit] of [['crossing stays clear', -60, 3600, false], ['endpoint contact hits', -60, 2700, true]]) {
	test(`native 30 Hz: ordinary non-dash ${name}`, () => {
		const { room, hero, enemy } = setup({ x: 0, y, dy: 1, speed, dash: false });
		room.step(dt);
		assert.equal(hero.x, 0); assert.equal(hero.dashPath, null);
		assert.equal(enemy.y, y + speed * dt);
		assert.equal(hero.hp < 100, hit, 'non-dash contacts retain the existing point test');
	});
}

test('native 30 Hz: contacts are resolved after movement and before hero weapon updates', () => {
	const { room, hero, enemy } = setup({ x: 35, y: 40, dy: 1 });
	hero.weapons.set('bolt', { lvl: 1, t: 0 });
	let observed = false;
	room.updateWeapon = h => { observed = true; assert.equal(enemy.y, 60); assert.ok(h.hp < 100); };
	room.step(dt);
	assert.equal(observed, true);
});
