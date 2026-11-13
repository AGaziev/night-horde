import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { guardKilled } from './outposts.js';

function fixed(value, action) { const old = Math.random; Math.random = () => value; try { return action(); } finally { Math.random = old; } }

// Clears the whole outpost network except its very last guard; the open offer holds both Кузня cards.
function encounter() {
	const sent = [], r = new Room('FORGE-LOG', (pid, msg) => sent.push({ pid, msg: structuredClone(msg) }));
	r.addPlayer(1, 'One', 'knight'); r.start();
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
	assert.equal(r.outposts.status, 'active'); assert.ok(last && !last.dead);
	h.weapons = new Map([['frost', { lvl: 3, t: 0 }], ['sickle', { lvl: 3, t: 0 }]]); h.passives.clear();
	h.forgeUsed = false; h.forgeDefer = 0;
	r.recalcMods(h); r.updateCombos(h);
	h.offer = r.makeChoices(h); r.sendOffer(h); h.queue = 1;
	assert.deepEqual([h.offer[0].kind, h.offer[0].id, h.offer[0].level], ['imprint', 'frost', 3]);
	const old = sent.findLast(x => x.pid === h.pid && x.msg.t === 'lvl').msg;
	return { r, h, last, sent, old };
}
const lastPick = (r, h) => r.runLog.p.get(h.pid).picks.at(-1);

test('#24: the outpost reward raises Иней III→IV under an open Кузня card, the pick log keeps IV', () => {
	const { r, h, last, sent, old } = encounter();
	fixed(0, () => r.killEnemy(last, h));
	assert.deepEqual([h.lastReforge.result.id, h.lastReforge.result.from, h.lastReforge.result.to], ['frost', 3, 4]);
	assert.equal(h.offer[0].level, 4, 'the carrier card follows the applied upgrade');
	const others = (cards) => cards.slice(1).filter(c => !(c.kind === 'weapon' && c.id === 'frost'));
	assert.deepEqual(others(h.offer), others(old.choices), 'cards of other items are untouched');
	assert.notEqual(h.offerEpoch, old.offerEpoch, 'the changed card gets a new epoch');
	const fresh = sent.findLast(x => x.pid === h.pid && x.msg.t === 'lvl').msg;
	assert.equal(fresh.choices[0].level, 4);

	const picks = r.runLog.p.get(h.pid).picks.length;
	r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: old.offerEpoch });
	assert.equal(r.runLog.p.get(h.pid).picks.length, picks, 'the stale III card is rejected before the log');
	assert.ok(!h.weapons.get('frost').imprint);

	r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: h.offerEpoch });
	assert.equal(h.weapons.get('frost').imprint, 'sickle');
	assert.equal(h.weapons.get('frost').lvl, 4);
	assert.deepEqual(lastPick(r, h).slice(2, 6), ['pick', 'frost', 'imprint', 4], 'the log names the level the imprint was applied to');
});

test('#24: a repeated outpost reward and a reconnect do not duplicate the reforge', () => {
	const { r, h, last, sent } = encounter();
	fixed(0, () => r.killEnemy(last, h));
	const log = r.runLog.p.get(h.pid);
	const snapshot = () => ({ lvl: h.weapons.get('frost').lvl, rerolls: h.rerolls, reforges: structuredClone(log.reforges),
		offer: structuredClone(h.offer), epoch: h.offerEpoch, banner: h.victoryBanner });
	const before = snapshot();
	assert.equal(log.reforges.length, 1);

	fixed(0, () => { r.killEnemy(last, h); guardKilled(r, last); });
	assert.deepEqual(snapshot(), before, 'the final guard counts once');

	const reforges = sent.filter(x => x.pid === h.pid && x.msg.t === 'reforge').length;
	r.resync(h.pid);
	const resent = sent.filter(x => x.pid === h.pid && x.msg.t === 'reforge');
	assert.equal(resent.length, reforges + 1, 'the last result is repeated for the client');
	assert.deepEqual(resent.at(-1).msg, h.lastReforge);
	assert.deepEqual(snapshot(), before, 'repeating the message applies nothing');

	const epoch = h.offerEpoch;
	r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: epoch });
	r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: epoch });
	assert.equal(log.picks.filter(e => e[2] === 'pick' && e[4] === 'imprint').length, 1, 'one imprint pick in the log');
	assert.equal(log.reforges.length, 1);
	assert.equal(h.weapons.get('frost').lvl, 4);
});

function arena(weapons) {
	const r = new Room('FORGE-COMBAT', () => {});
	r.addPlayer(1, 'P1', 'knight'); r.start();
	r.time = 100; r.enemies.length = 0;
	const h = r.heroes.get(1);
	h.x = h.y = 0;
	h.weapons = new Map(weapons.map(([id, lvl]) => [id, { lvl, t: 0 }]));
	h.passives = new Map();
	r.recalcMods(h);
	return { r, h };
}
function foe(r, x, y, hp = 1e6) {
	const e = r.spawnEnemy('brute', [...r.heroes.values()], 1);
	Object.assign(e, { x, y, hp, maxHp: hp });
	r.rebuildGrid();
	return e;
}

test('#24: Морозный след — the returning Серп lays a slowing trail that slows an enemy in combat', () => {
	const { r, h } = arena([['sickle', 3], ['frost', 3]]);
	assert.ok(r.imprint(h, { id: 'sickle', donor: 'frost' }));
	const target = foe(r, 120, 0);
	r.updateWeapon(h, 'sickle', h.weapons.get('sickle'), 0.05);
	const discs = r.projectiles.filter(p => p.trail);
	assert.ok(discs.length > 0 && discs.every(p => p.returnTrail));
	const trail = () => r.puddles.filter(z => z.hidden && z.slow > 0);
	let outbound = 0;
	for (let i = 0; i < 300 && discs.some(p => p.outT > 0); i++) { r.updateProjectiles(1 / 30); outbound = trail().length; }
	assert.equal(outbound, 0, 'no trail on the way out');
	for (let i = 0; i < 30; i++) r.updateProjectiles(1 / 30);
	const zones = trail();
	assert.ok(zones.length > 0, 'the way back leaves trail patches');
	assert.ok(r.fx.some(([fx]) => fx === 'buildring'), 'the trail is visible to clients');

	// An ordinary enemy walking through a patch is slowed by the trail itself.
	const z = zones[0], walker = foe(r, z.x, z.y);
	walker.slow = 0; walker.slowT = 0; target.x = 5000;
	r.rebuildGrid();
	r.updatePuddles(1 / 30);
	assert.ok(walker.slowT > r.time && walker.slow >= 0.3, `slowed by the trail: slow ${walker.slow}, until ${walker.slowT}`);

	// Without the imprint the same throw leaves nothing.
	const plain = arena([['sickle', 3]]);
	foe(plain.r, 120, 0);
	plain.r.updateWeapon(plain.h, 'sickle', plain.h.weapons.get('sickle'), 0.05);
	for (let i = 0; i < 120; i++) plain.r.updateProjectiles(1 / 30);
	assert.equal(plain.r.puddles.filter(z2 => z2.hidden).length, 0);
});

test('#24: Ливень — the first Гроза strike leaves a puddle, the next strike conducts through it', () => {
	const { r, h } = arena([['lightning', 3], ['flask', 3]]);
	assert.ok(r.imprint(h, { id: 'lightning', donor: 'flask' }));
	const a = foe(r, 60, 0);
	r.updateWeapon(h, 'lightning', h.weapons.get('lightning'), 0.05);
	const puddle = r.puddles.find(z => z.wet && z.owner === h);
	assert.ok(puddle, 'the first strike leaves a puddle');
	assert.ok(Math.hypot(puddle.x - a.x, puddle.y - a.y) < 1, 'under the struck enemy');
	r.updatePuddles(0.05);
	assert.ok(a.wetT > r.time, 'the puddle soaks the enemy');

	const b = foe(r, a.x + puddle.r * 0.5, a.y);
	b.wetT = 0;
	r.updatePuddles(0.55);
	assert.ok(b.wetT > r.time);
	// Count every hit by its source: Гроза and the puddle reach b too, only `r_cond` is the conduction.
	const hits = [], hurt = r.hurtEnemy;
	r.hurtEnemy = function (e, dmg, owner, src) {
		const hp = e.hp, out = hurt.apply(this, arguments);
		hits.push({ e, src: src?.weapon, dealt: hp - e.hp });
		return out;
	};
	const condBefore = h.dmgBy.r_cond ?? 0;
	h.weapons.get('lightning').t = 0;
	r.updateWeapon(h, 'lightning', h.weapons.get('lightning'), 0.05);
	r.hurtEnemy = hurt;
	assert.ok(puddle.condT > r.time, 'a strike on a soaked enemy conducts through the puddle');
	const cond = hits.filter(x => x.src === 'r_cond' && x.dealt > 0);
	assert.ok(cond.length > 0 && cond.every(x => x.e === a || x.e === b), 'the conduction itself damages an enemy in the puddle');
	const struck = hits.find(x => x.src === 'lightning')?.e;
	assert.ok(struck === a || struck === b, 'Гроза strikes one of the two');
	assert.ok(cond.every(x => x.e !== struck), 'the second enemy is reached through the puddle, not by the strike');
	assert.ok(h.dmgBy.r_cond - condBefore > 0, 'conduction damage is booked to the hero');
	assert.equal(Math.round(h.dmgBy.r_cond - condBefore), Math.round(cond.reduce((s2, x) => s2 + x.dealt, 0)));

	// Without the imprint Гроза leaves no puddle.
	const plain = arena([['lightning', 3]]);
	foe(plain.r, 60, 0);
	plain.r.updateWeapon(plain.h, 'lightning', plain.h.weapons.get('lightning'), 0.05);
	assert.equal(plain.r.puddles.length, 0);
});
