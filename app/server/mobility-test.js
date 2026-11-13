import assert from 'node:assert/strict';
import { Room } from './game.js';
import { requestDash, stepMobility } from './mobility.js';
import { DASH } from '../public/shared/mobility.js';
import { PLAYER_RADIUS } from '../public/shared/content.js';

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
	requestDash(r, 1, { x: 3, y: 4 });
	assert.equal(sent.at(-1).m.ok, true);
	assert.equal(h.iframes, 0, 'dash provides no protection');
	assert.equal(h.dashReadyAt, 12);
	for (let i = 0; i < 5; i++) { r.time += 1 / 30; stepMobility(r, 1 / 30); }
	assert.ok(Math.abs(Math.hypot(h.x, h.y) - DASH.distance) < 1e-6);
	assert.equal(h.dash, null);
	const x = h.x;
	r.onPos(1, { x: 0, y: 0 }); assert.equal(h.x, x, 'pre-dash position packets rejected');
	r.onPos(1, { x: x + 1, y: h.y, epoch: 1 }); assert.equal(h.x, x + 1);
	requestDash(r, 1, { x: 1, y: 0 }); assert.equal(sent.at(-1).m.ok, false);
	r.time = 12; requestDash(r, 1, { x: 1, y: 0 }); assert.equal(sent.at(-1).m.ok, true);
}
{
	const { r, h, sent } = setup();
	for (const flag of ['offline', 'offer']) {
		h[flag] = true; requestDash(r, 1, { x: 1, y: 0 });
		assert.equal(sent.at(-1).m.ok, false); h[flag] = false;
	}
	r.setPaused(true); requestDash(r, 1, {}); assert.equal(sent.at(-1).m.ok, false);
	r.setPaused(false); requestDash(r, 1, {});
	const before = h.dash.left; r.setPaused(true); r.tick(1);
	assert.equal(h.dash.left, before); assert.equal(r.time, 0, 'pause freezes travel and cooldown');
	r.setPaused(false);
	h.offer = [{}]; r.updateFrozen(); r.tick(1); assert.equal(r.time, 0);
}
{
	const { r, h } = setup();
	h.x = 99990; requestDash(r, 1, { x: 1, y: 0 }); stepMobility(r, 1);
	assert.equal(h.x, 100000);
	h.dashReadyAt = 0; h.x = 80; h.y = 0; r.fin = { cx: 0, cy: 0, r: 100 };
	requestDash(r, 1, { x: 1, y: 0 }); stepMobility(r, 1);
	assert.ok(h.x <= 100 - PLAYER_RADIUS + 1e-6, 'finale wall is solid');
}
{
	const { r, h } = setup();
	const e = r.spawnEnemy('skel', [h], 1);
	Object.assign(e, { x: 100, y: 0, speed: 0 });
	h.weapons.clear(); const hp = h.hp;
	requestDash(r, 1, { x: 1, y: 0 }); stepMobility(r, 1);
	r.rebuildGrid(); r.updatePlayers(1 / 30, [h]);
	assert.ok(h.hp < hp, 'crossing an enemy takes contact damage even when endpoint is clear');
}
console.log('Mobility: bounded travel, authority, cooldown, pause, packet epochs and swept contact OK');

{
 const { r, h } = setup();
 const hp = h.hp;
 r.hostile.push({ id: 9001, x: 100, y: 0, vx: 0, vy: 0, life: 5, dmg: 9, r: 6, from: 'test' });
 requestDash(r, 1, { x: 1, y: 0 }); stepMobility(r, 1);
 r.updateHostile(1 / 30);
 assert.equal(h.hp, hp - 9, 'dash cannot cross a projectile endpoint without damage');
 assert.equal(r.hostile.length, 0);
 assert.equal(r.snapshot().p[0].length, 15, 'mobility metadata does not change the player row');
 const before = h.moveEpoch;
 r.resync(1);
 assert.equal(h.moveEpoch, before, 'reconnect preserves the server-owned dash epoch');
}
