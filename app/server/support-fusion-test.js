import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { DUOS, EVOS } from '../public/shared/content.js';

const dt = 1 / 30;
function arena() {
	const r = new Room('SUPPORT-FUSION', () => {});
	for (let pid = 1; pid <= 3; pid++) r.addPlayer(pid, `P${pid}`, 'ranger');
	r.start(); r.time = 100; r.enemies = [];
	const heroes = [...r.heroes.values()];
	for (const h of heroes) { h.x = h.y = 0; h.weapons.clear(); h.perk.readyAt = Infinity; h.mods.critChance = 0; }
	return { r, heroes };
}
function pick(r, h, card) {
	h.offer = [card]; r.sendOffer(h);
	r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: h.offerEpoch });
}
function fuse(r, h, id) {
	const [a, b] = DUOS[id].parts;
	pick(r, h, r.duoCard(h, { id, a, b }));
	assert.ok(h.weapons.has(id), 'the production offer action really fuses');
}
function foe(r, h, x) {
	const e = r.spawnEnemy('ghoul', [h], 1);
	Object.assign(e, { x, y: 0, hp: 1e6, maxHp: 1e6, speed: 20, dmg: 0 });
	r.rebuildGrid(); return e;
}

for (const id of ['phalanx', 'dome', 'riposte', 'rod', 'resonantshield']) {
	test(`Bastion gift survives a real ${id} fusion and cannot fire its signature counter`, () => {
		const { r, heroes: [h, donor, ally] } = arena();
		ally.x = 1000;
		h.weapons = new Map(DUOS[id].parts.map(part => [part, { lvl: 3, t: 0 }]));
		r.updateWeapon(h, 'ward', h.weapons.get('ward'), dt);
		r.hurtPlayer(h, 1); h.iframes = 0;
		const own = h.ward; assert.ok(own > 0);
		h.weapons.get('ward').t = 4;
		donor.weapons.set('ward', { lvl: 5, t: 0 });
		donor.passives.set(EVOS.bastion.requires, 1);
		pick(r, donor, r.evoCard(donor, 'bastion'));
		r.updateWeapon(donor, 'bastion', donor.weapons.get('bastion'), dt);
		r.hurtPlayer(donor, 10);
		const gift = h.sharedWard;
		assert.equal(gift?.owner, donor); assert.equal(gift.grantedAt, 100); assert.equal(gift.until, 108);
		fuse(r, h, id);
		assert.equal(h.sharedWard, gift); assert.equal(h.ward, own); assert.equal(h.weapons.get(id).t, 4);
		const e = foe(r, h, 70), hp = h.hp, enemyHp = e.hp, blocked = donor.support.blocked;
		const damage = h.dmg, missileCount = r.projectiles.length;
		r.time = 107.99; r.hurtPlayer(h, 10, 'fusion-gift', 107.99);
		assert.equal(h.hp, hp); assert.equal(h.ward, own); assert.equal(h.sharedWard, null);
		assert.equal(donor.support.blocked - blocked, 10);
		assert.equal(e.hp, enemyHp); assert.equal(h.dmg, damage); assert.equal(r.projectiles.length, missileCount);
		assert.equal(Boolean(donor.sharedWard), false, 'a gift cannot donate or counterattack');
		h.iframes = 0; r.hurtPlayer(h, 10, 'fusion-own', 108.01);
		assert.equal(h.hp, hp); assert.equal(h.ward, own - 1);
		assert.equal(donor.support.blocked - blocked, 10, 'only the live gift belongs to the donor');
		assert.ok(e.hp < enemyHp || r.projectiles.length > missileCount, 'the own charge fires the native signature response');
		for (const part of DUOS[id].parts) assert.equal(h.dmgBy[part] ?? 0, 0, 'retired components gain no damage row');
		for (const shot of r.projectiles.slice(missileCount)) assert.equal(shot.src.weapon, id);
		const row = r.runLog.build(r, false).team.find(p => p.pid === h.pid);
		assert.deepEqual(row.build.weapons, [`${id}1`]);
		assert.ok(row.duos.some(p => p[1] === id), 'run metadata retains the actual fusion');
	});
}

for (const boss of [false, true]) test(`native Crystal Choir retains control owner and signature resonance, boss=${boss}`, () => {
	const { r, heroes: [h, ally] } = arena();
	h.weapons = new Map(DUOS.crystalchoir.parts.map(part => [part, { lvl: 3, t: 0 }]));
	fuse(r, h, 'crystalchoir');
	const e = foe(r, h, 100); e.boss = boss;
	foe(r, h, 120);
	r.updateWeapon(h, 'crystalchoir', h.weapons.get('crystalchoir'), dt);
	assert.equal(r.coldWaves.length, 1); assert.equal(r.coldWaves[0].src.weapon, 'crystalchoir');
	r.updateColdWaves(0.25);
	assert.equal(e.slowOwner, h); assert.equal(e.resonanceWeapon, 'crystalchoir');
	if (boss) { assert.equal(e.slow, 0.4); assert.ok(e.frozenT <= r.time); }
	else assert.equal(e.frozenOwner, h);
	r.moveEnemies(dt, [h, ally]);
	assert.ok(h.support.control > 0); assert.equal(ally.support.control, 0);
	r.hurtEnemy(e, 10, ally, { weapon: 'whip', tags: ['phys'] });
	assert.ok(h.dmgBy.crystalchoir > 0);
	for (const p of [h, ally]) for (const part of DUOS.crystalchoir.parts) assert.equal(p.dmgBy[part] ?? 0, 0);
});
