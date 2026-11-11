import assert from 'node:assert/strict';
import { Room } from './game.js';
import { ST, TICK_HZ, WEAPONS, weaponLevel } from '../public/shared/content.js';

const dt = 1 / TICK_HZ;

function encounter(ids) {
	const room = new Room('PERKS', () => {});
	ids.forEach((id, index) => room.addPlayer(index + 1, 'P' + (index + 1), id));
	room.start();
	const heroes = [...room.heroes.values()];
	heroes.forEach((h, i) => { h.x = i * 16; h.y = 0; });
	room.enemies.length = 0;
	return { room, heroes };
}

function foe(room, x, y, type = 'brute') {
	const e = room.spawnEnemy(type, [...room.heroes.values()], 1);
	Object.assign(e, { x, y, hp: 100_000, maxHp: 100_000 });
	room.rebuildGrid();
	return e;
}

function bellMinute(ids, targetCount, level, type) {
	const { room, heroes } = encounter(ids);
	const [h, target, ...others] = heroes;
	heroes.forEach((hero) => { hero.hp = 20; });
	others.forEach((hero) => { hero.x = 200; });
	for (let i = 0; i < targetCount; i++) foe(room, 30, i * 2, type);
	const w = h.weapons.get('aura');
	w.lvl = level;
	for (let frame = 0; frame < 60 * TICK_HZ; frame++) {
		room.time = 15 + frame * dt;
		room.updateWeapon(h, 'aura', w, dt);
	}
	return { self: h.hp - 20, ally: target ? target.hp - 20 : 0, others: others.map((o) => o.hp - 20) };
}

assert.deepEqual(bellMinute(['herald'], 1, 1, 'brute'), { self: 24, ally: 0, others: [] });
assert.deepEqual(bellMinute(['herald'], 1, 5, 'boss'), { self: 24, ally: 0, others: [] });
assert.deepEqual(bellMinute(['herald', 'knight', 'witch', 'alchemist'], 8, 5, 'brute'), { self: 24, ally: 48, others: [0, 0] });

{
	const { room, heroes: [a, b, target] } = encounter(['herald', 'herald', 'knight']);
	target.hp = 20;
	const e = foe(room, 40, 0, 'boss');
	room.time = 30;
	a.weapons.get('aura').t = b.weapons.get('aura').t = 0;
	room.updateWeapon(a, 'aura', a.weapons.get('aura'), dt);
	room.updateWeapon(b, 'aura', b.weapons.get('aura'), dt);
	assert.equal(target.hp, 32, 'two heralds cannot heal the same ally together');
	assert.ok(e.hp < e.maxHp);
	room.time = 44.99;
	b.weapons.get('aura').t = 0;
	room.updateWeapon(b, 'aura', b.weapons.get('aura'), dt);
	assert.equal(target.hp, 32, 'recipient cooldown holds for the full 15 seconds');
	room.time = 45;
	b.weapons.get('aura').t = 0;
	room.updateWeapon(b, 'aura', b.weapons.get('aura'), dt);
	assert.equal(target.hp, 44, 'recipient can be healed exactly 15 seconds later');
}
console.log('Bell: 24 HP/min solo and 24 + 48 HP/min with four players; two heralds respect the recipient cap');

function shieldWindow(coop, ward, shield, late = false) {
	const { room, heroes: [h] } = encounter(coop ? ['knight', 'herald', 'witch', 'alchemist'] : ['knight']);
	if (!shield) h.perk.readyAt = Infinity;
	if (late) {
		h.passives.set('haste', 5);
		h.passives.set('echo', 5);
		room.recalcMods(h);
	}
	const lvl = late ? 5 : 1;
	const w = { lvl, t: 0 };
	if (ward) h.weapons.set('ward', w);
	const counts = { ward: 0, shield: 0, damage: 0 };
	for (let frame = 0; frame < 60 * TICK_HZ; frame++) {
		room.time = 30 + frame * dt;
		h.iframes = Math.max(0, h.iframes - dt);
		if (ward) room.wardTick(h, w, weaponLevel('ward', lvl), dt);
		if (frame % TICK_HZ !== 0 || h.iframes > 0) continue;
		const charges = h.ward, readyAt = h.perk.readyAt, hp = h.hp;
		room.hurtPlayer(h, 2, late ? 'boss:dash' : 'ghoul');
		if (h.ward < charges) {
			counts.ward++;
			assert.equal(h.perk.readyAt, readyAt, 'one hit spends only the ward charge');
		}
		if (h.perk.readyAt > readyAt) counts.shield++;
		if (h.hp < hp) counts.damage++;
	}
	assert.equal(counts.ward + counts.shield + counts.damage, 60);
	return counts;
}

for (const coop of [false, true]) {
	for (const late of [false, true]) {
		const onlyShield = shieldWindow(coop, false, true, late);
		const onlyWard = shieldWindow(coop, true, false, late);
		const both = shieldWindow(coop, true, true, late);
		assert.equal(onlyShield.shield, 3);
		assert.equal(both.ward, onlyWard.ward);
		assert.ok(both.shield >= 2 && both.shield <= 3);
		assert.ok(both.damage > 25, 'both shields still let sustained damage through');
		console.log(`Shield, ${coop ? 'four players' : 'solo'}, ${late ? 'late build' : 'starter Ward'}: ${onlyWard.ward} Ward + ${both.shield} innate blocks, ${both.damage} hits dealt damage per minute`);
	}
}

const weaponHit = (room, h, e, id, dmg = 20) => room.hurtEnemy(e, dmg, h, { weapon: id, tags: WEAPONS[id].tags });

{
	const { room, heroes: [h] } = encounter(['witch']);
	h.weapons = new Map([['frost', { lvl: 3, t: 0 }], ['sickle', { lvl: 3, t: 0 }]]);
	assert.ok(room.imprint(h, { id: 'frost', donor: 'sickle' }));
	const w = h.weapons.get('frost');
	w.t = 0;
	room.time = 10;
	const e = foe(room, 60, 0, 'boss');
	room.updateWeapon(h, 'frost', w, dt);
	assert.equal(room.projectiles.length, 6, 'both waves inherit returning sickles');
	assert.ok(Math.abs(room.projectiles[3].dmg / room.projectiles[0].dmg - 0.6) < 1e-10);
	assert.ok(Math.abs(e.maxHp - e.hp - 13 * 1.6) < 1e-8, 'the wave and its 60% repeat both hit the boss');
	assert.equal(w.t, weaponLevel('frost', 3).cd, 'repeat does not reset the real weapon');
	room.time += 1;
	w.t = 0;
	room.updateWeapon(h, 'frost', w, dt);
	assert.equal(room.projectiles.length, 9, 'no repeat before eight seconds');
}
{
	const { room, heroes: [h] } = encounter(['witch']);
	const e = foe(room, 70, 0);
	h.weapons.set('orbit', { lvl: 1, t: 0 });
	room.time = 10;
	weaponHit(room, h, e, 'orbit');
	weaponHit(room, h, e, 'orbit');
	room.updateTimers();
	assert.equal(h.dmgBy.perk_witch, 12, 'continuous weapon repeats a single pulse, once per target');
	assert.equal(room.timers.length, 0, 'the pulse cannot schedule another pulse');
}
{
	const { room, heroes: [h] } = encounter(['ranger']);
	h.weapons.get('knives').t = 100;
	const front = foe(room, 60, 0);
	const back = foe(room, -110, 0);
	room.time = 5;
	room.updatePlayers(dt, [h]);
	assert.equal(room.projectiles.length, 0, 'standing does not throw');
	h.movedT = room.time;
	room.updatePlayers(dt, [h]);
	assert.equal(room.projectiles[0].target, back, 'prefers a pursuer behind');
	room.time += 3;
	h.movedT = room.time;
	back.dead = true;
	room.updatePlayers(dt, [h]);
	assert.equal(room.projectiles[1].target, front, 'works against one enemy');
}
{
	const { room, heroes: [h] } = encounter(['smith']);
	const boss = foe(room, 50, 0, 'boss');
	const near = foe(room, 80, 0);
	room.time = 5;
	for (let i = 0; i < 12; i++) weaponHit(room, h, boss, 'orbit');
	assert.equal(h.dmgBy.perk_smith, undefined, 'a pile of hits in one swing cannot fill a series');
	room.time += 0.5;
	weaponHit(room, h, boss, 'whip');
	room.time += 0.5;
	weaponHit(room, h, boss, 'orbit');
	assert.ok(h.dmgBy.perk_smith > 0 && near.hp < near.maxHp, 'switching weapons reaches the bonus faster');
	const before = h.dmgBy.perk_smith;
	for (let i = 0; i < 4; i++) {
		room.time += 0.4;
		weaponHit(room, h, boss, 'orbit');
	}
	assert.equal(h.dmgBy.perk_smith, before, 'global cooldown applies');
	room.time = 11;
	for (let i = 0; i < 4; i++) {
		weaponHit(room, h, boss, 'orbit');
		room.time += 0.4;
	}
	assert.ok(h.dmgBy.perk_smith > before, 'one weapon works on the boss');
}
{
	const { room, heroes: [storm, ally] } = encounter(['stormcaller', 'knight']);
	const boss = foe(room, 80, 0, 'boss');
	room.time = 8;
	weaponHit(room, storm, boss, 'lightning');
	assert.ok(room.enemyState(boss) & ST.stormMarked);
	weaponHit(room, ally, boss, 'whip');
	assert.ok(storm.dmgBy.perk_stormcaller > 0, 'ally can discharge on a lone boss');
	assert.ok(!(room.enemyState(boss) & ST.stormMarked));
	const before = storm.dmgBy.perk_stormcaller;
	weaponHit(room, ally, boss, 'whip');
	assert.equal(storm.dmgBy.perk_stormcaller, before);
	room.time = 14;
	const second = foe(room, 160, 0);
	weaponHit(room, storm, boss, 'lightning');
	weaponHit(room, storm, boss, 'lightning');
	assert.ok(second.hp < second.maxHp, 'prefers a second target when available');
}
{
	const { room, heroes: [h] } = encounter(['alchemist']);
	const boss = foe(room, 90, 0, 'boss');
	room.time = 8;
	weaponHit(room, h, boss, 'frost');
	assert.equal(room.puddles.length, 1);
	assert.ok(room.puddles[0].wet && room.puddles[0].slow > 0 && room.puddles[0].burn === undefined);
	room.updatePuddles(0.02);
	assert.ok(boss.wetT > room.time && boss.slowT > room.time);
	room.time = 15;
	room.updatePuddles(3);
	assert.equal(room.puddles.length, 0, 'ticks never create another pool');
	weaponHit(room, h, boss, 'bomb');
	assert.equal(room.puddles.length, 1);
	assert.ok(room.puddles[0].wet && room.puddles[0].burn > 0 && room.puddles[0].slow === 0);
}
{
	const { room, heroes: [h] } = encounter(['spearmaiden']);
	const boss = foe(room, 110, 0, 'boss');
	const behind = foe(room, 190, 0);
	const side = foe(room, 190, 110);
	room.time = 8;
	weaponHit(room, h, boss, 'spear');
	assert.equal(boss.maxHp - boss.hp, 30);
	assert.equal(behind.maxHp - behind.hp, 10);
	assert.equal(side.hp, side.maxHp);
	weaponHit(room, h, boss, 'spear');
	assert.equal(behind.maxHp - behind.hp, 10, 'only one line strike in six seconds');
}
console.log('Offensive passives: all six, solo and ally triggers, forge echo and cooldowns');
