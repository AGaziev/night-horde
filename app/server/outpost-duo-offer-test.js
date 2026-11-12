import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';

function fixed(value, action) { const old = Math.random; Math.random = () => value; try { return action(); } finally { Math.random = old; } }
function encounter(level = 4, keepPartCard = false) {
	const sent = [], r = new Room('DUO-REWARD', (pid, msg) => sent.push({ pid, msg: structuredClone(msg) }));
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
	assert.equal(r.outposts.status, 'active'); assert.ok(last && !last.dead);
	h.weapons = new Map([['bolt', { lvl: level, t: 0 }], ['orbit', { lvl: 3, t: 0 }]]); h.passives.clear(); h.forgeUsed = true;
	r.recalcMods(h); r.updateCombos(h); fixed(.5, () => r.grantOffer(h));
	assert.equal(h.offer[0].id, 'orrery'); assert.equal(h.offer[0].level, 1);
	// Retain actual generated cards, isolating the dependent duo from a direct part-upgrade card.
	if (!keepPartCard) { h.offer = h.offer.filter(c => !(c.kind === 'weapon' && c.id === 'bolt')); r.sendOffer(h); }
	h.queue = 2;
	const old = sent.findLast(x => x.pid === h.pid && x.msg.t === 'lvl').msg;
	return { r, h, last, sent, old };
}
function resources(r, h) {
	return { weapons: structuredClone([...h.weapons]), queue: h.queue, rerolls: h.rerolls, bans: h.bans, xp: h.xp,
		picks: structuredClone(r.runLog.p.get(h.pid).picks), fused: [...h.fused], defer: { ...h.duoDefer } };
}

test('4547137368: real final guard reward refreshes an open duo and rejects the queued old pick', () => {
	const { r, h, last, sent, old } = encounter(); const neighbors = structuredClone(h.offer.slice(1));
	fixed(0, () => r.killEnemy(last, h));
	assert.equal(h.lastReforge.result.id, 'bolt'); assert.equal(h.lastReforge.result.to, 5);
	assert.equal(h.offer[0].level, 2, 'Planetarium I becomes II after the actual bolt IV→V reward');
	assert.notEqual(h.offerEpoch, old.offerEpoch); assert.deepEqual(h.offer.slice(1), neighbors);
	const fresh = sent.findLast(x => x.pid === h.pid && x.msg.t === 'lvl').msg;
	assert.equal(fresh.choices[0].level, 2); const before = resources(r, h);
	r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: old.offerEpoch }); assert.deepEqual(resources(r, h), before);
	r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: h.offerEpoch });
	assert.equal(h.weapons.get('orrery').lvl, 2);
	assert.deepEqual(h.weapons.get('orrery').parts.map(p => [p.id, p.lvl]), [['bolt', 5], ['orbit', 3]]);
	assert.equal(h.queue, before.queue - 1); assert.equal(sent.filter(x => x.pid === h.pid && x.msg.t === 'reforge').length, 1);
});
test('4547137368: a part III→IV invalidates the old epoch even while the duo stays level I', () => {
	const { r, h, last, old } = encounter(3);
	fixed(0, () => r.killEnemy(last, h));
	assert.equal(h.weapons.get('bolt').lvl, 4); assert.equal(h.offer[0].level, 1);
	assert.deepEqual(h.offer, old.choices, 'the visible tier/card fields may be identical');
	assert.notEqual(h.offerEpoch, old.offerEpoch, 'the changed part dependency still replaces offer identity');
	const before = resources(r, h); r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: old.offerEpoch });
	assert.deepEqual(resources(r, h), before);
});
test('4547137368: refreshing a duo preserves valid neighbor cards instead of rerolling the whole offer', () => {
	const { r, h, last } = encounter(4, true), neighbor = structuredClone(h.offer.find(c => c.id === 'whip'));
	assert.ok(neighbor); assert.ok(h.offer.some(c => c.kind === 'weapon' && c.id === 'bolt'));
	const make = r.makeChoices; let rebuilds = 0;
	r.makeChoices = function(...args) { rebuilds++; return make.apply(this, args); };
	fixed(0, () => r.killEnemy(last, h));
	assert.equal(rebuilds, 0, 'no random whole-offer regeneration for an affected duo');
	assert.deepEqual(h.offer.find(c => c.id === 'whip'), neighbor, 'native fields and rarity remain unchanged');
	assert.equal(h.offer[0].id, 'orrery'); assert.equal(h.offer[0].level, 2);
	assert.ok(!h.offer.some(c => c.kind === 'weapon' && c.id === 'bolt'), 'only the now-impossible capped upgrade leaves');
});
test('4547137368: a stale duo with the current epoch is refreshed before logging, fusion or queue consumption', () => {
	const { r, h, last } = encounter(); fixed(0, () => r.killEnemy(last, h));
	h.offer[0].level = 1; r.sendOffer(h); const epoch = h.offerEpoch, before = resources(r, h);
	assert.equal(r.fuseDuo(h, h.offer[0]), false, 'the fusion entry point rejects a cached tier too');
	r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: epoch });
	assert.deepEqual(resources(r, h), before); assert.equal(h.offer[0].level, 2); assert.notEqual(h.offerEpoch, epoch);
});
for (const invalid of ['recipe', 'missing', 'imprinted', 'underlevel', 'duplicate', 'duo-cap']) test(`4547137368: ${invalid} current-epoch duo cannot consume a choice`, () => {
	const { r, h } = encounter();
	if (invalid === 'recipe') h.offer[0].parts = ['bolt', 'whip'];
	if (invalid === 'missing') h.weapons.delete('orbit');
	if (invalid === 'imprinted') h.weapons.get('orbit').imprint = 'sickle';
	if (invalid === 'underlevel') h.weapons.get('orbit').lvl = 2;
	if (invalid === 'duplicate') h.weapons.set('orrery', { lvl: 1, t: 0 });
	if (invalid === 'duo-cap') { h.weapons.set('thunderslash', { lvl: 1, t: 0 }); h.weapons.set('icebomb', { lvl: 1, t: 0 }); }
	r.sendOffer(h); const before = resources(r, h);
	assert.equal(r.fuseDuo(h, h.offer[0]), false);
	r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: h.offerEpoch }); assert.deepEqual(resources(r, h), before);
});
