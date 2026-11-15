import assert from 'node:assert/strict';
import { Room } from './game.js';
import { CARAVAN, updateCaravan, claimCaravan, caravanSnapshot } from './caravans.js';
import { ENEMIES, enemyHpScale, enemyDmgScale, modeHpMul, modeDmgMul } from '../public/shared/content.js';

const dt = 1 / 30;
const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-7, `${why}: ${a} != ${b}`);
function setup(n = 1, mode = 'night') {
	const r = new Room('THREAT', () => {}); r.setMode(mode);
	for (let i = 1; i <= n; i++) r.addPlayer(i, `P${i}`, 'witch');
	r.start(); r.time = r.runLength * CARAVAN.from;
	return { r, hs: [...r.heroes.values()] };
}
function routeSafe(c, hs) {
	assert.ok(Math.max(Math.abs(c.ax), Math.abs(c.ay), Math.abs(c.bx), Math.abs(c.by)) <= CARAVAN.world);
	near(Math.hypot(c.bx - c.ax, c.by - c.ay), 900, 'finite route');
	assert.ok(hs.some(h => { const d = Math.hypot(h.x - c.ax, h.y - c.ay); return h.st === 0 && d >= 2600 - 1e-7 && d <= 3200 + 1e-7; }));
	for (const h of hs) {
		assert.ok(Math.hypot(h.x - c.ax, h.y - c.ay) >= 2200 - 1e-7);
		const vx = c.bx - c.ax, vy = c.by - c.ay;
		const t = Math.max(0, Math.min(1, ((h.x - c.ax) * vx + (h.y - c.ay) * vy) / (vx * vx + vy * vy)));
		assert.ok(Math.hypot(h.x - c.ax - t * vx, h.y - c.ay - t * vy) >= 1800 - 1e-7);
	}
}

for (const mode of ['lunch', 'night']) for (let n = 1; n <= 8; n++) {
	const { r, hs } = setup(n, mode);
	// Spread participants, including a downed hero at the first otherwise valid placement.
	hs.forEach((h, i) => Object.assign(h, i === 1 ? { x: 2600, y: 2100, st: 1, hp: 0 } : { x: -i * 200, y: i * 140 }));
	const alive = hs.filter(h => h.st === 0);
	const random = Math.random;
	try { Math.random = () => 0; updateCaravan(r, alive, dt); } finally { Math.random = random; }
	const c = r.caravan; assert.ok(c); routeSafe(c, hs);
	if (n > 1) assert.notDeepEqual([c.ax, c.ay], [2600, 0], 'a downed participant excludes a close spawn');
	const roster = Object.fromEntries(['skel', 'brute', 'shield', 'spitter'].map(id => [id, r.enemies.filter(e => e.def === ENEMIES[id]).length]));
	const spitter = Math.min(4, n + 1);
	assert.deepEqual(roster, { skel: 32 + 4 * (n - 1) - (n + 3) - 2 - spitter, brute: n + 3, shield: 2, spitter });
	assert.equal(r.enemies.length, c.total); assert.equal(r.ordinaryEnemyCount(), 0);
	for (const e of r.enemies) {
		near(e.maxHp, e.def.hp * enemyHpScale(r.nt, n) * r.modeHp * 1.6, 'native family HP');
		near(e.dmg, e.def.dmg * enemyDmgScale(r.nt, n) * r.modeDmg * 1.25, 'native contact damage');
		near(e.dmgMul, enemyDmgScale(r.nt, n) * r.modeDmg * 1.25, 'native shot damage');
		near(e.guardReadyAt, r.time + 1.2, 'preparation');
		assert.equal(e.boss, false); assert.equal(e.elite, null);
	}
	const cohort = [...r.enemies];
	r.time += 10; updateCaravan(r, alive, dt);
	assert.deepEqual(r.enemies, cohort, 'no reserves or repeat cohort');
}

for (const mode of ['lunch', 'night']) for (const n of [1, 8]) {
	const { r, hs } = setup(n, mode);
	hs.forEach((h, i) => Object.assign(h, { x: (i % 2 ? -1 : 1) * 99500, y: (i % 4 < 2 ? 1 : -1) * 99500 }));
	const random = Math.random;
	try { Math.random = () => 0; updateCaravan(r, hs, dt); } finally { Math.random = random; }
	assert.ok(r.caravan, 'bounded fallback finds an inward route at a world corner'); routeSafe(r.caravan, hs);
}

for (const mode of ['lunch', 'night']) {
	const { r, hs } = setup(1, mode); updateCaravan(r, hs, dt);
	const c = r.caravan, h = hs[0], e = r.enemies.find(e => e.ai === 'ranged');
	r.enemies = [e]; h.weapons.clear(); h.x = e.x + 250; h.y = e.y; e.shotT = 0;
	r.time = e.guardReadyAt - .01;
	const before = [e.x, e.y]; r.moveEnemies(dt, hs);
	assert.deepEqual([e.x, e.y], before); assert.equal(e.windT, 0); assert.equal(r.hostile.length, 0);
	r.time = e.guardReadyAt; r.moveEnemies(dt, hs); assert.equal(e.windT, ENEMIES.spitter.windup);
	r.time += ENEMIES.spitter.windup + .01; r.moveEnemies(ENEMIES.spitter.windup + .01, hs);
	assert.equal(r.hostile.length, 1); assert.equal(r.hostile[0].caravan, c); assert.equal(r.hostile[0].from, 'caravan:shot');
	near(r.hostile[0].dmg, ENEMIES.spitter.shotDmg * e.dmgMul, 'native ranged damage');
	assert.ok(r.hostile[0].life <= CARAVAN.shotLife);
	r.hostile.length = 0; e.x = c.x + 400; e.y = c.y; e.windT = 0; e.shotT = 0;
	h.x = c.x + CARAVAN.pursuit + 1; h.y = c.y;
	r.moveEnemies(dt, hs); assert.ok(e.x < c.x + 400); assert.equal(e.windT, 0); assert.equal(r.hostile.length, 0);
	h.x = c.x + CARAVAN.pursuit - 1; e.x = c.x + 400; e.shotT = 0;
	r.moveEnemies(dt, hs); assert.ok(e.windT > 0, 'inside pursuit a nearby ranged guard can acquire the hero');
	r.knock(e, c.x, c.y, 10000); assert.ok(Math.hypot(e.x - c.x, e.y - c.y) <= 520 + 1e-7);
}

for (const victim of [680, 800]) {
	const { r, hs } = setup(); updateCaravan(r, hs, dt);
	const c = r.caravan, h = hs[0], e = r.enemies.find(e => e.ai === 'ranged');
	const anchor = { x: c.x, y: c.y };
	e.x = c.x + 520; e.y = c.y; h.x = c.x + victim; h.y = c.y; h.hostilePos = { x: h.x, y: h.y };
	h.iframes = 0; const hp = h.hp;
	r.fireHostile(e, h); const shot = r.hostile[0];
	near(Math.hypot(shot.x + shot.vx * shot.life - anchor.x, shot.y + shot.vy * shot.life - anchor.y), 720, 'launch circle clips the ray');
	// Moving the wagon cannot drag a projectile or lengthen its previously bounded path.
	c.x += 900;
	r.time += 2; r.updateHostile(2);
	assert.equal(r.hostile.length, 0);
	if (victim < 720) assert.ok(h.hp < hp, 'real clipped native shot hits an inside target');
	else assert.equal(h.hp, hp, 'TTL clipping precedes collision: no hit beyond the fixed launch circle');
	assert.ok(r.fx.some(f => f[0] === 'epend' && f[1] === shot.id));
}

for (const terminal of ['claimed', 'expired', 'finale']) {
	const { r, hs } = setup(); updateCaravan(r, hs, dt);
	const c = r.caravan, h = hs[0], e = r.enemies.find(e => e.ai === 'ranged');
	r.fireHostile(e, { x: e.x + 250, y: e.y }); const owned = r.hostile[0];
	const ordinary = r.spawnEnemy('spitter', hs, 1); r.fireHostile(ordinary, h); const unowned = r.hostile[1];
	if (terminal === 'claimed') { for (const guard of r.enemies.filter(e => e.caravan)) r.killEnemy(guard, h); assert.equal(claimCaravan(r), true); }
	else { if (terminal === 'finale') r.fin = {}; else r.time = c.expires; updateCaravan(r, hs, dt); }
	assert.deepEqual(r.hostile, [unowned], 'cleanup removes only the terminal caravan shots');
	assert.ok(r.fx.some(f => f[0] === 'epend' && f[1] === owned.id));
	assert.equal(caravanSnapshot(r), null);
	const kills = r.kills, gems = r.gems.length;
	updateCaravan(r, hs, dt); assert.equal(r.kills, kills); assert.equal(r.gems.length, gems); assert.equal(r.caravan, c);
}

{
	const { r, hs } = setup(8); updateCaravan(r, hs, dt);
	const c = r.caravan, e = r.enemies[0], before = { hp: e.maxHp, dmg: e.dmg };
	r.time += 60; e.hp = e.maxHp / 2; r.removePlayer(8);
	const hpK = enemyHpScale(c.creationNt, 7) / enemyHpScale(c.creationNt, 8) * modeHpMul('night', 7) / modeHpMul('night', 8);
	const dmgK = enemyDmgScale(c.creationNt, 7) / enemyDmgScale(c.creationNt, 8) * modeDmgMul('night', 7) / modeDmgMul('night', 8);
	near(e.maxHp, before.hp * hpK, 'leave retains birth-time HP scaling'); near(e.hp, e.maxHp / 2, 'leave retains damage progress');
	near(e.dmg, before.dmg * dmgK, 'leave retains birth-time damage scaling'); assert.equal(c.total, 60); assert.equal(r.enemies.length, 60);
}
console.log('Caravan threat: both modes/1–8, split/downed/edge segment safety, finite native roster, preparation/pursuit, clipped ranged hits, terminal cleanup and cohort leave: OK');
