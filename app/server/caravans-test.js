import assert from 'node:assert/strict';
import { Room } from './game.js';
import { CARAVAN, updateCaravan, claimCaravan, caravanGuardKilled, caravanSnapshot } from './caravans.js';
import { ENEMIES, enemyHpScale, xpForNext } from '../public/shared/content.js';
function setup(n, mode) {
	const r = new Room('CARGO', () => {}); r.setMode(mode);
	for (let i = 1; i <= n; i++) r.addPlayer(i, 'P' + i, 'knight');
	r.start(); return { r, hs: [...r.heroes.values()] };
}
for (const mode of ['lunch', 'night']) for (const n of [1, 2, 4, 8]) {
	const { r, hs } = setup(n, mode);
	r.time = r.runLength * CARAVAN.from - .01; updateCaravan(r, hs, 1 / 30); assert.equal(r.caravan, null);
	r.time += .01; updateCaravan(r, hs, 1 / 30); const c = r.caravan; assert.ok(c);
	assert.equal(c.total, 12 + 2 * (n - 1));
	assert.equal(r.enemies.filter(e => e.caravan).length, c.total);
	assert.equal(r.ordinaryEnemyCount(), 0, 'finite guard budget never replaces ordinary waves');
	assert.ok(hs.every(h => Math.hypot(h.x - c.ax, h.y - c.ay) >= 1000));
	assert.ok(Math.hypot(c.bx - c.ax, c.by - c.ay) <= 900.001);
	const e = r.enemies.find(e => e.def === ENEMIES.skel);
	assert.ok(Math.abs(e.maxHp - ENEMIES.skel.hp * enemyHpScale(r.nt, n) * r.modeHp * 1.35) < 1e-6);
	const x = e.x, y = e.y; hs.forEach(h => { h.x = 50000; h.y = 50000; });
	r.moveEnemies(1, hs); assert.ok(Math.hypot(e.x - x, e.y - y) < 500, 'guards do not teleport after far heroes');
	r.knock(e, c.x, c.y, 10000); assert.ok(Math.hypot(e.x - c.x, e.y - c.y) <= CARAVAN.leash + 1e-6);
	assert.equal(r.makeElite(hs), null, 'caravan guards cannot become elites');
	assert.equal(claimCaravan(r), false);
	for (const guard of r.enemies) r.killEnemy(guard, hs[0]);
	assert.equal(c.status, 'open'); assert.equal(c.killed, c.total);
	caravanGuardKilled(r, r.enemies[0]); assert.equal(c.killed, c.total, 'death accounted once');
	hs[0].hp = hs[0].maxHp / 2; hs[0].xp = 0;
	if (n > 1) { hs[1].st = 1; hs[1].hp = 0; }
	const xp = xpForNext(hs[0].level, n);
	assert.equal(claimCaravan(r), true); assert.equal(claimCaravan(r), false);
	assert.equal(hs[0].xp, xp * .15); assert.equal(hs[0].hp, hs[0].maxHp * .6);
	if (n > 1) assert.equal(hs[1].hp, 0, 'no resurrection reward');
	assert.ok(hs.every(h => !h.victoryBanner && !h.forgeUsed)); assert.equal(caravanSnapshot(r), null);
	r.start(); assert.equal(r.caravan, null);
}
{
	const { r, hs } = setup(2, 'lunch'); r.time = 210; updateCaravan(r, hs, 1 / 30);
	const kills = r.kills, gems = r.gems.length, c = r.caravan;
	r.time = 330; updateCaravan(r, hs, 1 / 30);
	assert.equal(c.status, 'expired'); assert.equal(caravanSnapshot(r), null);
	assert.ok(r.enemies.every(e => e.dead)); assert.equal(r.kills, kills); assert.equal(r.gems.length, gems);
	assert.equal(claimCaravan(r), false);
	r.time = 400; updateCaravan(r, hs, 1); assert.equal(r.caravan, c, 'never respawns');
}
{
	const { r, hs } = setup(1, 'night'); r.time = 315; updateCaravan(r, hs, 1 / 30);
	const c = r.caravan; r.setPaused(true); r.tick(5); assert.equal(c.progress, CARAVAN.speed / 30 / CARAVAN.route);
	r.setPaused(false); r.fin = {}; updateCaravan(r, hs, 1); assert.equal(c.status, 'expired');
}
console.log('Caravan: both modes, 1–8 heroes, finite escort, leash, reward-once, expiry and pause OK');
