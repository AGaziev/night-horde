import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';

test('CEO55-2 requests are bound to current run, monotonic identity and a short wall-clock deadline', () => {
 const sent = [], r = new Room('REQUEST', (pid,m) => sent.push(m)); r.addPlayer(1, 'P', 'witch'); r.start();
 const h = r.heroes.get(1), run = r.runLog.id;
 const request = { t: 'dash', x: 1, y: 0, run, request: 1, expiresAt: Date.now()+1500 };
 r.handle(1, { ...request, expiresAt: Date.now()-1 }); assert.equal(h.dash, undefined);
 r.handle(1, { ...request, run: 'old-run' }); assert.equal(h.dash, undefined);
 r.handle(1, { ...request, expiresAt: Date.now()+99999 }); assert.equal(h.dash, undefined);
 r.handle(1, request); assert.ok(h.dash); assert.equal(sent.at(-1).run, run); assert.equal(sent.at(-1).request, 1);
 h.dash = null; h.dashReadyAt = 0; r.handle(1, request); assert.equal(h.dash, null, 'duplicate cannot replay after cooldown');
 r.start(); const next = r.heroes.get(1); assert.notEqual(r.runLog.id, run);
 r.handle(1, { ...request, expiresAt: Date.now()+1500 }); assert.equal(next.dash, undefined, 'same sid cannot carry an old POST into a new run');
});
test('CEO55-6 reconnect returns last authoritative facing and the next request sequence', () => {
 const r = new Room('FACE', () => {}); r.addPlayer(1, 'P', 'witch'); r.start(); const h = r.heroes.get(1);
 Object.assign(h, {fx: -1, fy: 0, dashRequest: 7});
 const msg = r.startMsg(); assert.equal(msg.players[0].fx, -1); assert.equal(msg.players[0].fy, 0); assert.equal(msg.players[0].dashRequest, 7);
 assert.equal(msg.mobilityRun, r.runLog.id); assert.ok(msg.serverNow <= Date.now());
});
