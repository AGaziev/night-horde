import assert from 'node:assert/strict';
import { Room } from './game.js';
import { OUTPOST } from './outposts.js';
import { ENEMIES, enemyHpScale } from '../public/shared/content.js';

const defaults = structuredClone(ENEMIES), dt = 1 / 30;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-8, `${msg}: ${a} vs ${b}`);
function arena(kind, distance, mode, ready = true) {
	const r = new Room('GUARD-SNIPER', () => {}); r.setMode(mode); r.addPlayer(1, 'One', 'knight'); r.start();
	r.enemies.length = 0; r.time = r.runLength * 2 / 3;
	const h = r.heroes.get(1); h.perk.readyAt = Infinity; h.weapons.clear();
	let e;
	if (kind === 'guard') {
		r.updateOutposts([h]); const p = r.outposts.posts[0]; h.x = p.x; h.y = p.y; r.updateOutposts([h]);
		e = r.enemies.find(e => e.outpost === p && e.ai === 'sniper'); assert.ok(e);
		// Isolate this native guard with real combat deaths, so separation cannot alter its movement.
		for (const other of r.enemies) if (other !== e) r.killEnemy(other, h);
		r.compactEnemies(); assert.equal(p.spawned, 40); assert.equal(p.killed, 39);
	} else e = r.spawnEnemy('sniper', [h], enemyHpScale(r.nt, 1));
	assert.equal(r.enemies.length, 1); assert.equal(e.def, ENEMIES.sniper);
	e.x = h.x + distance; e.y = h.y; e.shotT = 99; e.windT = 0;
	if (ready) r.time += .9;
	r.fx.length = 0;
	return { r, h, e };
}
function movement(kind, distance, mode) {
	const fixture = arena(kind, distance, mode), { r, h, e } = fixture;
	const before = { x: e.x, y: e.y }; r.moveEnemies(dt, [h]);
	return { ...fixture, dx: e.x - before.x, dy: e.y - before.y };
}

for (const mode of ['night', 'lunch']) {
	const guard = movement('guard', 300, mode), normal = movement('normal', 300, mode);
	assert.ok(guard.dx < 0, `guard at300 advances toward the hero: dx=${guard.dx}`);
	assert.ok(normal.dx > 0, `ordinary at300 still retreats: dx=${normal.dx}`);
	for (const d of [180, 210, 240]) {
		const m = movement('guard', d, mode);
		close(m.dx, 0, `guard at${d} strafes in its keep band`); assert.ok(Math.abs(m.dy) > 0);
	}
	assert.ok(movement('guard', 179, mode).dx > 0, 'guard retreats below180');
	assert.ok(movement('guard', 241, mode).dx < 0, 'guard approaches above240');
	const kept = movement('normal', 400, mode); close(kept.dx, 0, 'ordinary still strafes in350–450');
	assert.ok(Math.abs(kept.dy) > 0);
	console.log(`guard sniper ${mode}: d300 advance vs ordinary retreat;180–240 strafe, below180 retreat: OK`);
}

function aim(kind, distance, mode) {
	const fixture = arena(kind, distance, mode), { r, h, e } = fixture;
	e.shotT = 0; const x = e.x; r.moveEnemies(dt, [h]); return { ...fixture, dx: e.x - x };
}
for (const mode of ['night', 'lunch']) {
	const guard = aim('guard', 500, mode), normal = aim('normal', 500, mode);
	assert.equal(guard.e.windT, 0, 'guard at500 does not waste a windup outside its shooting window');
	assert.ok(guard.dx < 0); assert.equal(guard.r.fx.filter(fx => fx[0] === 'bline').length, 0);
	assert.equal(normal.e.windT, .9, 'ordinary at500 still starts its native windup'); close(normal.dx, 0, 'ordinary stands while aiming');
	assert.equal(normal.r.fx.filter(fx => fx[0] === 'bline').length, 5);
	assert.equal(aim('guard', 390, mode).e.windT, 0, 'guard aim threshold is keepMax+150=390');
	assert.equal(aim('guard', 389, mode).e.windT, .9);
	assert.equal(aim('normal', 599, mode).e.windT, .9); assert.equal(aim('normal', 600, mode).e.windT, 0);
	console.log(`guard sniper ${mode}: d500 advances without aiming vs ordinary aim; thresholds390/600: OK`);
}

function volley(kind, mode) {
	const fixture = aim(kind, 300, mode), { r, h, e } = fixture;
	const lanes = r.fx.filter(fx => fx[0] === 'bline');
	assert.equal(lanes.length, 5); assert.ok(lanes.every(lane => lane[6] === .9));
	assert.equal(e.windT, .9); assert.equal(e.shotT, 3.2); assert.equal(r.hostile.length, 0);
	r.time += .89; r.moveEnemies(.89, [h]); assert.equal(r.hostile.length, 0, 'no shot before the complete windup');
	r.time += .02; r.moveEnemies(.02, [h]); assert.equal(e.windT, 0); assert.equal(r.hostile.length, 5);
	assert.equal(r.fx.filter(fx => fx[0] === 'eorb').length, 5);
	const shots = r.hostile.map(s => ({ ...s }));
	for (const s of shots) {
		close(Math.hypot(s.vx, s.vy), 170, 'native projectile speed'); close(s.dmg, ENEMIES.sniper.shotDmg * e.dmgMul, 'native projectile damage');
		if (kind === 'guard') {
			assert.equal(s.from, 'outpost:shot'); assert.equal(s.outpost, e.outpost); assert.ok(s.life <= 2.4);
			assert.ok(Math.hypot(s.x + s.vx * s.life - e.outpost.x, s.y + s.vy * s.life - e.outpost.y) <= 650 + 1e-8);
		} else { assert.equal(s.from, 'sniper:shot'); assert.equal(s.life, 3.8); assert.equal(s.outpost, undefined); }
	}
	const hp = h.hp;
	for (let i = 0; i < 120 && r.hostile.length; i++) { r.time += dt; r.updateHostile(dt); }
	assert.equal(r.hostile.length, 0); close(hp - h.hp, shots[2].dmg, 'the actual middle orb hits a stationary hero');
	assert.ok(r.runLog.p.get(1).taken[kind === 'guard' ? 'outpost:shot' : 'sniper:shot'] > 0);
	return { damage: shots[2].dmg, e };
}
for (const mode of ['night', 'lunch']) {
	const guard = volley('guard', mode), normal = volley('normal', mode);
	close(guard.damage / normal.damage, 1.15, 'guard shot multiplier remains1.15');
	close(guard.e.maxHp / normal.e.maxHp, 1.5, 'guard HP multiplier remains1.5');
	const lead = aim('guard', 500, mode); lead.e.x = lead.h.x + 300; lead.e.shotT = 0;
	lead.h.mvx = 0; lead.h.mvy = 1; lead.h.movedT = lead.r.time;
	lead.r.moveEnemies(dt, [lead.h]); assert.ok(lead.e.bvy > .2, 'guard still aims ahead along native target motion');
	console.log(`guard sniper ${mode}: actual5-orb volley/.9 windup/HP1.5/damage1.15/bounds and native lead: OK`);
}

for (const mode of ['night', 'lunch']) {
	const { r, h, e } = arena('guard', 300, mode, false); e.shotT = 0;
	r.moveEnemies(.1, [h]); assert.equal(e.windT, 0); assert.equal(r.fx.filter(fx => fx[0] === 'bline').length, 0);
	// An explicit contact fixture exercises the preparation gate separately from safe spawn placement.
	e.x = h.x; e.y = h.y; const hp = h.hp;
	r.time = e.guardReadyAt - .001; r.rebuildGrid(); r.updatePlayers(.0005, [h]); assert.equal(h.hp, hp);
	r.time = e.guardReadyAt; r.rebuildGrid(); r.updatePlayers(.001, [h]); assert.ok(h.hp < hp, 'contact activates after the full preparation');
	const leash = arena('guard', 519, mode); leash.h.x += 500; const guardHp = leash.e.hp;
	leash.r.moveEnemies(.5, [leash.h]);
	close(Math.hypot(leash.e.x - leash.e.outpost.x, leash.e.y - leash.e.outpost.y), 520, 'retreat remains confined by the hard leash');
	assert.equal(leash.e.hp, guardHp, 'retreat does not heal');
	const edge = arena('guard', 510, mode); edge.h.x += 600; edge.e.shotT = 0;
	edge.r.moveEnemies(dt, [edge.h]); edge.r.time += .91; edge.r.moveEnemies(.91, [edge.h]);
	assert.equal(edge.r.hostile.length, 5);
	assert.ok(edge.r.hostile.every(s => s.life <= 2.4 && Math.hypot(s.x + s.vx * s.life - edge.e.outpost.x, s.y + s.vy * s.life - edge.e.outpost.y) <= 650 + 1e-8), 'outward volleys remain bounded too');
}
assert.deepEqual(OUTPOST.sniperKeep, [180, 240]); assert.ok(Object.isFrozen(OUTPOST.sniperKeep));
assert.deepEqual(ENEMIES, defaults, 'ordinary snipers, other ranged enemies and miniboss definitions remain unchanged');
console.log('Outpost snipers: actual normal/guard movement, aim, shots, preparation, leash and immutable global definitions: OK');
