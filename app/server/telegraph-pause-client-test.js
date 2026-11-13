import assert from 'node:assert/strict';
import fs from 'node:fs';

// The server stands still while paused (menu, solo level-up offer), so the warnings of what it will do next
// (Трубач lanes, warn circles) must not fade on the client meanwhile: after the pause they keep their remaining time.
const file = new URL('../public/js/game.js', import.meta.url);
const source = fs.readFileSync(file, 'utf8').replace("'/shared/content.js'", JSON.stringify(new URL('../public/shared/content.js', import.meta.url).href));
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const g = new Game({ send() {} }); g.me = 1;
g.begin({ players: [{ pid: 1, hero: 'knight', name: 'One', x: 0, y: 0 }] });

for (const menu of [false, true]) {
	g.blines.length = g.warns.length = 0;
	for (let i = 0; i < 5; i++) g.effect(['bline', 0, 0, 600, i * 40, 34, 0.9]);
	g.effect(['warn', 100, 100, 80, 0.9]);
	g.updateEffects(0.3);
	g.setPause(true, menu);
	for (let i = 0; i < 300; i++) g.updateEffects(1 / 60);
	assert.equal(g.blines.length, 5, `lanes survive a ${menu ? 'menu' : 'level-up'} pause`);
	assert.equal(g.warns.length, 1, 'warn circles survive the pause');
	assert.ok([...g.blines, ...g.warns].every(f => Math.abs(f.t - 0.3) < 1e-9), 'telegraphs do not age while paused');
	g.setPause(false);
	g.updateEffects(0.59);
	assert.equal(g.blines.length, 5, 'the remaining 0.6 s is shown after the pause');
	g.updateEffects(0.02);
	assert.equal(g.blines.length + g.warns.length, 0, 'telegraphs end with their windup');
}
console.log('Telegraph pause (client): lanes and warn circles keep their remaining time over menu and level-up pauses: OK');
