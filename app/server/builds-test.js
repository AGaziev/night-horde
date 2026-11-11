import assert from 'node:assert/strict';
import { Room } from './game.js';
import { FORGE_RECIPES } from '../public/shared/content.js';

function encounter(weapons, passives = [], coop = false) {
	const r = new Room('BUILD', () => {});
	r.addPlayer(1, 'P1', 'knight');
	if (coop) r.addPlayer(2, 'P2', 'knight');
	r.start();
	r.time = 100;
	r.enemies.length = 0;
	const h = r.heroes.get(1);
	h.x = h.y = 0;
	h.weapons = new Map(weapons.map(([id, lvl = 3]) => [id, { lvl, t: 0 }]));
	h.passives = new Map(passives);
	r.recalcMods(h);
	return { r, h };
}

function foe(r, x, y, hp = 1000) {
	const e = r.spawnEnemy('brute', [...r.heroes.values()], 1);
	Object.assign(e, { x, y, hp, maxHp: hp });
	r.rebuildGrid();
	return e;
}

for (const [pair, recipes] of Object.entries(FORGE_RECIPES)) {
	const ids = pair.split('+');
	assert.deepEqual(Object.keys(recipes).sort(), ids, 'the forge offers both directions');
	for (const carrier of ids) {
		const donor = ids.find((id) => id !== carrier);
		const { r, h } = encounter([[carrier, 4], [donor, 2]], [], true);
		assert.ok(!r.makeChoices(h).some((c) => c.kind === 'imprint'));
		h.weapons.get(donor).lvl = 3;
		h.offer = r.makeChoices(h);
		assert.equal(h.offer.filter((c) => c.kind === 'imprint').length, 2);
		r.handle(1, { t: 'pick', i: h.offer.findIndex((c) => c.kind === 'imprint' && c.id === carrier) });
		assert.equal(h.weapons.get(carrier).lvl, 4);
		assert.equal(h.weapons.get(carrier).imprint, donor);
		assert.ok(h.fused.has(donor) && !h.weapons.has(donor));
		assert.equal(r.heroes.get(2).weapons.size, 1);
		assert.equal(r.snapshot().p[0][12][0][4], donor);
		assert.ok(!r.makeChoices(h).some((c) => c.kind === 'imprint' || (c.kind === 'weapon' && c.id === donor)));
	}
}

{
	const { r, h } = encounter([['frost'], ['sickle']]);
	assert.ok(r.imprint(h, { id: 'frost', donor: 'sickle' }));
	foe(r, 55, 0);
	r.updateWeapon(h, 'frost', h.weapons.get('frost'), 0.05);
	assert.equal(r.projectiles.filter((p) => p.returns).length, 3);
}

{
	const { r, h } = encounter([['flask'], ['lightning']]);
	assert.ok(r.imprint(h, { id: 'flask', donor: 'lightning' }));
	const a = foe(r, 55, 0);
	const b = foe(r, 56, 0);
	r.updateWeapon(h, 'flask', h.weapons.get('flask'), 0.05);
	r.updatePuddles(0.05);
	assert.ok(a.hp < a.maxHp && b.hp < b.maxHp);
	const discharges = r.puddles.length;
	assert.equal(r.fx.filter(([fx]) => fx === 'zap').length, discharges);
	r.updatePuddles(0.55);
	assert.equal(r.fx.filter(([fx]) => fx === 'zap').length, discharges, 'one discharge per puddle');
}

console.log('builds and forge: OK');

{
	const { r, h } = encounter([['prism']], [['lens', 1]]);
	foe(r, 45, 0);
	const second = foe(r, 180, 0);
	r.updateWeapon(h, 'prism', h.weapons.get('prism'), 0.05);
	assert.equal(r.fx.filter(([fx]) => fx === 'buildbeam').length, 4, 'trunk and three branches');
	assert.ok(second.hp < second.maxHp);
}

{
	const { r, h } = encounter([['tuning']], [], true);
	const a = foe(r, 50, 0);
	const b = foe(r, 70, 0);
	r.updateWeapon(h, 'tuning', h.weapons.get('tuning'), 0.05);
	const hp = b.hp;
	r.hurtEnemy(a, 30, r.heroes.get(2), { weapon: 'whip', tags: ['phys'] });
	assert.equal(a.resonanceT, 0);
	assert.ok(b.hp < hp, 'ally can trigger the mark');
}

{
	const { r, h } = encounter([['anchor']], [['counterweight', 1]]);
	const a = foe(r, 85, 0);
	const b = foe(r, 120, 0);
	const c = foe(r, 155, 0);
	const pool = { x: a.x, y: a.y, r: 100, life: 2, wet: true };
	r.puddles.push(pool);
	const w = h.weapons.get('anchor');
	r.updateWeapon(h, 'anchor', w, 0.05);
	assert.ok(b.x < 120 && c.x < 155);
	assert.ok(pool.life > 2);
	assert.ok(r.fx.some(([fx, , , , color]) => fx === 'buildring' && color === 2), 'extra impact for a group pull');
	const life = pool.life;
	w.t = 0;
	r.updateWeapon(h, 'anchor', w, 0.05);
	assert.equal(pool.life, life);
}

{
	const { r, h } = encounter([['lightning']], [['coil', 5], ['ashseal', 5]]);
	const a = foe(r, 0, 0, 1);
	for (let i = 1; i <= 5; i++) foe(r, i * 95, 0, 1);
	r.burn(a, h, 30, 3);
	r.hurtEnemy(a, 300, h, { weapon: 'lightning', tags: ['shock'] });
	assert.equal(r.kills, 4, 'three jumps, then the chain ends');
	assert.equal(r.fx.filter(([fx]) => fx === 'zap').length, 3);
}

{
	const { r, h } = encounter([['lightning']], [['ashseal', 1]]);
	const a = foe(r, 0, 0, 1);
	const b = foe(r, 50, 0);
	const c = foe(r, 106, 0);
	r.burn(a, h, 30, 3);
	r.hurtEnemy(a, 30, h, { weapon: 'lightning', tags: ['shock'] });
	assert.equal(r.kills, 1, 'flash cannot kill the same enemy twice');
	assert.ok(b.burnT > r.time, 'fire transfers to the neighbor even when lightning consumes it');
	r.hurtEnemy(b, 2000, h, { weapon: 'whip', tags: ['phys'] });
	assert.ok(c.burnT <= r.time, 'level-one ash cannot spread twice');
}

console.log('weapons and artifact chains: OK');

{
	const { r, h } = encounter([['lightning', 1], ['bolt', 1]]);
	h.floors.push(1);
	h.offer = r.makeChoices(h);
	assert.deepEqual(h.offer.slice(0, 2).map((c) => c.draft), ['fit', 'pivot']);
	assert.ok(r.fitsBuild(h, h.offer[0]));
	assert.ok(!r.fitsBuild(h, h.offer[1]));
	r.handle(1, { t: 'pick', i: 0 });
	assert.ok(h.buildChestDone);
	h.floors.push(1);
	assert.ok(!r.makeChoices(h).some((c) => c.draft));
}

{
	const passives = ['crit', 'mail', 'area', 'regen', 'magnet', 'swift'].map((id) => [id, 2]);
	const { r, h } = encounter([['lightning']], passives);
	h.pval.crit = 0.2;
	r.offerAltarSwap(h);
	assert.ok(h.offer.every((c) => c.kind === 'swap' && c.replace.length === 6));
	const chosen = h.offer[0];
	const rerolls = h.rerolls;
	r.handle(1, { t: 'reroll' });
	assert.equal(h.rerolls, rerolls);
	r.handle(1, { t: 'pick', i: 0, drop: 'bond' });
	assert.ok(h.offer && h.passives.has('crit'));
	r.handle(1, { t: 'pick', i: 0, drop: 'crit' });
	assert.equal(h.passives.size, 6);
	assert.ok(!h.passives.has('crit') && !Object.hasOwn(h.pval, 'crit'));
	assert.equal(h.passives.get(chosen.id), 1);
	r.offerAltarSwap(h);
	assert.equal(h.offer, null, 'one completed swap per run');
}
console.log('chest draft and altar swap: OK');
