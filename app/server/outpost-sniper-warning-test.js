import assert from 'node:assert/strict';
import { Room } from './game.js';
import { ENEMIES, enemyHpScale } from '../public/shared/content.js';

const defaults = structuredClone(ENEMIES), dt = 1 / 30;
for (const guard of [true, false]) for (const [direction, tx, ty] of [['outward', 600, 0], ['inward', 200, 0], ['tangent', 510, 200]]) {
	const r = new Room('WARNING', () => {}); r.addPlayer(1, 'One', 'knight'); r.start(); r.time = 600; r.enemies.length = 0;
	const h = r.heroes.get(1); h.weapons.clear(); h.perk.readyAt = Infinity;
	let e, center = { x: 0, y: 0 };
	if (guard) {
		r.updateOutposts([h]); center = r.outposts.posts[0]; h.x = center.x; h.y = center.y; r.updateOutposts([h]);
		e = r.enemies.find(e => e.outpost === center && e.ai === 'sniper'); assert.ok(e);
		for (const other of r.enemies) if (other !== e) r.killEnemy(other, h);
		r.compactEnemies(); r.time = e.guardReadyAt;
	} else e = r.spawnEnemy('sniper', [h], enemyHpScale(r.nt, 1));
	e.x = center.x + 510; e.y = center.y; e.shotT = 0; e.windT = 0;
	h.x = center.x + tx; h.y = center.y + ty; r.fx.length = 0;
	const nextId = r.nextId; r.moveEnemies(dt, [h]);
	const lanes = r.fx.filter(fx => fx[0] === 'bline');
	assert.equal(lanes.length, 5); assert.equal(r.hostile.length, 0); assert.equal(r.nextId, nextId, 'preview allocates no projectile IDs');
	assert.ok(lanes.every(lane => lane[6] === .9));
	r.time += .91; r.moveEnemies(.91, [h]); assert.equal(r.hostile.length, 5);
	for (const [i, s] of r.hostile.entries()) {
		const lane = lanes[i], endX = s.x + s.vx * s.life, endY = s.y + s.vy * s.life;
		assert.equal(lane[1], Math.round(s.x)); assert.equal(lane[2], Math.round(s.y));
		assert.ok(Math.abs(lane[3] - endX) <= 1 && Math.abs(lane[4] - endY) <= 1, `${guard ? 'guard' : 'ordinary'} ${direction} ray${i} matches its actual endpoint`);
		assert.ok(Math.abs(Math.hypot(s.vx, s.vy) - 170) < 1e-8); assert.equal(s.dmg, ENEMIES.sniper.shotDmg * e.dmgMul);
		if (guard) {
			assert.ok(s.life <= 2.4); assert.ok(Math.hypot(endX - center.x, endY - center.y) <= 650 + 1e-8);
		} else {
			assert.equal(s.life, 3.8); assert.equal(s.outpost, undefined);
			const a = Math.atan2(e.bvy, e.bvx) + (i - 2) * ENEMIES.sniper.spread;
			assert.equal(lane[3], Math.round(e.x + Math.cos(a) * 646)); assert.equal(lane[4], Math.round(e.y + Math.sin(a) * 646));
		}
	}
	if (direction === 'outward') assert.equal(lanes[2][3] - center.x, guard ? 650 : 1156);
}
assert.deepEqual(ENEMIES, defaults);
console.log('Guard warnings: outward/inward/tangent, all five actual rays and unchanged ordinary ballistics: OK');
