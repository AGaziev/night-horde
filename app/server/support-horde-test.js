import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { EVOS } from '../public/shared/content.js';
import { HORDE_ARENA } from '../public/shared/horde-content.js';
import { CARAVAN } from './caravans.js';

function room(horde = true) {
	const r = new Room('SUPPORT-HORDE', () => {});
	if (horde) { r.addPlayer(1, 'Director', 'ranger'); r.setRuleset('horde'); }
	r.addPlayer(2, 'Recipient', 'ranger'); r.addPlayer(3, 'Bastion', 'ranger');
	assert.equal(r.start(), true);
	r.time = 100; r.enemies = [];
	for (const h of r.heroes.values()) { h.weapons.clear(); h.x = h.y = 0; h.perk.readyAt = Infinity; }
	return r;
}

function nativeWard(r, h, bastion = false) {
	h.weapons.set('ward', { lvl: bastion ? 5 : 3, t: 0 });
	if (bastion) {
		h.passives.set(EVOS.bastion.requires, 1);
		h.offer = [r.evoCard(h, 'bastion')]; r.sendOffer(h);
		r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: h.offerEpoch });
		assert.ok(h.weapons.has('bastion'));
	}
	const id = bastion ? 'bastion' : 'ward';
	r.updateWeapon(h, id, h.weapons.get(id), 1 / 30);
	assert.ok(h.ward > 0);
}

for (const id of ['frost', 'venom']) test(`Bastion gift blocks Horde ${id} before native Ward without applying a status`, () => {
	const r = room(), [recipient, donor] = r.heroes.values();
	nativeWard(r, recipient); nativeWard(r, donor, true);
	r.hurtPlayer(recipient, 1); recipient.iframes = 0;
	assert.equal(Boolean(recipient.sharedWard), false);
	r.hurtPlayer(donor, 1);
	assert.equal(recipient.sharedWard.owner, donor);
	const own = recipient.ward, hp = recipient.hp, before = donor.support.blocked;
	const attack = { id, damage: 10, build: { artifacts: {} }, duration: 1, poisonDuration: 1, synergies: new Set() };
	const shot = { attack, factor: 1 };
	r.horde.combat.projectileHit(recipient, shot);
	assert.equal(recipient.hp, hp);
	assert.equal(recipient.ward, own);
	assert.equal(recipient.sharedWard, null);
	assert.equal(donor.support.blocked - before, 10);
	assert.equal(r.horde.combat.status.has(recipient.pid), false);
	assert.equal(Boolean(donor.sharedWard), false, 'spending a gift cannot donate another gift');
	recipient.iframes = 0;
	r.horde.combat.projectileHit(recipient, shot);
	assert.equal(recipient.ward, own - 1, 'the next hit spends its native charge');
	assert.equal(r.horde.combat.status.has(recipient.pid), false);
	assert.equal(donor.support.blocked - before, 10);
	recipient.iframes = 0;
	r.horde.combat.projectileHit(recipient, shot);
	assert.equal(recipient.hp, hp - 10);
	assert.ok(r.horde.combat.status.has(recipient.pid), 'an unprotected real hit applies its debuff');
	if (id === 'frost') {
		assert.ok(Math.abs(r.horde.heroSpeedMul(recipient) - 0.82) < 1e-9);
		const x = recipient.x;
		r.onPos(recipient.pid, { x: x + 1000, y: 0 });
		assert.ok(recipient.x - x <= (recipient.speed * 1.1 / 30 + 30) * 0.82 + 1e-7);
	}
	assert.equal(recipient.support.control + donor.support.control, 0, 'hostile slow never earns hero support');
});

function retreat(horde, edge, controlled) {
	const r = room(horde), heroes = [...r.heroes.values()], h = heroes[0];
	const e = r.spawnEnemy('spitter', heroes, 1);
	e.x = horde ? HORDE_ARENA.maxX - e.r - (edge ? 0 : 100) : CARAVAN.leash - (edge ? 0 : 100);
	e.y = 0; e.shotT = 100; e.windT = 0;
	if (!horde) e.caravan = { x: 0, y: 0 };
	h.x = e.x - 40; heroes[1].x = h.x - 100;
	if (controlled) r.slowEnemy(e, 0.7, 2, h);
	r.moveEnemies(0.1, heroes);
	return { x: e.x, y: e.y, hp: h.hp, credit: h.support.control };
}

for (const horde of [false, true]) test(`${horde ? 'Horde arena' : 'caravan leash'} clamps both control projections before awarding movement`, () => {
	const atWall = retreat(horde, true, true), plainWall = retreat(horde, true, false);
	assert.deepEqual(atWall, plainWall, 'a suppressed outward retreat has no delivered benefit');
	assert.equal(atWall.credit, 0);
	const inset = retreat(horde, false, true), plainInset = retreat(horde, false, false);
	assert.ok(inset.x < plainInset.x, 'the same slow changes a real retreat away from the boundary');
	assert.equal(inset.credit, 0.1);
});
