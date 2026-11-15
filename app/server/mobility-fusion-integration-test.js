import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {Room} from './game.js';
import {Net} from '../public/js/net.js';
import {SnapshotDecoder} from '../public/js/snapshot-codec.js';

const source = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8')
 .replaceAll("'/shared/", "'" + new URL('../public/shared/', import.meta.url).href);
const {Game} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const dt = 1 / 30;

for (const horde of [false, true]) test(`fusion retirement and dash epoch recover in the same ${horde ? 'Horde' : 'PvE'} wire key`, () => {
 const wire = [], acks = [], pid = horde ? 2 : 1;
 const r = new Room('DASH-FUSION', (to, msg, json) => {
  if (to !== pid) return;
  if (json) wire.push(JSON.parse(json));
  if (msg.t === 'dash') acks.push(msg);
 });
 r.addPlayer(1, horde ? 'Director' : 'Hero', 'witch');
 if (horde) r.setRuleset('horde');
 r.addPlayer(2, horde ? 'Hero' : 'Ally', 'witch'); r.start(); r.time = 100;
 r.spawn = () => {}; r.breakAround = () => {}; r.events.next = Infinity;
 const h = r.heroes.get(pid); h.perk.readyAt = Infinity; h.x = h.y = 0;
 h.weapons = new Map([['bolt', {lvl: 3, t: 0}], ['lightning', {lvl: 3, t: 0}], ['knives', {lvl: 3, t: 0}]]);
 r.addProjectile(h, 'bolt', 0, 100, 10, 1, 3, null);
 const consumedId = r.projectiles.at(-1).id;
 r.addProjectile(h, 'knife', 0, 100, 10, 1, 3, null);
 const independentId = r.projectiles.at(-1).id;
 const requests = [], net = Object.create(Net.prototype);
 Object.assign(net, {snapDec: new SnapshotDecoder(), keyAskedAt: -Infinity, handlers: new Map(), outbox: []});
 net.send = msg => {requests.push(msg); r.handle(pid, msg);};
 const g = new Game(net); g.me = pid; g.begin(r.startMsg());
 net.on('s', msg => g.onSnapshot(msg)); net.on('dash', msg => g.acceptDash(msg));
 r.snapshot(); net.receive(JSON.stringify(wire.at(-1)));
 assert.ok(g.shots.has(consumedId) && g.shots.has(independentId));
 h.offer = [r.duoCard(h, {id: 'orb', a: 'bolt', b: 'lightning'})]; r.sendOffer(h);
 r.handle(pid, {t: 'pick', i: 0, offerEpoch: h.offerEpoch});
 assert.ok(h.weapons.has('orb') && h.weapons.has('knives') && !h.weapons.has('bolt'));
 assert.equal(g.requestDash({vector: () => ({x: 1, y: 0})}), true);
 net.dispatch(acks.at(-1)); r.tick(dt); r.snapshot(); // Drop the cancel/first-dash delta.
 r.tick(dt); r.snapshot(); net.receive(JSON.stringify(wire.at(-1)));
 assert.equal(requests.at(-1).t, 'kf'); assert.ok(g.shots.has(consumedId), 'lost cancel is observable before recovery');
 r.snapshot(); const key = wire.at(-1); assert.equal(key.K, 1);
 net.receive(JSON.stringify(key));
 assert.equal(g.shots.has(consumedId), false); assert.ok(g.shots.has(independentId));
 assert.equal(g.moveEpoch, h.moveEpoch); assert.equal(g.moveEpoch, 1);
 assert.equal(g.local.x, h.x); assert.ok(h.x > 0 && h.x < 180);
 assert.ok(key.consumedAttacks.some(([kind, id]) => kind === 0 && id === consumedId));
 for (let i = 0; i < 3; i++) r.tick(dt);
 r.handle(pid, {t: 'kf'}); r.snapshot(); net.receive(JSON.stringify(wire.at(-1)));
 assert.equal(h.x, 180); assert.equal(g.local.x, 180); assert.equal(g.dashTravel, null);
 assert.ok(g.shots.has(independentId)); assert.equal(g.shots.has(consumedId), false);
 g.update(dt, {vector: () => ({x: 0, y: 0})});
 assert.equal(requests.at(-1).t, 'pos'); assert.equal(requests.at(-1).epoch, 1);
 r.time += dt; r.snapshot(); net.receive(JSON.stringify(wire.at(-1)));
 assert.equal(h.posAck, 1); assert.equal(g.ackSeq, 1); assert.equal(g.moveEpoch, 1);
});
