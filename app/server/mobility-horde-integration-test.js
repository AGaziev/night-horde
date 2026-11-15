import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {Room} from './game.js';
import {HORDE_ARENA, HORDE_PACKS, HORDE_LIMITS} from '../public/shared/horde-content.js';
import {PLAYER_RADIUS} from '../public/shared/content.js';

const source = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8')
 .replaceAll("'/shared/", "'" + new URL('../public/shared/', import.meta.url).href);
const {Game} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const dt = 1 / 30, still = {vector: () => ({x: 0, y: 0})};
function scene() {
 const messages = [], r = new Room('HORDE-DASH', (pid, msg) => messages.push({pid, msg}));
 r.addPlayer(1, 'Director', 'witch'); r.setRuleset('horde'); r.addPlayer(2, 'Hero', 'witch');
 assert.equal(r.start(), true);
 const h = r.heroes.get(2); h.weapons.clear(); h.perk.readyAt = Infinity;
 Object.assign(h, {x: 0, y: 0, hp: 100, maxHp: 100, ward: 0, iframes: 0});
 return {r, h, messages};
}
function dash(r, h, x = 1, y = 0) {
 r.handle(h.pid, {t: 'dash', run: r.runLog.id, request: 1, expiresAt: Date.now() + 1500, x, y});
 assert.ok(h.dash);
}
test('Horde dash stops at the inset arena edge identically on server and client', () => {
 const {r, h, messages} = scene(); h.x = HORDE_ARENA.maxX - PLAYER_RADIUS - 10;
 const g = new Game({send: msg => r.handle(h.pid, msg)}); g.me = h.pid; g.begin(r.startMsg());
 assert.equal(g.requestDash({vector: () => ({x: 1, y: 1})}), true);
 g.acceptDash(messages.findLast(v => v.msg.t === 'dash' && v.pid === h.pid).msg);
 r.tick(dt); g.update(dt, still);
 assert.equal(h.x, HORDE_ARENA.maxX - PLAYER_RADIUS);
 assert.ok(Math.abs(h.y - 10) < 1e-8);
 assert.ok(Math.abs(g.local.x - h.x) < 1e-8 && Math.abs(g.local.y - h.y) < 1e-8);
 assert.ok(h.dashPath.duration > 0 && h.dashPath.duration < dt);
 const director = new Game({send() {throw Error('director cannot request dash');}});
 director.me = 1; director.begin(r.startMsg()); assert.equal(director.requestDash(still), false);
 r.handle(1, {t: 'dash', run: r.runLog.id, request: 1, expiresAt: Date.now() + 1500, x: 1, y: 0});
 assert.equal(r.heroes.has(1), false);
});
test('authoritative dash cannot spend its movement interval twice after completion', () => {
 const {r, h} = scene(); h.hordeMoveCredit = 100; dash(r, h);
 for (let i = 0; i < 5; i++) r.tick(dt);
 assert.equal(h.dash, null); assert.equal(h.x, 180); assert.equal(h.hordeMoveCredit, 0);
 r.onPos(h.pid, {x: 400, y: 0, epoch: h.moveEpoch, seq: 1});
 assert.equal(h.x, 180); assert.equal(h.posAck, 1);
 r.tick(dt); r.onPos(h.pid, {x: 185, y: 0, epoch: h.moveEpoch, seq: 2});
 assert.equal(h.x, 185); assert.equal(h.posAck, 2);
});
for (const ready of [false, true]) test(`native boss summon ${ready ? 'ready' : 'preparing'} contact during dash`, () => {
 const {r, h} = scene(); r.summon({}, {type: 'ghoul', count: 1, ring: 0}, 1, 27);
 const e = r.enemies[0]; e.speed = 0;
 assert.equal(e.hordeSource, 'boss-add'); assert.equal(e.hordeReadyAt, HORDE_LIMITS.preparation);
 if (ready) r.time = e.hordeReadyAt;
 dash(r, h); r.tick(dt);
 assert.ok(Math.hypot(h.x - e.x, h.y - e.y) > PLAYER_RADIUS + e.r, 'endpoint is clear');
 assert.equal(h.hp < 100, ready, 'preparation excludes early body contact but a ready body hits');
});
test('a paid formation is absent throughout warning and preparing time even during dash', () => {
 const {r, h} = scene(); const wallet = r.horde.resource;
 assert.equal(r.horde.buy(HORDE_PACKS.swarm, -1000, 0), null);
 assert.equal(r.horde.resource, wallet - HORDE_PACKS.swarm.cost);
 dash(r, h); for (let i = 0; i < 5; i++) r.tick(dt);
 assert.equal(r.enemies.filter(e => e.hordeSource === 'manual').length, 0);
 r.time = HORDE_LIMITS.warning + HORDE_LIMITS.preparation; r.horde.tick(0, [h]);
 assert.equal(r.enemies.filter(e => e.hordeSource === 'manual').length, HORDE_PACKS.swarm.units.length);
 assert.equal(h.hp, 100);
});
for (const moving of [false, true]) test(`native army venom checks ${moving ? 'crossing dash' : 'clear endpoint'} without invulnerability`, () => {
 const {r, h} = scene(); r.horde.build.weapons.venom = 1;
 assert.equal(r.horde.buy(HORDE_PACKS.swarm, -1000, 0), null);
 r.time = HORDE_LIMITS.warning + HORDE_LIMITS.preparation; r.horde.tick(0, [h]);
 const carrier = r.enemies.find(e => e.hordeSource === 'manual');
 r.enemies.forEach(e => {e.x = -1000; e.y = -1000;});
 Object.assign(carrier, {x: 25, y: 20});
 r.horde.combat.cast('venom', r.horde.combat.units());
 assert.equal(r.horde.combat.shots.length, 1);
 const shot = r.horde.combat.shots[0];
 // The real projectile outlives its carrier; isolate it from additional bodies/casts.
 r.enemies.forEach(e => {e.dead = true;});
 if (moving) dash(r, h); else {h.x = 40; h.hostilePos = {x: 40, y: 0};}
 r.tick(dt);
 assert.ok(Math.hypot(h.x - shot.x, h.y - shot.y) > PLAYER_RADIUS + shot.r, 'endpoint alone is clear');
 assert.equal(h.hp, moving ? 96 : 100);
 assert.equal(r.horde.combat.shots.length, moving ? 0 : 1);
 assert.equal(r.horde.combat.status.has(h.pid), moving, 'only the native hit applies poison');
});
