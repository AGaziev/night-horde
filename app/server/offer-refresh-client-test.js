import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { Room } from './game.js';

// Actual Room messages -> production UI.showOffer. Only the DOM, clock and timers are adapted.
const contentUrl = JSON.stringify(new URL('../public/shared/content.js', import.meta.url).href);
const gameSource = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8').replace("'/shared/content.js'", contentUrl)
	.replace("'/shared/daily.js'", JSON.stringify(new URL('../public/shared/daily.js', import.meta.url).href));
const gameUrl = 'data:text/javascript;base64,' + Buffer.from(gameSource).toString('base64');
const uiSource = fs.readFileSync(new URL('../public/js/ui.js', import.meta.url), 'utf8')
	.replace("'/shared/content.js'", contentUrl)
	.replace("'/shared/daily.js'", JSON.stringify(new URL('../public/shared/daily.js', import.meta.url).href))
	.replace("import { drawHeroPreview } from './render.js';", '')
	.replace("import { sprites } from './sprites.js';", '')
	.replace("import { renderResults } from './results.js';", '')
	.replace("'./game.js'", JSON.stringify(gameUrl));

class Node {
	constructor(tag = 'div') {
		this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.style = {}; this.hidden = true;
		this.classes = new Set();
		const self = this;
		this.classList = {
			add: (c) => self.classes.add(c), remove: (c) => self.classes.delete(c),
			toggle: (c, on) => ((on ?? !self.classes.has(c)) ? self.classes.add(c) : self.classes.delete(c)),
			contains: (c) => self.classes.has(c),
		};
	}
	set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
	get className() { return [...this.classes].join(' '); }
	set textContent(v) { for (const c of this.children) c.parent = null; this.text = v; this.children = []; }
	get textContent() { return this.text ?? ''; }
	appendChild(child) { child.parent = this; this.children.push(child); return child; }
	append(...nodes) { for (const n of nodes) this.appendChild(n); }
	addEventListener() {}
	setAttribute() {}
	contains(n) { for (; n; n = n.parent) if (n === this) return true; return false; }
	descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
	querySelectorAll(sel) {
		const tags = sel.split(',').map((s) => s.trim()).filter((s) => /^[a-z]+$/.test(s)).map((s) => s.toUpperCase());
		const classes = sel.split(/[\s,]+/).filter((s) => s.startsWith('.')).map((s) => s.slice(1));
		return this.descendants().filter((n) => tags.includes(n.tagName) || classes.some((c) => n.classes.has(c)));
	}
	focus() { globalThis.document.activeElement = this; }
}

function fixed(value, action) { const old = Math.random; Math.random = () => value; try { return action(); } finally { Math.random = old; } }

async function harness() {
	const nodes = new Map(), node = (id) => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
	const saved = { document: globalThis.document, now: performance.now, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
	let clock = 0, timers = [];
	globalThis.document = { getElementById: node, createElement: (tag) => new Node(tag), querySelectorAll: () => [], activeElement: null };
	performance.now = () => clock;
	globalThis.setTimeout = (fn, ms) => { const t = { fn, at: clock + ms }; timers.push(t); return t; };
	globalThis.clearTimeout = (t) => { timers = timers.filter((x) => x !== t); };
	const { UI } = await import('data:text/javascript;base64,' + Buffer.from(uiSource).toString('base64'));
	const { Game } = await import(gameUrl);
	const ui = Object.create(UI.prototype); ui.levelup = node('levelup'); ui.offerKey = ''; ui.revealTimers = [];
	const reveals = []; ui.onReveal = (i) => reveals.push(i);
	const advance = (ms) => {
		clock += ms;
		for (const t of timers.filter((x) => x.at <= clock).sort((a, b) => a.at - b.at)) { timers = timers.filter((x) => x !== t); t.fn(); }
	};
	const restore = () => {
		globalThis.document = saved.document; performance.now = saved.now;
		globalThis.setTimeout = saved.setTimeout; globalThis.clearTimeout = saved.clearTimeout;
	};
	return { ui, Game, box: node('levelup-cards'), advance, reveals, restore };
}

// The last outpost guard is alive; the hero has an open boss-chest offer with a Кузня card for Иней III.
function encounter() {
	const sent = [], r = new Room('OFFER-REFRESH', (pid, msg) => sent.push({ pid, msg: structuredClone(msg) }));
	r.addPlayer(1, 'One', 'knight'); r.addPlayer(2, 'Two', 'witch'); r.start();
	const hs = [...r.heroes.values()], h = hs[0]; r.time = 600; fixed(0, () => r.updateOutposts(hs));
	let last;
	for (const post of r.outposts.posts) {
		h.x = post.x; h.y = post.y;
		while (post.spawned < post.total || r.enemies.some(e => e.outpost === post && !e.dead && e !== last)) {
			r.updateOutposts(hs);
			const guards = r.enemies.filter(e => e.outpost === post && !e.dead && e !== last);
			for (const e of guards) {
				if (post === r.outposts.posts.at(-1) && post.spawned === post.total && e === guards.at(-1)) last = e;
				else r.killEnemy(e, h);
			}
			r.compactEnemies();
		}
	}
	h.weapons = new Map([['frost', { lvl: 3, t: 0 }], ['sickle', { lvl: 3, t: 0 }]]); h.passives.clear();
	h.forgeUsed = false; h.forgeDefer = 0;
	r.recalcMods(h); r.updateCombos(h);
	h.offer = fixed(0.5, () => r.makeChoices(h)); h.offerSpin = true; r.sendOffer(h); h.queue = 1;
	assert.equal(h.offer[0].kind, 'imprint'); assert.equal(h.offer[0].id, 'frost'); assert.ok(h.offer.length >= 2);
	const lvl = () => sent.findLast(x => x.pid === h.pid && x.msg.t === 'lvl').msg;
	return { r, h, last, lvl };
}

test('#24: an outpost reward refreshing the open Кузня card keeps revealed chest cards and focus', async () => {
	const { ui, box, advance, reveals, restore } = await harness();
	try {
		const { r, h, last, lvl } = encounter();
		const first = lvl();
		assert.equal(ui.showOffer(first), true, 'a new draw');
		const n = first.choices.length;
		assert.equal(box.children.filter((w) => w.classes.has('card-veil')).length, n, 'chest cards start face down');
		advance(600 * n + 1);
		assert.deepEqual(reveals, [...Array(n).keys()]);
		assert.ok(first.choices.every((_, i) => ui.cardReady(i)));
		box.children[1].querySelectorAll('button, select')[0].focus();
		const focused = document.activeElement;
		ui.setBanMode(true);

		fixed(0, () => r.killEnemy(last, h)); // the ally's kill: Иней III→IV, new epoch
		const fresh = lvl();
		assert.notEqual(fresh.offerEpoch, first.offerEpoch); assert.equal(fresh.choices[0].level, 4);
		assert.equal(ui.showOffer(fresh), false, 'a refresh is not a new draw (no legendary sound)');
		assert.equal(box.children.filter((w) => w.classes.has('card-veil')).length, 0, 'no card is hidden again');
		assert.ok(fresh.choices.every((_, i) => ui.cardReady(i)), 'every card stays selectable at once');
		assert.notEqual(document.activeElement, focused, 'the buttons were rebuilt');
		assert.equal(document.activeElement, box.children[1].querySelectorAll('button, select')[0], 'focus stays on the same card');
		assert.equal(ui.banMode, true, 'a background refresh keeps «Изгнать» armed');
		advance(5000);
		assert.equal(reveals.length, n, 'no second reveal');
	} finally { restore(); }
});

test('#24: a refresh during the chest reveal keeps the remaining reveal time, a new draw starts over', async () => {
	const { ui, box, advance, restore } = await harness();
	try {
		const { r, h, last, lvl } = encounter();
		const first = lvl(), n = first.choices.length;
		ui.showOffer(first);
		advance(700); // card 1 open, the rest still face down
		assert.ok(ui.cardReady(0) && !ui.cardReady(1));
		fixed(0, () => r.killEnemy(last, h));
		ui.showOffer(lvl());
		assert.ok(ui.cardReady(0), 'the open card stays open');
		assert.ok(!box.children[0].classes.has('card-veil') && box.children[1].classes.has('card-veil'));
		advance(500); // 1200 ms: the second card is due as before
		assert.ok(ui.cardReady(1) && !box.children[1].classes.has('card-veil'));

		ui.hideOffer();
		ui.showOffer({ ...first, offerEpoch: first.offerEpoch + 100 });
		assert.equal(box.children.filter((w) => w.classes.has('card-veil')).length, n, 'a reopened chest is a new draw');
	} finally { restore(); }
});

// The CEO scene for #46: the actual main.js handlers, Game and UI, with the server Room behind them.
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
function seededBy(seed, action) { const old = Math.random; Math.random = seeded(seed); try { return action(); } finally { Math.random = old; } }
const mainSource = fs.readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');

// The actual main.js `lvl` handler and pick/reroll/ban actions over a real Game; `deliver` hands the client every new `lvl` in order.
function wire(ui, Game, r, sent, pid) {
	const outbox = [], game = new Game({ send: (msg) => outbox.push(msg) }); game.me = pid; game.begin(r.startMsg());
	ui.screen = 'game';
	const handlers = new Map(), net = { on: (name, handler) => handlers.set(name, handler) };
	const lvl = mainSource.match(/net\.on\('lvl', \(msg\) => \{[\s\S]*?\n\}\);/)?.[0];
	const actions = mainSource.slice(mainSource.indexOf('function pick(i, drop) {'), mainSource.indexOf('ui.onSkip = input.onSkip = skip;'));
	assert.ok(lvl && actions.includes('function reroll()'), 'actual main.js handlers found');
	const input = {}, sound = { card() {}, legendary() {} };
	new Function('net', 'game', 'ui', 'sound', lvl)(net, game, ui, sound);
	new Function('game', 'ui', 'input', 'sound', actions)(game, ui, input, sound);
	let seen = 0;
	const deliver = () => {
		const fresh = sent.slice(seen).filter(x => x.pid === pid && x.msg.t === 'lvl').map(x => x.msg);
		seen = sent.length;
		for (const msg of fresh) handlers.get('lvl')(msg);
		return fresh;
	};
	return { game, input, outbox, deliver };
}

test('#24: a reroll returning the same cards and rarities without draft marks turns «Изгнать» off', async () => {
	const { ui, Game, restore } = await harness();
	try {
		const sent = [], r = new Room('REROLL-BAN', (pid, msg) => sent.push({ pid, msg: structuredClone(msg) }));
		r.addPlayer(1, 'One', 'knight'); r.addPlayer(2, 'Two', 'witch'); r.start();
		assert.equal(r.mode, 'night'); assert.equal(r.runLength, 900);
		const h = r.heroes.get(1);
		assert.equal(h.startWeapon, 'whip');
		r.time = 359;
		h.weapons = new Map([['whip', { lvl: 5, t: 9999, oc: 1 }], ['bolt', { lvl: 5, t: 9999, oc: 1 }]]);
		r.recalcMods(h); r.updateCombos(h);
		seededBy(395, () => r.grantOffer(h, false, 1));
		assert.deepEqual(h.offer.map(c => [c.id, c.rar, c.draft]), [['traps', 1, 'fit'], ['counterweight', 0, 'pivot'], ['coil', undefined, undefined]]);

		const { game, input, outbox, deliver } = wire(ui, Game, r, sent, 1);
		deliver();
		const first = game.offer, bans = h.bans;
		assert.ok(bans > 0 && h.rerolls > 0);

		input.onBan(); // B
		assert.equal(ui.banMode, true);
		r.time = 360; // 6:00
		input.onReroll();
		assert.equal(outbox.at(-1).t, 'reroll');
		seededBy(57, () => r.handle(1, outbox.at(-1)));
		deliver();
		assert.deepEqual(h.offer.map(c => [c.id, c.rar, c.draft]), [['traps', 1, undefined], ['counterweight', 0, undefined], ['coil', undefined, undefined]],
			'same cards and rarities, the draft marks are gone');
		assert.notEqual(game.offer.offerEpoch, first.offerEpoch);
		assert.equal(ui.banMode, false, 'the player\'s reroll turns «Изгнать» off');

		ui.onPick(0); // a click on «Капканы»
		assert.equal(outbox.at(-1).t, 'pick', 'the click picks, it does not banish');
		r.handle(1, outbox.at(-1));
		assert.equal(h.bans, bans, 'no ban charge spent');
		assert.ok(!h.banned.has('weapon:traps'));
		assert.ok(h.weapons.has('traps'));
	} finally { restore(); }
});

test('#24: a reroll rejected after an outpost reward refreshed the offer keeps revealed cards and focus', async () => {
	const { ui, Game, box, advance, restore } = await harness();
	try {
		const { r, h, last, lvl } = encounter();
		const sent = [];
		r.send = (pid, msg) => sent.push({ pid, msg: structuredClone(msg) });
		r.sendOffer(h);
		const { game, input, outbox, deliver } = wire(ui, Game, r, sent, h.pid);
		deliver();
		const first = game.offer, n = first.choices.length;
		advance(600 * n + 1);
		assert.ok(first.choices.every((_, i) => ui.cardReady(i)), 'all chest cards revealed');
		box.children[1].querySelectorAll('button, select')[0].focus();
		const rerolls = h.rerolls;
		assert.ok(rerolls > 0);

		input.onReroll(); // reroll@epoch1 is still on its way to the server
		const stale = outbox.at(-1);
		assert.equal(stale.t, 'reroll'); assert.equal(stale.offerEpoch, first.offerEpoch);
		fixed(0, () => r.killEnemy(last, h)); // meanwhile the ally clears the last outpost: Иней III→IV, epoch 2
		const [bg] = deliver();
		assert.notEqual(bg.offerEpoch, first.offerEpoch); assert.equal(bg.choices[0].level, 4); assert.equal(bg.rerolled, undefined);
		assert.equal(bg.rerolls, rerolls + 1, 'the reward adds a reroll');

		r.handle(h.pid, stale);
		const reply = deliver();
		assert.equal(reply.length, 1, 'the server answers the stale reroll with the current offer');
		assert.equal(reply[0].offerEpoch, bg.offerEpoch); assert.equal(reply[0].rerolled, undefined);
		assert.equal(h.rerolls, rerolls + 1, 'the rejected reroll costs nothing');
		assert.deepEqual(h.offer.map(c => c.id), bg.choices.map(c => c.id), 'the cards did not change');

		assert.equal(box.children.filter((w) => w.classes.has('card-veil')).length, 0, 'no card is hidden again');
		assert.ok(bg.choices.every((_, i) => ui.cardReady(i)), 'every card stays selectable');
		assert.equal(document.activeElement, box.children[1].querySelectorAll('button, select')[0], 'focus stays on the same card');
		assert.equal(game.offer.offerEpoch, bg.offerEpoch);
	} finally { restore(); }
});

test('#24: a reroll the server accepted is a new draw even when the same cards come back', async () => {
	const { ui, Game, box, advance, restore } = await harness();
	try {
		const { r, h } = encounter();
		const sent = [];
		r.send = (pid, msg) => sent.push({ pid, msg: structuredClone(msg) });
		r.sendOffer(h);
		const { game, input, outbox, deliver } = wire(ui, Game, r, sent, h.pid);
		deliver();
		const n = game.offer.choices.length;
		advance(600 * n + 1);
		assert.equal(box.children.filter((w) => w.classes.has('card-veil')).length, 0);
		ui.setBanMode(true);

		const rerolls = h.rerolls;
		const same = h.offer.map(c => ({ ...c }));
		r.makeChoices = () => same.map(c => ({ ...c })); // the reroll deals exactly the same cards
		input.onReroll();
		assert.equal(ui.banMode, false, 'pressing reroll leaves «Изгнать»');
		r.handle(h.pid, outbox.at(-1));
		const [reply] = deliver();
		assert.equal(reply.rerolled, true); assert.equal(h.rerolls, rerolls - 1);
		assert.deepEqual(reply.choices, game.offer.choices);
		assert.equal(box.children.filter((w) => w.classes.has('card-veil')).length, n, 'chest cards are dealt face down again');
		advance(600 * n + 1);
		assert.ok(reply.choices.every((_, i) => ui.cardReady(i)));
	} finally { restore(); }
});
