import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VISUAL_KEY, DEFAULT_VISUAL, parseVisual, loadVisual, saveVisual } from '../public/js/visual.js';

// Issue #11: damage numbers «all / crits / off» and effects «full / lite», kept in localStorage.

assert.deepEqual(parseVisual(null), DEFAULT_VISUAL, 'nothing stored: defaults');
assert.deepEqual(parseVisual('{broken'), DEFAULT_VISUAL, 'broken JSON: defaults');
assert.deepEqual(parseVisual('{"numbers":"loud","effects":7}'), DEFAULT_VISUAL, 'unknown values: defaults');
assert.deepEqual(parseVisual('{"numbers":"crits"}'), { numbers: 'crits', effects: 'full' }, 'missing field keeps its default');

const mem = new Map();
const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
saveVisual({ numbers: 'off', effects: 'lite', junk: 1 }, DEFAULT_VISUAL, storage);
assert.deepEqual(JSON.parse(mem.get(VISUAL_KEY)), { numbers: 'off', effects: 'lite' }, 'only known fields are stored');
assert.deepEqual(loadVisual(storage), { numbers: 'off', effects: 'lite' }, 'stored choice survives a reload');
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
assert.deepEqual(loadVisual(broken), DEFAULT_VISUAL, 'storage that throws (private mode): defaults');
assert.deepEqual(saveVisual({ effects: 'lite' }, { numbers: 'crits', effects: 'full' }, broken), { numbers: 'crits', effects: 'lite' },
	'storage that throws: the change is applied over this tab\'s settings');

// Two tabs: each writes only the field it changed over what is stored now.
mem.clear();
const tabA = saveVisual({ numbers: 'crits' }, DEFAULT_VISUAL, storage); // tab A loaded defaults
const tabB = saveVisual({ effects: 'lite' }, DEFAULT_VISUAL, storage); // tab B also loaded defaults, then changed effects
assert.deepEqual(tabA, { numbers: 'crits', effects: 'full' });
assert.deepEqual(tabB, { numbers: 'crits', effects: 'lite' }, 'tab B keeps tab A\'s «crits»');
assert.deepEqual(loadVisual(storage), { numbers: 'crits', effects: 'lite' }, 'stored: both changes');
mem.set(VISUAL_KEY, '{broken');
assert.deepEqual(saveVisual({ effects: 'lite' }, { numbers: 'off', effects: 'full' }, storage), { numbers: 'all', effects: 'lite' },
	'broken stored value: defaults plus the change');

// Blocked site data: the localStorage getter itself throws (Chrome «block all cookies», sandboxed iframe).
const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
try {
	assert.deepEqual(loadVisual(), DEFAULT_VISUAL, 'blocked localStorage getter: defaults, no throw');
	assert.doesNotThrow(() => saveVisual({ numbers: 'off', effects: 'lite' }), 'blocked localStorage getter: save is a no-op');
} finally {
	if (had) Object.defineProperty(globalThis, 'localStorage', had);
	else delete globalThis.localStorage;
}

// Keys on a focused radio group: arrows switch the option, WASD and other game keys reach the hero.
const { isTyping } = await import('../public/js/input.js');
const radio = { tagName: 'INPUT', type: 'radio' };
for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) assert.equal(isTyping({ target: radio, code }), true, code);
for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Digit1', 'KeyM']) assert.equal(isTyping({ target: radio, code }), false, code);
assert.equal(isTyping({ target: { tagName: 'INPUT', type: 'text' }, code: 'KeyW' }), true, 'text field keeps every key');
assert.equal(isTyping({ target: { tagName: 'TEXTAREA' }, code: 'KeyW' }), true);
assert.equal(isTyping({ target: { tagName: 'CANVAS' }, code: 'ArrowRight' }), false, 'canvas: arrows move the hero');

// The real browser state module; only its browser-root imports are adapted for Node.
const url = (p) => JSON.stringify(new URL(p, import.meta.url).href);
const source = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8')
	.replace("'/shared/content.js'", url('../public/shared/content.js'));
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

function play(visual) {
	const g = new Game({ send() {} });
	g.me = 1;
	g.begin({ players: [{ pid: 1, hero: 'knight', name: 'One', x: 0, y: 0 }] });
	g.visual = visual;
	g.effect(['hit', 10, 10, 12]);
	g.effect(['hit', 20, 20, 40, 1, 1]);
	g.effect(['die', 30, 30, 0]);
	g.effect(['warn', 50, 50, 70, 0.6]);
	g.effect(['bline', 0, 0, 100, 0, 60, 0.8]);
	g.shotEvent(['eshot', 7, 0, 0, 10, 0, 1, 0]);
	return g;
}

const full = play({ numbers: 'all', effects: 'full' });
assert.deepEqual(full.numbers.map((n) => n.crit), [false, true], '«all» shows both numbers');
assert.deepEqual(play({ numbers: 'crits', effects: 'full' }).numbers.map((n) => n.crit), [true], '«crits» keeps only the crit');
assert.equal(play({ numbers: 'off', effects: 'full' }).numbers.length, 0, '«off» hides every number');

const lite = play({ numbers: 'off', effects: 'lite' });
assert.ok(lite.particles.length > 0 && lite.particles.length * 3 < full.particles.length,
	`lite keeps a fraction of particles (${lite.particles.length} of ${full.particles.length})`);
const boss = (effects) => {
	const g = play({ numbers: 'all', effects });
	g.particles.length = 0;
	g.burst(0, 0, '#fff', 60, 10);
	g.burst(0, 0, '#fff', 3, 10);
	return g.particles.length;
};
assert.equal(boss('full'), 63);
assert.equal(boss('lite'), 15 + 1, 'lite: a quarter of a burst, at least one particle');
// Switching mid-run drops numbers the new mode hides.
const mid = play({ numbers: 'all', effects: 'full' });
mid.setVisual({ numbers: 'crits', effects: 'full' });
assert.deepEqual(mid.numbers.map((n) => n.crit), [true], 'switch to «crits» keeps only crits on screen');
mid.setVisual({ numbers: 'off', effects: 'full' });
assert.equal(mid.numbers.length, 0, 'switch to «off» clears the screen');
for (const g of [full, lite]) {
	assert.equal(g.warns.length, 1, 'attack warning circle is kept at every setting');
	assert.equal(g.blines.length, 1, 'charge line is kept at every setting');
	assert.equal(g.hostile.size, 1, 'enemy shot is kept at every setting');
}

console.log(`Visual settings: storage, numbers all/crits/off, lite particles ${lite.particles.length}/${full.particles.length}, warnings kept: OK`);
