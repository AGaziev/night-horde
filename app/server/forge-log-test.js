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
