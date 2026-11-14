import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Room } from './game.js';
import { ENEMY_TYPES } from '../public/shared/content.js';

// Import the real client modules with their browser-root content URL adapted for Node.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-client-'));
try {
	fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
	const dir = new URL('../public/js/', import.meta.url);
	for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
		const src = fs.readFileSync(new URL(name, dir), 'utf8').replaceAll("'/shared/content.js'", JSON.stringify(new URL('../public/shared/content.js', import.meta.url).href)).replaceAll("'/shared/daily.js'", JSON.stringify(new URL('../public/shared/daily.js', import.meta.url).href));
		fs.writeFileSync(path.join(tmp, name), src);
	}
	const { Game, E_STRIDE } = await import(pathToFileURL(path.join(tmp, 'game.js')));
	const { UI } = await import(pathToFileURL(path.join(tmp, 'ui.js')));
	const { Renderer } = await import(pathToFileURL(path.join(tmp, 'render.js')));
	const text = [], ctx = new Proxy({}, { get: (_, key) => key === 'strokeText' || key === 'fillText' ? s => text.push(s) : () => {} });
	for (const n of [1, 2, 4, 8]) {
		const r = new Room('HUD', () => {});
		for (let i = 1; i <= n; i++) r.addPlayer(i, `P${i}`, 'knight');
		r.start(); r.time = r.runLength * 2 / 3;
		const hs = [...r.heroes.values()]; r.updateOutposts(hs);
		const p = r.outposts.posts[0]; hs[0].x = p.x; hs[0].y = p.y; r.updateOutposts(hs);
		r.killEnemy(r.enemies.find(e => e.outpost === p), hs[0]);
		const op = r.snapshot().op;
		const g = new Game({ send() {} }); g.me = 1;
		g.begin({ players: [{ pid: 1, hero: 'knight', name: 'One', x: 0, y: 0 }] });
		g.onSnapshot({ tm: 600, p: [], e: [], fx: [], op });
		const written = new Map(), ui = Object.create(UI.prototype);
		ui.cache = { passives: '{}', embers: '{}', allies: '' };
		ui.set = (id, prop, value) => written.set(`${id}.${prop}`, value);
		ui.updateHud(g);
		assert.equal(written.get('hud-outposts.text'), `⚑ Аванпосты: 0/${n + 1} · охрана 1/${(n + 1) * 40}`);
		const renderer = Object.create(Renderer.prototype);
		Object.assign(renderer, { vx0: -1e6, vx1: 1e6, vy0: -1e6, vy1: 1e6 });
		text.length = 0; renderer.drawOutposts(ctx, { view: { b: { op } } }, 0);
		assert.ok(text.includes('Повержено 1/40 · сундук заперт'));
	}
	// A dense same-archetype frame exceeds the old per-type buffer (414) and must all render.
	const renderer = Object.create(Renderer.prototype), type = ENEMY_TYPES.indexOf('skel'), count = 758;
	for (const key of ['ex', 'ey', 'eh', 'eid', 'edx', 'est']) renderer[key] = ENEMY_TYPES.map(() => key === 'eid' || key === 'est' ? new Int32Array(414) : new Float32Array(414));
	Object.assign(renderer, { ecount: new Int32Array(ENEMY_TYPES.length), tmp: {}, elites: [], visible: () => true });
	const e = Array.from({ length: count }, (_, i) => [i + 1, type, i, 10, 1, 0]).flat();
	assert.equal(e.length, count * E_STRIDE);
	const batch = [];
	renderer.drawType = (ctx, type, count) => batch.push({ type, count });
	renderer.drawElite = () => {};
	renderer.drawWindupWarnings = () => {}; renderer.drawStates = () => {};
	renderer.drawEnemies(ctx, { a: { e, eIdx: new Map(), tm: 0 }, b: { e, tm: .1 }, et: 1 }, 0);
	assert.equal(renderer.ecount[type], count, 'all visible enemies retained before drawing');
	assert.equal(batch.find(b => b.type === type).count, count, 'drawing receives the full same-type batch');
	assert.ok(renderer.eid[type].length >= count); assert.equal(renderer.eid[type][count - 1], count);
	const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
	try {
		let color; const fills = [];
		const radar = new Proxy({}, { set: (_, key, value) => { if (key === 'fillStyle') color = value; return true; },
			get: (_, key) => key === 'fillRect' ? () => fills.push(color) : () => {} });
		Object.assign(renderer, { overlay: { mm: { clientWidth: 140, style: {}, getContext: () => radar } }, camX: 0, camY: 0, w: 800, h: 600, zoom: 1, mmAt: 0 });
		for (const [killed, expected] of [[20, '#ffab70'], [40, '#a5d6a7']]) {
			fills.length = 0; renderer.mmAt = 0;
			renderer.updateMinimap({ view: { b: { it: [], e: [], p: [], op: { posts: [[1, 2000, 0, killed, 40, 0, 40]] } } }, finale: () => null, event: () => null }, 1, true);
			assert.deepEqual(fills, [expected], 'radar clearance uses the actual post total');
		}
	} finally {
		if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete globalThis.window;
	}
	console.log('Outpost client density: real HUD/canvas/radar totals 80/120/200/360 and 758 same-type render records: OK');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
