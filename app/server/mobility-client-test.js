import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8')
	.replace("'/shared/content.js'", JSON.stringify(new URL('../public/shared/content.js', import.meta.url).href));
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const sent = [], g = new Game({ send: m => sent.push(m) });
g.me = 1; g.begin({ players: [{ pid: 1, hero: 'knight', x: 0, y: 0 }] });
const input = { vector: () => ({ x: 0, y: 1 }) };
assert.equal(g.requestDash(input), true);
assert.deepEqual(sent.at(-1), { t: 'dash', x: 0, y: 1 });
assert.equal(g.requestDash(input), false, 'holding/repeated command is not queued');
g.acceptDash({ ok: true, epoch: 1, x: 0, y: 0, dx: 0, dy: 1, readyAt: 12 });
for (let i = 0; i < 5; i++) g.update(1 / 30, input);
assert.ok(Math.abs(g.local.y - 180) < 1e-6);
assert.equal(g.local.x, 0);
assert.equal(sent.at(-1).epoch, 1);
assert.equal(g.requestDash(input), false);
g.onSnapshot({ tm: 12, p: [[1, 0, 180, 100, 100, 1, 0, 10, 0]], mob: [[1, 1, 12]] });
assert.equal(g.requestDash(input), true);
g.acceptDash({ ok: false, epoch: 1 }); assert.equal(g.dashWaiting, 0);
g.frozen = true; assert.equal(g.requestDash(input), false);
g.reset(); assert.equal(g.moveEpoch, 0); assert.equal(g.dashTravel, null);
console.log('Mobility client: action, server acceptance, cooldown, reset and epoch OK');

{
 const game = new Game({ send() {} }); game.me = 1;
 game.begin({ players: [{ pid: 1, hero: 'knight', x: 0, y: 0 }] });
 game.acceptDash({ ok: true, epoch: 1, x: 0, y: 0, dx: 1, dy: 0, readyAt: 12 });
 for (let i = 0; i < 5; i++) game.update(1 / 30, { vector: () => ({ x: 0, y: 0 }) });
 game.onSnapshot({ tm: 0.05, p: [[1, 0, 0, 100, 100, 1, 0, 10, 0]], mob: [[1, 0, 0]] });
 assert.equal(game.local.x, 180, 'pre-dash snapshot cannot undo an accepted dash');
 assert.equal(game.dashReadyAt, 12, 'pre-dash snapshot cannot reset the cooldown');
 game.onSnapshot({ tm: 0.1, p: [[1, 0, 0, 100, 100, 1, 0, 10, 0]], mob: [[1, 1, 12]] });
 assert.equal(game.local.x, 180, 'intermediate snapshot cannot rewind completed local travel');
 game.onSnapshot({ tm: 0.2, p: [[1, 0, 0, 0, 100, 1, 0, 10, 1]], mob: [[1, 1, 12]] });
 assert.equal(game.local.x, 0, 'authoritative down state still corrects position');
 assert.equal(game.dashTravel, null);
}
