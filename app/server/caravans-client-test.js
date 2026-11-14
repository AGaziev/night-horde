import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Exercise the production snapshot consumer, HUD, cargo drawing and direction arrow.
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const card = { open: false, contains: () => false };
Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => card } });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caravan-client-'));
try {
	fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
	const dir = new URL('../public/js/', import.meta.url);
	for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
		const source = fs.readFileSync(new URL(name, dir), 'utf8').replaceAll("'/shared/content.js'",
			JSON.stringify(new URL('../public/shared/content.js', import.meta.url).href));
		fs.writeFileSync(path.join(tmp, name), source);
	}
	const { Game } = await import(pathToFileURL(path.join(tmp, 'game.js')));
	const { UI } = await import(pathToFileURL(path.join(tmp, 'ui.js')));
	const { Renderer } = await import(pathToFileURL(path.join(tmp, 'render.js')));
	const game = new Game({ send() {} }); game.me = 1;
	game.begin({ players: [{ pid: 1, hero: 'knight', x: 0, y: 0 }] });
	const cv = { status: 'guarded', x: 1200, y: 0, killed: 0, total: 14, expires: 330 };
	game.onSnapshot({ tm: 210, p: [], e: [], fx: [], cv });
	assert.deepEqual(game.latest().cv, cv);
	game.view.b = game.latest();
	const written = new Map(), ui = Object.create(UI.prototype);
	ui.cache = { passives: '{}', embers: '{}', allies: '' };
	ui.set = (id, prop, value) => written.set(`${id}.${prop}`, value);
	ui.updateHud(game);
	assert.equal(written.get('hud-caravan-status.text'), '◆ Караван · охрана 0/14 · 120 с · необязательно');
	const renderer = Object.create(Renderer.prototype);
	Object.assign(renderer, { vx0: -1e6, vx1: 1e6, vy0: -1e6, vy1: 1e6, arrowBuf: [], allyArrows: [], itemArrows: [], tmp: {} });
	renderer.toScreen = () => ({ x: -100, y: 0 });
	renderer.onScreen = () => false;
	renderer.edgeArrow = (point, options) => options;
	renderer.updateArrowBox = () => {};
	const text = [], ctx = new Proxy({}, { get: (_, key) => key === 'strokeText' || key === 'fillText' ? value => text.push(value) : () => {} });
	renderer.drawCaravan(ctx, game);
	assert.ok(text.includes('◆ Караван · 0/14'));
	assert.ok(renderer.arrowList(game, 0).some(arrow => arrow.kind === 'caravan' && arrow.name.includes('1200')));
	game.onSnapshot({ tm: 220, p: [], e: [], fx: [], cv: { ...cv, status: 'open', killed: 14 } });
	game.view.b = game.latest(); ui.updateHud(game);
	assert.match(written.get('hud-caravan-status.text'), /заберите груз/);
	game.onSnapshot({ tm: 330, p: [], e: [], fx: [], cv: null });
	game.view.b = game.latest(); ui.updateHud(game);
	assert.equal(written.get('hud-caravan.hidden'), true);
	assert.equal(renderer.arrowList(game, 0).filter(arrow => arrow.kind === 'caravan').length, 0);
	console.log('Caravan client: real snapshot, HUD guarded/open/closed, cargo drawing and offscreen direction: OK');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document; }
