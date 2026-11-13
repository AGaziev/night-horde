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
const { historyResult, renderHordeHistory } = await import(moduleUrl(browserSource('run-history.js')
	.replace("'./ui.js'", JSON.stringify(uiUrl)).replace("import { renderResults } from './results.js';", '')));

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

test('horde archive renders its own outcome and army build without a PvE results card', (t) => {
	class Element {
		constructor() { this.children = []; this.hidden = true; this.text = ''; }
		append(...children) { this.children.push(...children); }
		replaceChildren() { this.children = []; }
		set textContent(value) { this.text = value; this.children = []; }
		get textContent() { return this.text + this.children.map((c) => c.textContent).join(' '); }
	}
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new Element() } });
	t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
	const log = { ruleset: 'horde', win: false, reason: 'wipe', time: 120,
		director: { name: 'Commander', build: { packs: { swarm: 2 }, weapons: { venom: 1 }, artifacts: { censer: 1 } } },
		team: [{ name: 'Hero', hero: 'knight', level: 3 }] };
	const container = new Element();
	assert.equal(historyResult(log), 'Орда победила', 'history names the winning side instead of falsely calling the director a loser');
	assert.equal(historyResult({ ...log, win: true }), 'Герои победили');
	assert.equal(renderHordeHistory(container, log), true);
	assert.equal(container.hidden, false);
	assert.match(container.textContent, /Чумной жезл 1 ур\./);
	assert.match(container.textContent, /Чумная кадильница 1 ур\./);
	assert.match(container.textContent, /Матч без рейтинга/);
	assert.match(container.textContent, /Hero/);
	assert.equal(historyResult({ win: true, grade: 1 }), 'Победа', 'ordinary PvE history keeps its label');
	assert.equal(renderHordeHistory(container, { ...log, ruleset: 'pve' }), false);
});

test('horde resync restores only remaining warning, charge and projectile state in its own round', () => {
	const game = new Game({ send() {} }); game.me = 1;
	game.begin({ ruleset: 'horde', roundId: 'resync-round', directorPid: 2, players: [{ pid: 1, hero: 'knight' }] });
	const resync = { t: 'horde-resync', roundId: 'resync-round', time: 42,
		warnings: [{ x: 10, y: 20, r: 88, remaining: 0.35 }],
		shots: [{ id: 7, x: 300, y: 120, vx: 80, vy: -20, remaining: 0.5, r: 8 }],
		lanes: [{ x1: 0, y1: 1, x2: 20, y2: 30, w: 50, remaining: 0.2 }], fxBefore: [] };
	game.onHordeResync(resync);
	assert.equal(game.warns.length, 1); assert.equal(game.warns[0].life, 0.35);
	assert.equal(game.blines[0].life, 0.2);
	assert.equal(game.hostile.get(7).x, 300, 'restore the current position rather than the original spawn point');
	assert.equal(game.hostile.get(7).end, 42.5);
	game.hordeTime = () => 42.1; game.advanceHostile(); game.updateEffects(0.001);
	assert.equal(game.hostile.get(7).show, true);
	assert.ok(Math.abs(game.hostile.get(7).x - 308) < 1e-6);
	assert.ok(Math.abs(game.warns[0].t - 0.1) < 1e-6, 'remaining duration follows the server clock, not render dt');
	game.onHordeResync({ ...resync, roundId: 'older-round', warnings: [], shots: [], lanes: [] });
	assert.equal(game.warns.length, 1); assert.equal(game.hostile.size, 1);
	game.hordeTime = () => 42.6; game.advanceHostile(); game.updateEffects(0.001);
	assert.equal(game.hostile.size, 0); assert.equal(game.warns.length, 0); assert.equal(game.blines.length, 0);
	game.begin({ ruleset: 'pve', players: [] }); game.onHordeResync(resync);
	assert.equal(game.hostile.size, 0); assert.equal(game.warns.length, 0);
});

test('resync skips queued effects once without suppressing an identical new warning', () => {
	const game = new Game({ send() {} });
	game.begin({ ruleset: 'horde', roundId: 'fx-round', directorPid: 2, players: [] });
	const warn = ['warn', 10, 20, 88, 1.5], shot = ['eshot', 7, 100, 0, 20, 0, 4, 39];
	game.onHordeResync({ roundId: 'fx-round', time: 42, warnings: [{ x: 10, y: 20, r: 88, remaining: 0.2 }],
		shots: [], lanes: [], fxBefore: [warn, shot] });
	game.onSnapshot({ tm: 42.1, p: [], fx: [warn, shot, [...warn]] });
	game.view.tm = 42.1; game.applyEffects();
	assert.equal(game.warns.length, 2, 'one old warning is skipped and the genuinely new identical warning is preserved');
	assert.equal(game.warns[0].life, 0.2, 'old full-duration warning must not restart');
	assert.equal(game.hostile.size, 0, 'a completed queued projectile cannot be resurrected');
	game.onSnapshot({ tm: 42.2, p: [], fx: [warn] });
	game.view.tm = 42.2; game.applyEffects();
	assert.equal(game.warns.length, 3, 'filter is consumed exactly once');
});

test('resync effect dedup also covers a snapshot gap and stale snapshots cannot replace restored attacks', () => {
	const game = new Game({ send() {} });
	game.begin({ ruleset: 'horde', roundId: 'gap-round', players: [] });
	const shot = ['eshot', 7, 100, 0, 20, 0, 4, 39];
	game.onHordeResync({ roundId: 'gap-round', time: 42, warnings: [], lanes: [],
		shots: [{ id: 7, x: 160, y: 0, vx: 20, vy: 0, remaining: 1 }], fxBefore: [shot] });
	game.onSnapshot({ tm: 41, p: [], fx: [shot] });
	assert.equal(game.hostile.get(7).x0, 160);
	game.onSnapshot({ gap: true, tm: 42.1, fx: [shot] });
	assert.equal(game.hostile.get(7).x0, 160);
	game.onHordeResync({ roundId: 'gap-round', time: 41, warnings: [], shots: [], lanes: [] });
	assert.equal(game.hostile.size, 1, 'older resync cannot erase newer restored state');
});
