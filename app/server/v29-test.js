// v29: a hero short of weapons at 40% of the run is offered new weapons first. node server/v29-test.js
import assert from 'node:assert/strict';
import { Room } from './game.js';
import { GAME_VERSION } from '../public/shared/content.js';

assert.equal(GAME_VERSION, 'v35');

function room(mode = 'night') {
	const r = new Room('V29', () => {});
	r.addPlayer(1, 'P1', 'ranger');
	r.setMode(mode);
	r.start();
	r.enemies.length = 0;
	r.events.next = Infinity;
	const h = r.heroes.get(1);
	h.weapons = new Map([['knives', { lvl: 4, t: 0 }], ['frost', { lvl: 3, t: 0 }]]);
	h.passives = new Map([['crit', 2], ['might', 1]]);
	r.recalcMods(h);
	r.updateCombos(h);
	return { r, h };
}
// Share of offers with a new weapon, and of new weapons before new artifacts, over many offers.
function stats(r, h, n = 400) {
	let withNew = 0, rec = 0, newWFirst = 0, both = 0;
	for (let k = 0; k < n; k++) {
		h.lastOfferNewW = k % 2 === 1; // the old pacing would skip new weapons in every other offer
		const c = r.makeChoices(h);
		// New = not owned yet (a rare card may bring a new weapon at level 2).
		const w = c.findIndex((x) => x.kind === 'weapon' && !h.weapons.has(x.id));
		const p = c.findIndex((x) => x.kind === 'passive' && !h.passives.has(x.id));
		if (w >= 0) withNew++;
		if (c.some((x) => x.rec === 2)) rec++;
		if (w >= 0 && p >= 0) {
			both++;
			if (w < p) newWFirst++;
		}
	}
	return { withNew: withNew / n, rec: rec / n, newWFirst: both ? newWFirst / both : 1 };
}

for (const mode of ['night', 'lunch']) {
	const { r, h } = room(mode);
	const at = 0.4 * r.runLength;
	r.time = at - 5;
	const before = stats(r, h);
	assert.equal(before.rec, 0, `${mode}: before 40% of the run nothing changes`);
	r.time = at + 1;
	const after = stats(r, h);
	assert.equal(after.withNew, 1, `${mode}: short of weapons — a new weapon in every offer (${after.withNew})`);
	assert.ok(after.rec === 1, `${mode}: marked as recommended`);
	assert.ok(after.newWFirst > 0.9, `${mode}: new weapons ahead of new artifacts (${after.newWFirst})`);
	assert.ok(after.withNew > before.withNew, `${mode}: more new weapons than before (${before.withNew} → ${after.withNew})`);
	// Three weapons: the old rules.
	h.weapons.set('bolt', { lvl: 1, t: 0 });
	assert.equal(stats(r, h).rec, 0, `${mode}: three weapons — no push`);
	console.log(`${mode}: new weapon in ${Math.round(before.withNew * 100)}% → ${Math.round(after.withNew * 100)}% of offers after ${Math.round(at)} s`);
}
console.log('v29-test: OK');
