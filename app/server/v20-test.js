// v20 checks: weapon overclocks, banishing a card, embers as the fallback, the boss chest flag, run log fields.
// node server/v20-test.js
import assert from 'node:assert/strict';
import { Room } from './game.js';
import {
	TICK_HZ, WEAPON_IDS, WEAPONS, OVERCLOCKS, weaponLevel, overclockId, MAX_LEVEL, BANS_START, REROLLS_START, EVO_BY_WEAPON, EVOS,
	GAME_VERSION, CHEST_FLOOR, DUO_DEFER_OFFERS,
} from '../public/shared/content.js';
import { PROTO } from './snapshot-codec.js';
import { summarize } from './runlog.js';

const dt = 1 / TICK_HZ;
let sent = [];
function room(heroes = ['knight'], mode = 'night') {
	sent = [];
	const r = new Room('V20', (pid, msg) => sent.push([pid, msg]));
	r.setMode(mode);
	heroes.forEach((hero, i) => r.addPlayer(i + 1, 'P' + (i + 1), hero));
	r.start();
	r.enemies.length = 0;
	r.time = 400;
	r.events.next = Infinity;
	return r;
}
const lastOffer = (pid = 1) => sent.filter(([p, m]) => p === pid && m.t === 'lvl').at(-1)[1];
const kinds = (cards) => cards.map((c) => c.kind);
// Control the independent forge substitution only within a particular offer assertion.
function withRandom(value, fn) {
	const random = Math.random;
	Math.random = () => value;
	try { return fn(); } finally { Math.random = random; }
}
// A hero with full slots: `weapons` at level 5, six maxed artifacts that open no evolution of these weapons.
function setBuild(r, h, weapons, passives = ['crit', 'might', 'haste', 'regen', 'magnet', 'echo'], lvl = MAX_LEVEL) {
	h.weapons = new Map(weapons.map((id) => [id, { lvl, t: 0 }]));
	h.passives = new Map(passives.map((id) => [id, MAX_LEVEL]));
	r.recalcMods(h);
	r.updateCombos(h);
	h.offer = null;
	h.duoDefer = {};
}
// v24: the only six weapons with no duo pair among the 30 duos; orbit is the weapon under test, ward the last slot.
const NO_PAIRS = ['orbit', 'flask', 'sickle', 'traps', 'lantern', 'ward']; // no duo pairs, no evolutions with the artifacts above

assert.equal(GAME_VERSION, 'v35');
assert.equal(PROTO, 27);

// --- table: two variants for each plain weapon, one-line descriptions, stats patched only at level 5 ---
{
	assert.equal(WEAPON_IDS.length, 18);
	const names = new Set();
	for (const id of WEAPON_IDS) {
		assert.equal(OVERCLOCKS[id]?.length, 2, `two overclocks for ${id}`);
		for (const [k, O] of OVERCLOCKS[id].entries()) {
			assert.ok(O.id && O.name && O.desc, `${id} variant ${k + 1} has id, name, desc`);
			assert.ok(O.desc.length <= 90 && !O.desc.includes('\n'), `${id}/${O.id}: one-line description (${O.desc.length})`);
			assert.ok(!names.has(O.name), `unique name ${O.name}`);
			names.add(O.name);
			assert.equal(overclockId(id, k + 1), O.id);
			const L = weaponLevel(id, 5, k + 1);
			for (const v of Object.values(L)) assert.ok(typeof v === 'boolean' || Number.isFinite(v), `${id}/${O.id} stats are numbers`);
		}
		assert.equal(weaponLevel(id, 5, 0), WEAPONS[id].levels[4], 'no overclock: plain stats');
		assert.equal(overclockId(id, 0), null);
	}
	assert.equal(weaponLevel('whip', 5, 1).both, false);
	assert.equal(weaponLevel('orbit', 5, 1).radius, 150);
	console.log('overclock table: OK');
}

// --- offer order: evolution / duo → upgrades → overclocks → embers only when nothing else is left ---
{
	const r = room();
	const h = r.heroes.get(1);
	// Level 4 weapon: no overclock. Level 5 while two or more upgrades are left: the overclock waits.
	setBuild(r, h, NO_PAIRS, undefined, 4);
	for (let k = 0; k < 30; k++) assert.ok(!kinds(r.makeChoices(h)).includes('ovr'), 'no overclock below level 5');
	h.weapons.get('orbit').lvl = 5;
	h.duoDefer = {};
	for (let k = 0; k < 30; k++) assert.ok(!kinds(r.makeChoices(h)).includes('ovr'), 'many upgrades left: the overclock waits');
	// One upgrade left: the pair comes in slots 1–2, the upgrade in slot 3.
	setBuild(r, h, NO_PAIRS);
	for (const [id, w] of h.weapons) if (id !== 'orbit') w.oc = 1;
	h.passives.set('crit', 4);
	let c = withRandom(0.99, () => r.makeChoices(h));
	assert.deepEqual([c[0].kind, c[1].kind, c[0].id, c[1].id, c[0].v, c[1].v], ['ovr', 'ovr', 'orbit', 'orbit', 1, 2], 'both variants as two cards in slots 1–2');
	assert.equal(c[0].name, OVERCLOCKS.orbit[0].name);
	assert.equal(c[0].wName, WEAPONS.orbit.name);
	assert.deepEqual(c.slice(2).map((x) => `${x.kind}:${x.id}`), ['passive:crit'], 'normal branch: slot 3 is the last upgrade');
	c = withRandom(0, () => r.makeChoices(h));
	assert.deepEqual(c.map(x => `${x.kind}:${x.id}`), ['ovr:orbit', 'ovr:orbit', 'rare:forge'], 'rare forge replaces slot 3 while preserving the overclock pair');
	assert.deepEqual(c.slice(0, 2).map(x => x.v), [1, 2]);
	assert.ok(!kinds(c).includes('ember'), 'rare branch cannot introduce fallback embers');
	// Two upgrades left: still waiting.
	h.passives.set('might', 4);
	assert.ok(!kinds(r.makeChoices(h)).includes('ovr'));
	h.passives.set('crit', 5);
	h.passives.set('might', 5);

	// Everything maxed, no overclocks taken: overclocks, never embers.
	setBuild(r, h, NO_PAIRS);
	for (let k = 0; k < 60; k++) {
		c = r.makeChoices(h);
		assert.ok(c.length >= 2 && c.every((x) => x.kind === 'ovr'), `maxed build: overclocks, not ${kinds(c)}`);
	}
	// All six overclocked: now embers, all three.
	for (const w of h.weapons.values()) w.oc = 1;
	assert.deepEqual(kinds(r.makeChoices(h)), ['ember', 'ember', 'ember'], 'nothing left: embers');
	// One upgrade left: it comes alone, no embers next to it.
	h.passives.set('crit', 4);
	c = withRandom(0.99, () => r.makeChoices(h));
	assert.deepEqual(c.map((x) => `${x.kind}:${x.id}`), ['passive:crit'], 'normal branch: one upgrade left, no embers next to it');
	c = withRandom(0, () => r.makeChoices(h));
	assert.deepEqual(c.map(x => `${x.kind}:${x.id}`), ['passive:crit', 'rare:forge'], 'rare branch: last upgradeable artifact keeps the forge eligible');
	assert.ok(!kinds(c).includes('ember'), 'rare forge is not a reason to issue fallback embers');
	// One overclock left: its two cards, no embers.
	h.passives.set('crit', 5);
	delete h.weapons.get('ward').oc;
	h.duoDefer = {};
	c = r.makeChoices(h);
	assert.deepEqual(c.map((x) => `${x.kind}:${x.id}:${x.v}`), ['ovr:ward:1', 'ovr:ward:2']);
	// Low hp: healing joins as the third card.
	h.hp = 1;
	c = r.makeChoices(h);
	assert.deepEqual(kinds(c), ['ovr', 'ovr', 'heal']);
	h.hp = h.maxHp;
	console.log('offer order: OK');
}

// --- the evolution stays wanted: no overclock while its artifact can still be taken or the evolution card is due ---
{
	const r = room();
	const h = r.heroes.get(1);
	// whip → crescent needs «Сила» (might). A free artifact slot: wait.
	h.weapons = new Map([['whip', { lvl: 5, t: 0 }]]);
	h.passives = new Map([['crit', 5], ['mail', 5], ['area', 5]]);
	r.recalcMods(h);
	assert.equal(EVOS[EVO_BY_WEAPON.whip].requires, 'might');
	assert.deepEqual(r.ovrList(h), [], 'artifact slot free: the weapon waits for its evolution');
	// The slot is taken by another artifact: the evolution is out of reach, overclock it.
	h.passives.set('regen', 5);
	h.passives.set('magnet', 5);
	h.passives.set('swift', 5);
	assert.deepEqual(r.ovrList(h), ['whip']);
	// The artifact is owned: the evolution card comes, not the overclock…
	h.passives.delete('regen');
	h.passives.set('might', 1);
	r.recalcMods(h);
	assert.deepEqual(r.ovrList(h), []);
	let c = r.makeChoices(h);
	assert.equal(c[0].kind, 'evo');
	assert.ok(!kinds(c).includes('ovr'));
	// …and once the evolution is declined, the overclock may come.
	h.offer = c;
	r.onSkip(1);
	assert.deepEqual(r.ovrList(h), ['whip'], 'evolution declined: overclock allowed');
	// Banishing the artifact also frees the weapon; so does a coop-only artifact in solo (spear → «Узы»).
	h.passives.delete('might');
	h.duoDefer = {};
	assert.deepEqual(r.ovrList(h), []);
	h.banned.add('passive:might');
	assert.deepEqual(r.ovrList(h), ['whip']);
	h.weapons = new Map([['spear', { lvl: 5, t: 0 }]]);
	assert.equal(EVOS[EVO_BY_WEAPON.spear].requires, 'bond');
	assert.deepEqual(r.ovrList(h), ['spear'], 'solo: «Узы» cannot come, the spear does not wait');
	// v24: a duo partner of level ≥ 3 is owned: wait for the duo (knives + traps → «Растяжка»); a lower partner does not hold it.
	h.weapons = new Map([['knives', { lvl: 5, t: 0 }], ['traps', { lvl: 2, t: 0 }]]);
	h.passives = new Map([['crit', 5], ['mail', 5], ['area', 5], ['regen', 5], ['magnet', 5], ['swift', 5]]);
	h.duoDefer = {};
	r.recalcMods(h);
	assert.ok(r.ovrList(h, true).includes('knives'), 'v24: a partner below level 3 does not hold the overclock');
	h.weapons.get('traps').lvl = 3;
	assert.deepEqual(r.ovrList(h, true).filter((id) => id === 'knives'), [], 'duo partner at level 3 owned: the weapon waits');
	h.weapons.set('thunderslash', { lvl: 1, t: 0 });
	h.weapons.set('orb', { lvl: 1, t: 0 });
	assert.ok(r.ovrList(h, true).includes('knives'), 'both duo slots used: overclock allowed');
	console.log('evolution first: OK');
}

// --- picking: the variant is set once, shows up in the snapshot, a declined pair comes back later ---
{
	const r = room();
	const h = r.heroes.get(1);
	setBuild(r, h, NO_PAIRS);
	r.grantOffer(h);
	let o = lastOffer();
	assert.equal(o.bans, BANS_START);
	assert.equal(o.spin, undefined);
	const id = o.choices[0].id;
	r.handle(1, { t: 'pick', i: 1 });
	assert.equal(h.weapons.get(id).oc, 2, 'variant 2 taken');
	assert.ok(r.fx.some((f) => f[0] === 'ovr' && f[1] === 1 && f[2] === id && f[3] === 2), 'fx ovr');
	const snap = r.snapshot();
	const row = snap.p[0][12].find((w) => w[0] === id);
	assert.deepEqual(row, [id, 5, h.mods.amount, 2], 'snapshot: [id, lvl, amount, variant]');
	assert.ok(!r.ovrList(h, true).includes(id), 'one overclock per weapon');
	assert.equal(r.overclock(h, { id, v: 1 }), false, 'cannot overclock twice');
	// Skip: the pair of that weapon is deferred for DUO_DEFER_OFFERS offers while others exist.
	r.grantOffer(h);
	o = lastOffer();
	const skipped = o.choices[0].id;
	r.handle(1, { t: 'skip' });
	assert.ok(h.duoDefer['ovr:' + skipped] > h.offerNo);
	const next = h.offer ?? r.makeChoices(h); // the skip xp may have opened the next offer already
	assert.ok(next[0].kind === 'ovr' && next[0].id !== skipped, 'another weapon is offered after a refusal');
	assert.ok(DUO_DEFER_OFFERS >= 1);
	// Taking variant 1 of a pair does not defer anything.
	h.offer = next;
	r.handle(1, { t: 'pick', i: 0 });
	assert.equal(h.duoDefer['ovr:' + next[0].id], undefined);
	// Log.
	const log = r.runLog.build(r, false);
	const p = log.team[0];
	assert.equal(p.ovr.took.length, 2);
	assert.equal(p.ovr.took[0][1], `${id}~2`);
	assert.ok(p.ovr.seen >= 3, `offered overclocks counted per weapon: ${p.ovr.seen}`);
	assert.deepEqual(p.build.ovr.sort(), [`${id}~2`, `${next[0].id}~1`].sort());
	assert.ok(p.picks.some((e) => e[2] === 'pick' && e[4] === 'ovr' && e[3] === `${id}~2`));
	assert.ok(summarize(log).some((l) => l.includes('разгоны: предложено') && l.includes('взято 2')), 'summary line');
	console.log('overclock pick + log: OK');
}

// --- merging: a duo or an evolution drops the overclock, the card says so; the overclock never blocks them ---
{
	const r = room();
	const h = r.heroes.get(1);
	h.weapons = new Map([['knives', { lvl: 5, t: 0, oc: 2 }], ['traps', { lvl: 3, t: 0 }]]);
	h.passives = new Map();
	r.recalcMods(h);
	let c = r.makeChoices(h);
	assert.equal(c[0].kind, 'duo', 'an overclocked weapon still fuses');
	assert.deepEqual(c[0].loseOvr, [OVERCLOCKS.knives[1].name]);
	h.offer = c;
	r.handle(1, { t: 'pick', i: 0 });
	assert.ok(h.weapons.has('tripwire') && !h.weapons.get('tripwire').oc && !h.weapons.has('knives'));
	assert.ok(!r.ovrList(h, true).length, 'duos are not overclocked');
	// Evolution.
	h.weapons = new Map([['whip', { lvl: 5, t: 0, oc: 1 }]]);
	h.passives = new Map([['might', 1]]);
	h.duoDefer = {};
	r.recalcMods(h);
	c = r.makeChoices(h);
	assert.equal(c[0].kind, 'evo', 'an overclocked weapon still evolves');
	assert.deepEqual(c[0].loseOvr, [OVERCLOCKS.whip[0].name]);
	h.offer = c;
	r.handle(1, { t: 'pick', i: 0 });
	assert.ok(h.weapons.has('crescent') && !h.weapons.get('crescent').oc);
	assert.ok(!r.ovrList(h, true).length, 'evolutions are not overclocked');
	// A plain card carries no loseOvr.
	h.weapons = new Map([['whip', { lvl: 5, t: 0 }]]);
	h.passives = new Map([['might', 1]]);
	h.evolved.clear();
	h.duoDefer = {};
	assert.equal(r.makeChoices(h)[0].loseOvr, undefined);
	console.log('merge drops the overclock: OK');
}

// --- banishing ---
{
	const r = room();
	const h = r.heroes.get(1);
	assert.equal(h.bans, BANS_START);
	assert.equal(BANS_START, 2);
	r.grantOffer(h);
	let o = lastOffer();
	const target = o.choices.findIndex((c) => (c.kind === 'weapon' && WEAPONS[c.id]) || c.kind === 'passive');
	assert.ok(target >= 0);
	const card = o.choices[target];
	const rerolls = h.rerolls;
	r.handle(1, { t: 'ban', i: target });
	assert.equal(h.bans, 1, 'a charge is spent');
	assert.equal(h.rerolls, rerolls, 'the rebuilt offer is free');
	assert.ok(h.banned.has(`${card.kind}:${card.id}`));
	o = lastOffer();
	assert.equal(o.bans, 1);
	for (let k = 0; k < 200; k++) {
		for (const c of r.makeChoices(h, true)) assert.ok(!(c.kind === card.kind && c.id === card.id), 'a banished card never returns');
	}
	// Not banishable: duo, evolution, healing, embers, «Кузня удачи»; a wrong index; no charges.
	for (const kind of ['duo', 'evo', 'heal', 'ember', 'rare']) {
		h.offer = [{ id: 'x', kind, level: 1 }];
		r.handle(1, { t: 'ban', i: 0 });
		assert.equal(h.bans, 1, `${kind} cannot be banished`);
	}
	h.offer = r.makeChoices(h);
	for (const i of [-1, 3, 1.5, 'a', null]) r.handle(1, { t: 'ban', i });
	assert.equal(h.bans, 1);
	// The feather gives a reroll and a banish charge.
	const alive = [...r.heroes.values()];
	r.useItem(h, { type: 5, x: h.x, y: h.y }, alive);
	assert.equal(h.bans, 2, 'feather: +1 banish');
	assert.equal(h.rerolls, REROLLS_START + 1, 'feather: +1 reroll');
	// An overclock variant: the other one stays and comes alone.
	setBuild(r, h, NO_PAIRS);
	for (const [id, w] of h.weapons) if (id !== 'orbit') w.oc = 1;
	h.banned.clear();
	h.offer = r.makeChoices(h);
	assert.deepEqual(kinds(h.offer), ['ovr', 'ovr']);
	r.handle(1, { t: 'ban', i: 0 });
	assert.ok(h.banned.has('ovr:orbit:1'));
	assert.deepEqual(h.offer.map((c) => `${c.kind}:${c.id}:${c.v}`), ['ovr:orbit:2'], 'the other variant stays');
	r.handle(1, { t: 'ban', i: 0 });
	assert.equal(h.bans, 0);
	assert.deepEqual(kinds(h.offer), ['ember', 'ember', 'ember'], 'both variants banished: embers');
	r.handle(1, { t: 'ban', i: 0 });
	assert.equal(h.bans, 0, 'no charges left');
	// Banishing the artifact an evolution needs keeps the artifact out of the pool.
	const log = r.runLog.build(r, false).team[0];
	assert.equal(log.bans.length, 3);
	assert.ok(log.picks.filter((e) => e[2] === 'ban').length === 3);
	assert.equal(log.bans[1][1], 'orbit~1');
	console.log('banish: OK');
}

// --- boss chest: the offer carries `spin`, a reroll or a banish of it does not spin again; a pair is not stopped ---
{
	const r = room(['knight', 'witch']);
	const [a, b] = [r.heroes.get(1), r.heroes.get(2)];
	r.grantOffer(a, false, CHEST_FLOOR.boss, true);
	assert.equal(lastOffer(1).spin, 1, 'boss chest offer spins');
	assert.ok(!r.frozen, 'a group keeps fighting during the chest');
	const t0 = r.time;
	for (let i = 0; i < TICK_HZ; i++) r.tick(dt);
	assert.ok(r.time > t0 + 0.9, 'time runs while the chest is open in a group');
	r.handle(1, { t: 'reroll' });
	assert.equal(lastOffer(1).spin, undefined, 'a reroll shows the cards at once');
	// A queued chest keeps its spin for its own offer.
	r.grantOffer(b);
	r.grantOffer(b, false, CHEST_FLOOR.boss, true);
	assert.equal(lastOffer(2).spin, undefined);
	r.handle(2, { t: 'skip' });
	assert.equal(lastOffer(2).spin, 1, 'the queued chest spins when its turn comes');
	// A real boss kill grants spinning offers to everyone.
	sent.length = 0;
	const boss = r.spawnBoss('brood', [a, b]);
	const e = r.bosses[0];
	assert.ok(e);
	a.offer = b.offer = null;
	a.queue = b.queue = 0;
	a.spinQueue = b.spinQueue = 0;
	r.killEnemy(e, a);
	assert.equal(lastOffer(1).spin, 1);
	assert.equal(lastOffer(2).spin, 1);
	void boss;
	console.log('boss chest spin: OK');
}

// --- embers: totals are sent for the HUD; numbers unchanged ---
{
	const r = room();
	const h = r.heroes.get(1);
	setBuild(r, h, NO_PAIRS);
	for (const w of h.weapons.values()) w.oc = 1;
	r.grantOffer(h);
	const dmg0 = h.mods.dmgMul;
	r.handle(1, { t: 'pick', i: 0 });
	const emb = sent.filter(([, m]) => m.t === 'emb').at(-1)[1];
	assert.deepEqual(emb.e, { ember_dmg: 1 });
	assert.ok(Math.abs(h.mods.dmgMul - dmg0 - 0.05) < 1e-9, 'ember numbers are the same');
	r.resync(1);
	assert.deepEqual(sent.filter(([, m]) => m.t === 'emb').at(-1)[1].e, { ember_dmg: 1 }, 'resync resends the totals');
	console.log('embers HUD message: OK');
}

// --- log: slots filled time and the ember share of the last third ---
{
	const r = room();
	const h = r.heroes.get(1);
	setBuild(r, h, NO_PAIRS.slice(0, 5), ['crit', 'might', 'haste', 'magnet', 'echo']);
	for (const w of h.weapons.values()) w.oc = 1;
	h.weapons.get('orbit').lvl = 4;
	delete h.weapons.get('orbit').oc;
	r.time = 500;
	h.offer = [{ id: 'ward', kind: 'weapon', level: 1, add: 1 }];
	r.handle(1, { t: 'pick', i: 0 });
	assert.equal(r.runLog.p.get(1).slotsFullT, null, 'artifact slot still free');
	r.time = 520;
	h.offer = [{ id: 'regen', kind: 'passive', level: 1 }];
	r.handle(1, { t: 'pick', i: 0 });
	assert.equal(r.runLog.p.get(1).slotsFullT, 520);
	// Last third (from 600 of 900): one upgrade and two embers.
	r.time = 650;
	h.offer = [{ id: 'orbit', kind: 'weapon', level: 5, add: 1 }];
	r.handle(1, { t: 'pick', i: 0 });
	for (const t of [700, 800]) {
		r.time = t;
		h.offer = r.emberCards(h, 3);
		r.handle(1, { t: 'pick', i: 0 });
	}
	const p = r.runLog.build(r, false).team[0];
	assert.equal(p.slotsFullAt, 520);
	assert.deepEqual(p.late, { picks: 3, embers: 2, emberShare: 67 });
	console.log('log: slots and ember share: OK');
}

// --- every overclock fights: no crashes, damage is dealt, behaviour differs from the plain weapon ---
function fight(id, oc, seconds = 12) {
	const r = room();
	const h = r.heroes.get(1);
	h.weapons = new Map([[id, { lvl: 5, t: 0.1, oc }]]);
	h.passives = new Map();
	r.recalcMods(h);
	r.time = 300;
	const seen = { shots: 0, traps3: 0, maxPuddleR: 0, maxTraps: 0, fx: new Set(), big: 0, back: 0 };
	for (let i = 0; i < seconds * TICK_HZ; i++) {
		// Keep a ring of enemies around the hero, the hero walks right and never dies.
		while (r.enemies.filter((e) => !e.dead).length < 40) {
			const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 200;
			const e = r.spawnEnemy('ghoul', [h], 1);
			e.x = h.x + Math.cos(a) * d;
			e.y = h.y + Math.sin(a) * d;
		}
		h.hp = h.maxHp;
		h.iframes = 1;
		// A level-up offer would freeze the solo run: drop it.
		if (h.offer) {
			h.offer = null;
			h.queue = 0;
			r.updateFrozen();
		}
		r.handle(1, { t: 'pos', x: h.x + 3, y: h.y, fx: 1, fy: 0 });
		sent.length = 0;
		r.tick(dt);
		// fx leave with the snapshot (every third tick).
		for (const f of sent.filter(([, m]) => m.t === 's').flatMap(([, m]) => m.fx)) {
			seen.fx.add(f[0]);
			if (f[0] === 'shot') {
				seen.shots++;
				if (f.length === 13) seen.big++;
				if (f.length === 12) seen.back++;
			}
		}
		for (const z of r.puddles) seen.maxPuddleR = Math.max(seen.maxPuddleR, z.r);
		seen.traps3 = Math.max(seen.traps3, r.traps.filter((t) => t.kind === 3).length);
		seen.maxTraps = Math.max(seen.maxTraps, r.traps.filter((t) => t.kind === 0).length);
	}
	// An offer granted on the last tick would freeze the solo run: only the game time matters here.
	assert.ok(r.time > 300 + seconds - 2, `the fight ran: ${r.time.toFixed(1)}`);
	return { dmg: Object.values(h.dmgBy).reduce((a, b) => a + b, 0), seen, h, r };
}
{
	for (const id of WEAPON_IDS) {
		const base = fight(id, 0);
		for (const oc of [1, 2]) {
			const f = fight(id, oc);
			const name = `${id}/${OVERCLOCKS[id][oc - 1].id}`;
			if (id !== 'ward') assert.ok(f.dmg > 0, `${name} deals damage`);
			assert.ok(base.dmg >= 0);
			assert.equal(f.h.weapons.get(id).oc, oc);
		}
	}
	// Visible differences, weapon by weapon.
	assert.equal(fight('bolt', 1).seen.big > 0, true, 'ball: big projectile flag in the shot event');
	assert.ok(fight('bolt', 2).seen.shots > fight('bolt', 0).seen.shots * 1.5, 'ring: twice the sparks');
	assert.ok(fight('knives', 1).seen.shots > fight('knives', 0).seen.shots * 1.3, 'fan: more knives');
	assert.ok(fight('knives', 2).seen.fx.has('ptgt'), 'ricochet: knives retarget');
	assert.ok(fight('aura', 1).seen.fx.has('apulse') && !fight('aura', 0).seen.fx.has('apulse'), 'pulse fx');
	assert.ok(fight('flask', 1).seen.maxPuddleR > fight('flask', 0).seen.maxPuddleR * 1.5, 'lake: one big puddle');
	assert.ok(fight('traps', 1).seen.traps3 > 0 && fight('traps', 0).seen.traps3 === 0, 'shards: spikes around a sprung trap');
	assert.ok(fight('spear', 2).seen.traps3 > 0, 'caltrop: spikes along the flight');
	assert.ok(fight('spear', 1).seen.back > 0 && fight('spear', 0).seen.back === 0, 'back: the spear returns');
	assert.ok(fight('trail', 1).seen.maxPuddleR > fight('trail', 0).seen.maxPuddleR * 1.4, 'wide trail');
	assert.ok(fight('bomb', 1).seen.fx.has('boom'));
	// Ward: «Быстрый щит» has one charge, «Отдача» two and bursts on every absorbed hit.
	const q = fight('ward', 2, 2);
	assert.equal(q.h.wardMax, 1);
	const th = fight('ward', 1, 2);
	assert.equal(th.h.wardMax, 2);
	th.h.ward = 2;
	th.r.fx = [];
	th.r.wardAbsorb(th.h);
	assert.ok(th.r.fx.some((f) => f[0] === 'boom'), 'thorns: burst with a charge left');
	const plain = fight('ward', 0, 2);
	plain.h.ward = 3;
	plain.r.fx = [];
	plain.r.wardAbsorb(plain.h);
	assert.ok(plain.r.fx.some((f) => f[0] === 'boom'), 'plain ward answers every block');
	assert.equal(weaponLevel('ward', 5, 1).burstDmg, weaponLevel('ward', 5).burstDmg * 2, 'thorns doubles the answer instead of unlocking the base behavior');
	// Taking an overclock on a full ward trims the charges.
	const w = fight('ward', 0, 2);
	w.h.ward = 3;
	w.r.overclock(w.h, { id: 'ward', v: 2 });
	assert.equal(w.h.ward, 1);
	console.log('all overclocks fight: OK');
}

console.log('v20-test: OK');
