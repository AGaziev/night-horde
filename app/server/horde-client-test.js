import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

// Use the production state and role controls. Only browser-root URLs and unused canvas imports are adapted.
const browserSource = (name) => fs.readFileSync(new URL('../public/js/' + name, import.meta.url), 'utf8')
	.replaceAll("'/shared/", "'" + new URL('../public/shared/', import.meta.url).href);
const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const gameUrl = moduleUrl(browserSource('game.js'));
const { Game } = await import(gameUrl);
const uiUrl = moduleUrl(browserSource('ui.js')
	.replace("import { drawHeroPreview } from './render.js';", '')
	.replace("import { sprites } from './sprites.js';", '')
	.replace("import { renderResults } from './results.js';", '')
	.replace("'./game.js'", JSON.stringify(gameUrl)));
const { UI } = await import(uiUrl);
const { setupLobbyInvites } = await import(moduleUrl(browserSource('lobby-invites.js').replace("'./ui.js'", JSON.stringify(uiUrl))));

test('a full horde lobby can release and transfer its director role without removing a participant', (t) => {
	const button = (role) => ({ dataset: { role }, classList: { toggle() {} }, setAttribute() {}, disabled: false });
	const hero = button('hero'), director = button('director');
	const box = { childElementCount: 2, children: [hero, director] }, hint = {};
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: (id) => id === 'lobby-role' ? box : hint } });
	t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
	const ui = Object.create(UI.prototype);
	ui.renderRole('director', { pid: 1, name: 'Director' }, 4, 1);
	assert.equal(hero.disabled, false, 'director must be able to temporarily become the fifth hero');
	ui.renderRole('hero', { pid: 1, name: 'Director' }, 4, 2);
	assert.equal(director.disabled, true, 'a second director cannot occupy an already taken role');
	ui.renderRole('hero', null, 5, 2);
	assert.equal(director.disabled, false, 'a hero can take the now-vacant director role');
});

test('invite countdown updates cannot enable Start after role validation disabled it', (t) => {
	const nodes = new Map();
	const node = (id) => {
		if (!nodes.has(id)) nodes.set(id, { disabled: false, addEventListener() {}, close() {} });
		return nodes.get(id);
	};
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: node } });
	t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
	const invites = setupLobbyInvites({ invites: false, send() {} }, () => {});
	node('lobby-start').disabled = true;
	invites.update({ code: 'FULL', host: 1, startsAt: null }, 1);
	assert.equal(node('lobby-start').disabled, true, 'countdown rendering preserves the role/start validator result');
});

test('horde slowing is capped, expires and is cleared when the next run starts', () => {
	const game = new Game({ send() {} }); game.me = 1;
	const player = { pid: 1, hero: 'knight', name: 'Hero', x: 0, y: 0 };
	game.begin({ ruleset: 'horde', directorPid: 2, players: [player] });
	game.onHordeStatus({ time: 10, effects: [{ pid: 1, poisonUntil: 13, chillUntil: 12, slow: 0.8 }] });
	assert.equal(game.speedMul(), 0.78, 'server status cannot slow the predicted hero beyond 22%');
	game.onHordeStatus({ time: 9, effects: [] });
	assert.ok(game.hordeStatus(1), 'a stale frame cannot erase a newer status');
	game.hordeTime = () => 13;
	assert.equal(game.speedMul(), 1, 'expired chill restores ordinary movement');
	assert.equal(game.hordeStatus(1), null);
	game.begin({ ruleset: 'pve', players: [player] });
	assert.equal(game.hordeStatuses.size, 0);
	game.onHordeStatus({ time: 14, effects: [{ pid: 1, chillUntil: 30, slow: 0.2 }] });
	assert.equal(game.speedMul(), 1, 'horde frames cannot change an ordinary PvE run');
});
