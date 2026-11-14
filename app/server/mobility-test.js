import assert from 'node:assert/strict';
import { Room } from './game.js';
import { requestDash, stepMobility, dashShotDistance2 } from './mobility.js';
import { DASH } from '../public/shared/mobility.js';
import { PLAYER_RADIUS, HOSTILE_R, ENEMIES } from '../public/shared/content.js';

function action(r, pid, msg) { return requestDash(r, pid, { run: r.runLog.id, request: (r.heroes.get(pid).dashRequest ?? 0) + 1, expiresAt: Date.now() + 1500, ...msg }); }
function setup(n = 1, mode = 'night') {
	const sent = [], r = new Room('DASH', (pid, m) => sent.push({ pid, m }));
	r.setMode(mode);
	for (let i = 1; i <= n; i++) r.addPlayer(i, 'P' + i, 'ranger');
	r.start();
	const h = r.heroes.get(1); h.x = h.y = 0;
	return { r, h, sent };
}
for (const mode of ['night', 'lunch']) for (const n of [1, 2, 4, 8]) {
	const { r, h, sent } = setup(n, mode);
	action(r, 1, { x: 3, y: 4 });
	assert.equal(sent.at(-1).m.ok, true);
	assert.equal(h.iframes, 0, 'dash provides no protection');
	assert.equal(h.dashReadyAt, 12);
	for (let i = 0; i < 5; i++) { r.time += 1 / 30; stepMobility(r, 1 / 30); }
	assert.ok(Math.abs(Math.hypot(h.x, h.y) - DASH.distance) < 1e-6);
	assert.equal(h.dash, null);
	const x = h.x;
	r.onPos(1, { x: 0, y: 0 }); assert.equal(h.x, x, 'pre-dash position packets rejected');
	r.onPos(1, { x: x + 1, y: h.y, epoch: 1 }); assert.equal(h.x, x + 1);
	action(r, 1, { x: 1, y: 0 }); assert.equal(sent.at(-1).m.ok, false);
	r.time = 12; action(r, 1, { x: 1, y: 0 }); assert.equal(sent.at(-1).m.ok, true);
}
{
	const { r, h, sent } = setup();
	for (const flag of ['offline', 'offer']) {
		h[flag] = true; action(r, 1, { x: 1, y: 0 });
		assert.equal(sent.at(-1).m.ok, false); h[flag] = false;
	}
	r.setPaused(true); action(r, 1, {}); assert.equal(sent.at(-1).m.ok, false);
	r.setPaused(false); action(r, 1, {});
	const before = h.dash.left; r.setPaused(true); r.tick(1);
	assert.equal(h.dash.left, before); assert.equal(r.time, 0, 'pause freezes travel and cooldown');
	r.setPaused(false);
	h.offer = [{}]; r.updateFrozen(); r.tick(1); assert.equal(r.time, 0);
}
{
	const { r, h } = setup();
	h.x = 99990; action(r, 1, { x: 1, y: 0 }); stepMobility(r, 1);
	assert.equal(h.x, 100000);
	h.dashReadyAt = 0; h.x = 80; h.y = 0; r.fin = { cx: 0, cy: 0, r: 100 };
	action(r, 1, { x: 1, y: 0 }); stepMobility(r, 1);
	assert.ok(h.x <= 100 - PLAYER_RADIUS + 1e-6, 'finale wall is solid');
}
{
	const { r, h } = setup();
	const e = r.spawnEnemy('skel', [h], 1);
	Object.assign(e, { x: 100, y: 0, speed: 0 });
	h.weapons.clear(); const hp = h.hp;
	action(r, 1, { x: 1, y: 0 }); stepMobility(r, 1);
	r.rebuildGrid(); r.updatePlayers(1 / 30, [h]);
	assert.ok(h.hp < hp, 'crossing an enemy takes contact damage even when endpoint is clear');
}

for (const endY of [22, 30]) {
	const { r, h } = setup();
	const dt = 1 / 30, hp = h.hp, speed = ENEMIES.spitter.shotSpeed;
	h.perk.readyAt = Infinity;
	r.hostile.push({ id: 9002, x: 30, y: endY - speed * dt, vx: 0, vy: speed, life: 5, dmg: 9, from: 'spitter:shot' });
	action(r, 1, { x: 1, y: 0 }); stepMobility(r, dt);
	r.updateHostile(dt);
	assert.equal(h.hp, hp - (endY === 22 ? 9 : 0), 'moving shot crossing is hit; a nearby separated path stays clear');
	assert.equal(r.hostile.length, endY === 22 ? 0 : 1);
}
{
	// Travel ends halfway through the tick; the rest is a stationary hero.
	const h = { x: 20, y: 0, dashPath: { x: 0, y: 0, duration: 0.5 } };
	assert.equal(dashShotDistance2(h, 20, 30, 20, -10, 1), 0);
	assert.ok(dashShotDistance2(h, 60, 0, 45, 0, 1) > (PLAYER_RADIUS + HOSTILE_R) ** 2);
}
console.log('Mobility: bounded travel, authority, cooldown, pause, packet epochs and swept contact OK');

{
 const { r, h } = setup();
 const hp = h.hp;
 r.hostile.push({ id: 9001, x: 100, y: 0, vx: 0, vy: 0, life: 5, dmg: 9, r: 6, from: 'test' });
 action(r, 1, { x: 1, y: 0 }); stepMobility(r, 1);
 r.updateHostile(1 / 30);
 assert.equal(h.hp, hp - 9, 'dash cannot cross a projectile endpoint without damage');
 assert.equal(r.hostile.length, 0);
 assert.equal(r.snapshot().p[0].length, 15, 'mobility metadata does not change the player row');
 const before = h.moveEpoch;
 r.resync(1);
 assert.equal(h.moveEpoch, before, 'reconnect preserves the server-owned dash epoch');
}
