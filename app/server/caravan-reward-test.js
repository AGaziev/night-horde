import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { CARAVAN, updateCaravan, claimCaravan, caravanGuardKilled, closeCaravan } from './caravans.js';
import { passiveStep, passiveValue, RARITIES, xpForNext } from '../public/shared/content.js';

function fixed(value, action) { const old = Math.random; Math.random = () => value; try { return action(); } finally { Math.random = old; } }
function encounter(n = 2, mode = 'night') {
	const sent = [], r = new Room('CARAVAN-REWARD', (pid, msg) => sent.push({ pid, msg: structuredClone(msg) }));
	r.setMode(mode); for (let i = 1; i <= n; i++) r.addPlayer(i, `P${i}`, 'knight'); r.start();
	r.time = r.runLength * CARAVAN.from; const hs = [...r.heroes.values()]; fixed(0, () => updateCaravan(r, hs, 0));
	return { r, hs, sent, c: r.caravan };
}
function clear(r, h) {
	for (const e of r.enemies.filter(e => e.caravan)) r.hurtEnemy(e, 1e9, h, { weapon: 'other', raw: true });
	assert.equal(r.caravan.killed, r.caravan.total); assert.equal(r.caravan.status, 'open');
}
function touch(r, h) { h.x = r.caravan.x; h.y = r.caravan.y; updateCaravan(r, [h], 0); }
function resources(r, h) { return { weapons: structuredClone([...h.weapons]), passives: [...h.passives], values: { ...h.pval },
	xp: h.xp, hp: h.hp, level: h.level, rerolls: h.rerolls, queue: h.queue, picks: structuredClone(r.runLog.p.get(h.pid).picks),
	reforges: structuredClone(r.runLog.p.get(h.pid).reforges), receipt: structuredClone(h.lastReforge) }; }

test('caravan: native team reward once, both modes and 1–8 participants, including a downed recipient', () => {
	for (const mode of ['lunch', 'night']) for (let n = 1; n <= 8; n++) {
		const { r, hs, sent, c } = encounter(n, mode);
		for (const h of hs) { h.weapons = new Map([['whip', { lvl: 3, t: 0 }]]); h.passives.clear(); h.level = 15; h.xp = 0; r.recalcMods(h); h.hp = h.maxHp / 2; }
		if (n > 1) { hs[1].st = 1; hs[1].hp = 0; }
		assert.equal(claimCaravan(r), false, 'a living guard blocks all reward effects'); clear(r, hs[0]);
		let calls = 0; const reforge = r.legendaryReforge;
		r.legendaryReforge = function(...args) { calls++; assert.equal(c.status, 'claimed'); assert.equal(claimCaravan(r), false, 'claim flag precedes any reward callback'); return reforge.apply(this, args); };
		const rerolls = hs.map(h => h.rerolls), threshold = xpForNext(15, n);
		touch(r, hs[0]); assert.equal(c.status, 'claimed'); assert.equal(calls, n);
		for (const [i, h] of hs.entries()) {
			assert.equal(h.weapons.get('whip').lvl, 4); assert.equal(h.rerolls, rerolls[i] + 1); assert.equal(h.xp, threshold * .25);
			assert.equal(h.hp, i === 1 ? 0 : h.maxHp * .7); if (i === 1) assert.equal(h.st, 1);
			assert.equal(h.lastReforge.source, 'caravan'); assert.equal(h.lastReforge.result.from, 3); assert.equal(h.lastReforge.result.to, 4);
			assert.equal(r.runLog.p.get(h.pid).reforges.length, 1); assert.equal(r.runLog.p.get(h.pid).reforges[0].source, 'caravan');
			assert.ok(!h.victoryBanner && !h.forgeUsed);
		}
		const before = hs.map(h => resources(r, h));
		for (const e of r.enemies) caravanGuardKilled(r, e);
		touch(r, hs[0]); closeCaravan(r); r.time = c.expires; updateCaravan(r, hs, 0);
		for (const h of hs) r.resync(h.pid);
		assert.deepEqual(hs.map(h => resources(r, h)), before);
		for (const h of hs) assert.deepEqual(sent.findLast(x => x.pid === h.pid && x.msg.t === 'reforge').msg, h.lastReforge);
	}
});

test('caravan: artifact receives the native legendary step, preserving accumulated value and downed HP', () => {
	for (const id of ['might', 'vigor']) for (const downed of [false, true]) {
		const { r, hs } = encounter(), [h, opener] = hs; clear(r, opener);
		h.weapons = new Map([['whip', { lvl: 5, t: 0 }]]); h.passives = new Map([[id, 2], ['echo', 1]]); h.pval = { [id]: .123 };
		r.recalcMods(h); h.hp = h.maxHp / 2; if (downed) { h.st = 1; h.hp = 0; }
		fixed(0, () => touch(r, opener));
		assert.equal(RARITIES[3].mul, 3.5); assert.equal(h.passives.get(id), 3); assert.equal(h.pval[id], .123 + passiveStep(id, 3));
		assert.equal(h.passives.get('echo'), 1); assert.equal(h.lastReforge.result.rar, 3); assert.equal(h.lastReforge.result.val, passiveStep(id, 3));
		if (downed) { assert.equal(h.hp, 0); assert.equal(h.st, 1); }
	}
});

test('caravan: max/noRarity pool grants one visible logged reroll, refreshes open resources, and survives resync', () => {
	const { r, hs, sent } = encounter(), [h] = hs; clear(r, h);
	h.weapons = new Map([['whip', { lvl: 5, t: 0 }]]); h.passives = new Map([['might', 5], ['echo', 1], ['coil', 1], ['ashseal', 1]]);
	h.pval = { might: passiveValue('might', 5) }; h.rerolls = 3; r.recalcMods(h); assert.equal(r.reforgePool(h).length, 0);
	r.grantOffer(h); h.queue = 2; const offer = structuredClone(h.offer), epoch = h.offerEpoch;
	touch(r, h); assert.equal(h.rerolls, 4); assert.deepEqual(h.offer, offer); assert.equal(h.offerEpoch, epoch); assert.equal(h.queue, 2);
	assert.deepEqual(h.lastReforge, { t: 'reforge', source: 'caravan', result: null, fallback: { kind: 'reroll', amount: 1 } });
	assert.equal(sent.findLast(x => x.pid === h.pid && x.msg.t === 'lvl').msg.rerolls, 4);
	assert.deepEqual(r.runLog.p.get(h.pid).reforges, [{ at: r.time, source: 'caravan', fallback: 'reroll', amount: 1 }]);
	const log = r.runLog.build(r, false); assert.match(log.summary.join('\n'), /награды каравана:.*\+1 переброс/);
	assert.ok(!log.summary.join('\n').includes('undefined'));
	const before = resources(r, h); r.resync(h.pid); touch(r, h); assert.deepEqual(resources(r, h), before);
	assert.deepEqual(sent.findLast(x => x.pid === h.pid && x.msg.t === 'reforge').msg, h.lastReforge);
});

test('caravan: open duo rebases before XP queues a new offer, old epoch is rejected, fresh fusion uses rewarded levels', () => {
	const { r, hs, sent } = encounter(), [h] = hs; clear(r, h);
	h.weapons = new Map([['bolt', { lvl: 4, t: 0 }], ['orbit', { lvl: 3, t: 0 }]]); h.passives.clear(); h.forgeUsed = true;
	r.recalcMods(h); r.updateCombos(h); fixed(.5, () => r.grantOffer(h));
	assert.equal(h.offer[0].id, 'orrery'); assert.equal(h.offer[0].level, 1);
	h.queue = 2; h.level = 15; h.xp = xpForNext(h.level, 2) * .8; const oldEpoch = h.offerEpoch;
	fixed(0, () => touch(r, h));
	assert.equal(h.weapons.get('bolt').lvl, 5); assert.equal(h.offer[0].id, 'orrery'); assert.equal(h.offer[0].level, 2);
	assert.notEqual(h.offerEpoch, oldEpoch); assert.equal(h.queue, 3); assert.equal(h.level, 16);
	const before = resources(r, h); r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: oldEpoch }); assert.deepEqual(resources(r, h), before);
	r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: h.offerEpoch });
	assert.equal(h.weapons.get('orrery').lvl, 2); assert.deepEqual(h.weapons.get('orrery').parts.map(p => [p.id, p.lvl]), [['bolt', 5], ['orbit', 3]]);
	assert.equal(h.queue, 2); assert.equal(sent.filter(x => x.pid === h.pid && x.msg.t === 'reforge').length, 1);
});

test('caravan: external reward refreshes the native imprint carrier and rejects its stale card identity', () => {
	const { r, hs } = encounter(), [h] = hs; clear(r, h);
	h.weapons = new Map([['frost', { lvl: 3, t: 0 }], ['sickle', { lvl: 3, t: 0 }]]); h.passives.clear(); h.forgeUsed = false; h.forgeDefer = 0;
	r.recalcMods(h); r.updateCombos(h); r.grantOffer(h);
	assert.equal(h.offer[0].kind, 'imprint'); assert.equal(h.offer[0].id, 'frost'); const epoch = h.offerEpoch;
	fixed(0, () => touch(r, h)); assert.equal(h.offer[0].level, 4); assert.notEqual(h.offerEpoch, epoch);
	const before = resources(r, h); r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: epoch }); assert.deepEqual(resources(r, h), before);
	r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: h.offerEpoch }); assert.equal(h.weapons.get('frost').lvl, 4); assert.equal(h.weapons.get('frost').imprint, 'sickle');
});

test('caravan: reaching an expired or finale event cannot grant any partial team reward', () => {
	for (const finale of [false, true]) {
		const { r, hs, c } = encounter(); clear(r, hs[0]);
		const before = hs.map(h => resources(r, h));
		if (finale) r.fin = {}; else r.time = c.expires;
		touch(r, hs[0]); assert.equal(c.status, 'expired'); assert.equal(claimCaravan(r), false);
		assert.deepEqual(hs.map(h => resources(r, h)), before);
	}
});
