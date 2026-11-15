import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { ENEMIES, enemyDmgScale } from '../public/shared/content.js';

function scene(mode = 'night', players = 1) {
	const r = new Room('SOLO', () => {}); r.setMode(mode);
	for (let pid = 1; pid <= players; pid++) r.addPlayer(pid, `P${pid}`, 'witch');
	r.start();
	const h = r.heroes.get(1), e = r.spawnEnemy('skel', [h], 1);
	return { r, h, e };
}

for (const armor of [0, 2, 100]) test(`solo Night native enemy pressure with armor ${armor}`, () => {
	const { r, h, e } = scene();
	const raw = ENEMIES.skel.dmg * enemyDmgScale(r.nt, 1) * .65;
	assert.ok(Math.abs(e.dmg - raw) < 1e-9);
	h.mods.armor = armor;
	const before = h.hp; r.hurtPlayer(h, e.dmg, 'skel');
	assert.ok(Math.abs(before - h.hp - Math.max(1, raw * h.trait.dmgTaken - armor)) < 1e-9);
});

test('leaving a duo rescales an existing enemy to the new solo Night entry once', () => {
	const { r, e } = scene('night', 2);
	assert.equal(r.modeDmg, .54);
	r.removePlayer(2);
	assert.equal(r.modeDmg, .65);
	assert.ok(Math.abs(e.dmg - ENEMIES.skel.dmg * enemyDmgScale(r.nt, 1) * .65) < 1e-9);
});

for (const [mode, players, multiplier] of [['lunch', 1, .75], ['night', 2, .54]]) {
	test(`${mode}/${players} keeps its native enemy damage`, () => {
		const { r, e } = scene(mode, players);
		assert.equal(r.modeDmg, multiplier);
		assert.ok(Math.abs(e.dmg - ENEMIES.skel.dmg * enemyDmgScale(r.nt, players) * multiplier) < 1e-9);
	});
}
