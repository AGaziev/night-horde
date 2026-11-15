import assert from 'node:assert/strict';
import fs from 'node:fs';

// Execute the real browser state module; only its browser-root import URL is adapted for Node.
const file = new URL('../public/js/game.js', import.meta.url);
const source = fs.readFileSync(file, 'utf8').replaceAll("'/shared/", "'" + new URL('../public/shared/', import.meta.url).href);
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const g = new Game({ send() {} }); g.me = 1;
g.begin({ players: [{ pid: 1, hero: 'knight', name: 'One', x: 0, y: 0 }] });
g.pvals.area = .2;
const op = { status: 'active', total: 2, guards: 80, cleared: 1, posts: [[1, 2000, 0, 40, 40, 1, 40], [2, -2000, 0, 4, 40, 0, 40]] };
g.onSnapshot({ tm: 600, p: [], e: [], fx: [], op, trophy: [1, 2] });
assert.ok(Math.abs(g.areaMul() - 1.2 * 1.15) < 1e-10, 'own visual area includes the multiplicative trophy');
assert.equal(g.areaMul(2), 1.15, 'teammate persistent attack visuals receive their trophy too');
assert.deepEqual(g.latest().op, op, 'objective retained by client snapshot buffering');
assert.deepEqual(g.latest().trophy, [1, 2]);
const events=[];g.onEvent=(...args)=>events.push(args);g.effect(['outposts','closed']);
assert.deepEqual(events,[['outposts','closed',undefined]],'objective effects reach the visible UI notifications');
g.reset();assert.equal(g.areaMul(), 1, 'new run resets trophy visual size');
console.log('Outpost client: objective buffer and own/ally trophy visual scaling/reset: OK');
