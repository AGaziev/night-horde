import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dailyFor } from '../public/shared/daily.js';

// Execute production client consumers. Only browser-root import URLs and DOM are adapted.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-client-'));
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const oldObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
try {
	fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
	const dir = new URL('../public/js/', import.meta.url);
	for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
		const source = fs.readFileSync(new URL(name, dir), 'utf8').replace(/'\/shared\/([^']+)'/g,
			(_, file) => JSON.stringify(new URL('../public/shared/' + file, import.meta.url).href));
		fs.writeFileSync(path.join(tmp, name), source);
	}
	class Node {
		constructor() { this.children = []; this.style = {}; this.dataset = {}; this.classList = { toggle() {} }; this.attributes = {}; }
		set textContent(value) { this.text = value; this.children = []; }
		get textContent() { return (this.text ?? '') + this.children.map(n => n.textContent).join(' '); }
		get childElementCount() { return this.children.length; }
		appendChild(child) { this.children.push(child); return child; }
		append(...children) { this.children.push(...children); }
		replaceChildren(...children) { this.text = ''; this.children = children; }
		setAttribute(key, value) { this.attributes[key] = value; }
		addEventListener() {}
	}
	const nodes = new Map();
	const node = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: node, createElement: () => new Node() } });
	Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const { UI } = await import(pathToFileURL(path.join(tmp, 'ui.js')));
	const { Game } = await import(pathToFileURL(path.join(tmp, 'game.js')));
	const { renderResults, resultsText } = await import(pathToFileURL(path.join(tmp, 'results.js')));
	const ui = Object.create(UI.prototype);
	ui.selectHero = () => {}; ui.renderDuoBook = () => {};
	const daily = { ...dailyFor(), mode: 'lunch', players: 2 };
	const lobby = { code: 'ABCDEF', mode: 'lunch', host: 1, dailySelected: true, daily,
		players: [{ pid: 1, name: 'Host', hero: 'witch' }, { pid: 2, name: 'Guest', hero: 'ranger' }] };
	ui.renderLobby(lobby, 1);
	assert.equal(node('lobby-daily').checked, true);
	assert.equal(node('lobby-daily').disabled, false);
	assert.ok(node('lobby-daily-description').textContent.includes(daily.description));
	assert.match(node('lobby-daily-hint').textContent, /обычный прогресс не начисляется/);
	ui.renderLobby(lobby, 2);
	assert.equal(node('lobby-daily').disabled, true);
	ui.renderLobby({ ...lobby, startsAt: Date.now() + 60000 }, 1);
	assert.equal(node('lobby-daily').disabled, true);
	assert.ok(node('lobby-mode').children.every(button => button.disabled));

	const game = new Game({ send() {} });
	game.begin({ daily: { ...daily, mods: { speed: 0.9 } }, players: [] });
	assert.equal(game.speedMul(), 0.9, 'prediction follows the server challenge speed');
	game.begin({ players: [] });
	assert.equal(game.speedMul(), 1, 'ordinary retry cannot retain challenge speed');

 const written = new Map(), hud = Object.create(UI.prototype);hud.set = (id,prop,value) => written.set(id+'.'+prop,value);hud.cache={passives:'{}',embers:'{}',allies:''};
 game.begin({daily,players:[]});game.onSnapshot({tm:20,p:[],e:[],fx:[],swarm:null,swarmResult:{end:20,success:true,killed:42,spawned:60}});hud.updateHud(game);
 assert.equal(written.get('hud-swarm.hidden'),false);assert.match(written.get('hud-swarm.text'),/каждому \+15%/);
 game.onSnapshot({tm:21,p:[],swarmResult:{end:20,success:false,killed:41,spawned:60}});hud.updateHud(game);assert.match(written.get('hud-swarm.text'),/цель не выполнена/);
 game.onSnapshot({tm:26,p:[],swarmResult:{end:20,success:true,killed:42,spawned:60}});hud.updateHud(game);assert.equal(written.get('hud-swarm.hidden'),true);

	const card = { daily, mode: 'lunch', players: [], win: true, grade: 1, time: 600, kills: 4 };
	const root = new Node();
	assert.equal(renderResults(root, card), true);
	assert.match(root.textContent, /Испытание пройдено/);
	assert.ok(root.textContent.includes(daily.description));
	assert.match(resultsText(card), /Обычный прогресс не начисляется/);
	console.log('Daily client: host/guest/countdown, actual prediction/reset, results badge and share text: OK');
} finally {
	if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete globalThis.document;
	if (oldObserver) Object.defineProperty(globalThis, 'ResizeObserver', oldObserver); else delete globalThis.ResizeObserver;
	fs.rmSync(tmp, { recursive: true, force: true });
}
