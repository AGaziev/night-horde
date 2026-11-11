// DUOS v2 (v24+): the new duos and the affinity of plain weapon pairs. node server/duos2-test.js
import assert from 'node:assert/strict';
import { Room } from './game.js';
import {
	TICK_HZ, DUOS, DUO_BY_PAIR, duoKey, WEAPONS, AFFINITY, AFFINITY_IDS, AFFINITY_WINDOW, ROLES, affinityOf, STATE_SOURCES,
} from '../public/shared/content.js';

const dt = 1 / TICK_HZ;
const sent = [];

// A quiet room: no spawns, bosses, peaks or events; the hero cannot die.
function room() {
	const r = new Room('D2', (pid, msg) => sent.push([pid, msg]));
	r.addPlayer(1, 'P1', 'knight');
	r.start();
	r.enemies.length = 0;
	r.time = 100;
	r.spawn = () => {};
	r.nextEliteT = r.nextInvasionT = Infinity;
	r.peaks = [];
	r.bossAt = [];
	r.events.next = Infinity;
	const h = r.heroes.get(1);
	h.hp = h.maxHp = 1e9;
	h.weapons = new Map();
	return { r, h };
}
function foe(r, x, y, hp = 1e6, type = 'ghoul') {
	const h = r.heroes.get(1);
	const e = r.spawnEnemy(type, [h], 1);
	e.x = x;
	e.y = y;
	e.hp = e.maxHp = hp;
	e.speed = 0;
	e.dmg = 0;
	return e;
}
// The hero walks a small circle (trail-like duos need movement), enemies stand still.
function run(r, h, secs, each) {
	let a = 0;
	for (let i = 0; i < secs * TICK_HZ; i++) {
		a += 2 * dt;
		h.x = Math.cos(a) * 40;
		h.y = Math.sin(a) * 40;
		h.movedT = r.time;
		r.tick(dt);
		each?.(i);
	}
}
const crowd = (r, n = 30) => {
	const out = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2, d = 40 + (i % 5) * 40;
		out.push(foe(r, Math.cos(a) * d, Math.sin(a) * d));
	}
	return out;
};

// --- content: 4 duos per weapon at most, ids unique, every new duo has 3 levels; roles and the affinity table ---
const NEW_A = ['guide', 'sunspear', 'glow', 'dome', 'riposte', 'rod', 'pitch', 'firescythe'];
{
	const per = {};
	for (const D of Object.values(DUOS)) for (const p of D.parts) per[p] = (per[p] ?? 0) + 1;
	for (const id of Object.keys(WEAPONS)) assert.ok(per[id] >= 1 && per[id] <= 4, `${id}: ${per[id]} duos`);
	for (const id of ['lantern', 'trail', 'ward']) assert.ok(per[id] >= 4, `${id} gets its new duos (${per[id]})`);
	for (const id of NEW_A) {
		assert.ok(DUOS[id], id);
		assert.equal(DUOS[id].levels.length, 3, id);
		assert.equal(DUO_BY_PAIR[duoKey(...DUOS[id].parts)], id);
	}
	for (const id of ['glow', 'pitch', 'firescythe']) assert.ok(STATE_SOURCES.burn.includes(id), `${id} burns`);
	for (const W of Object.values(WEAPONS)) assert.ok(ROLES[W.role], `${W.name} has a role`);
	for (const r of Object.keys(ROLES)) assert.equal(Object.values(WEAPONS).filter((W) => W.role === r).length, 5, `five weapons are ${r}`);
	assert.equal(AFFINITY_IDS.length, 6);
	// Every pair of plain weapons has either a duo or an affinity.
	const ids = Object.keys(WEAPONS);
	for (let i = 0; i < ids.length; i++) {
		for (let j = i + 1; j < ids.length; j++) {
			const duo = DUO_BY_PAIR[duoKey(ids[i], ids[j])], aff = affinityOf(ids[i], ids[j]);
			assert.ok(!!duo !== !!aff, `${ids[i]}+${ids[j]}: a duo or an affinity, not both`);
		}
	}
	assert.equal(affinityOf('whip', 'whip'), null);
	assert.equal(affinityOf('whip', 'lightning'), null, 'a duo pair has no affinity');
	assert.equal(affinityOf('whip', 'frost'), 'vise');
	assert.equal(affinityOf('bolt', 'knives'), 'crossfire');
	assert.equal(affinityOf('flask', 'traps'), 'soak');
	assert.equal(affinityOf('bolt', 'whip'), 'recoil');
	assert.equal(affinityOf('whip', 'flask'), 'drag');
	assert.equal(affinityOf('knives', 'lantern'), 'aim');
	console.log('content: OK');
}

// --- every new duo fights alone at every level ---
for (const id of NEW_A) {
	for (let lvl = 1; lvl <= 3; lvl++) {
		const { r, h } = room();
		h.weapons.set(id, { lvl, t: 0.1 });
		crowd(r);
		run(r, h, 4, (i) => { if (i % TICK_HZ === 0) r.hurtPlayer(h, 1, 'test'); });
		assert.ok((h.dmgBy[id] ?? 0) > 0, `${id} ${lvl} deals damage`);
	}
}
console.log('every new duo deals damage: OK');

// --- behaviour of each new duo ---
{
	// Путеводный огонь: sparks fly at marked enemies; a lit marked enemy that dies throws a spark.
	const { r, h } = room();
	h.weapons.set('guide', { lvl: 3, t: 0 });
	const es = crowd(r, 20);
	run(r, h, 1.5);
	assert.ok(es.some((e) => e.markT > r.time), 'the cone marks');
	assert.ok(r.projectiles.some((p) => p.src.weapon === 'guide'), 'sparks fly');
	const lit = es.find((e) => e.markT > r.time && e.lightBy === h);
	assert.ok(lit);
	const n0 = r.projectiles.length;
	r.hurtEnemy(lit, 1e7, h);
	assert.ok(r.projectiles.length > n0, 'a marked enemy dies into a spark');
	console.log('guide: OK');
}
{
	// Солнечное копьё: a lane of light that marks.
	const { r, h } = room();
	h.weapons.set('sunspear', { lvl: 1, t: 0 });
	const big = foe(r, 300, 0, 1e7, 'brute');
	const side = foe(r, 150, 4);
	run(r, h, 1);
	const lanes = r.puddles.filter((z) => z.tag === 'lane');
	assert.ok(lanes.length >= 3, `lane patches: ${lanes.length}`);
	assert.ok(lanes.every((z) => z.mark === DUOS.sunspear.levels[0].mark));
	assert.ok(side.markT > r.time || big.markT > r.time, 'enemies on the lane are marked');
	assert.ok(r.fx.length >= 0);
	console.log('sunspear: OK');
}
{
	// Зарево: the cone burns; a marked burning enemy leaves a burning patch.
	const { r, h } = room();
	h.weapons.set('glow', { lvl: 2, t: 0 });
	const es = crowd(r, 12);
	run(r, h, 1);
	const lit = es.find((e) => e.markT > r.time && e.burnT > r.time);
	assert.ok(lit, 'marked and burning');
	r.hurtEnemy(lit, 1e7, h);
	assert.ok(r.puddles.some((z) => z.tag === 'glowp' && z.burn === 0 && z.dmg > 0), 'a burning patch on the spot');
	console.log('glow: OK');
}
{
	// Купол: a charged dome hits harder and wider; every absorbed hit bursts.
	const { r, h } = room();
	h.weapons.set('dome', { lvl: 1, t: 0 });
	const e = foe(r, 105, 0); // inside the charged radius (100 × 1.15) only
	run(r, h, 1);
	assert.equal(h.ward, 2, 'full shield');
	const charged = h.dmgBy.dome;
	assert.ok(charged > 0, 'the charged dome reaches farther');
	h.x = h.y = 0;
	r.hurtPlayer(h, 50, 'test');
	assert.equal(h.ward, 1);
	assert.equal(h.hp, h.maxHp, 'the hit is eaten');
	assert.ok(r.blasts.length > 0 || r.fx.some((f) => f[0] === 'boom'), 'a burst');
	void e;
	console.log('dome: OK');
}
{
	// Контрудар: swings; an absorbed hit answers with a round swing.
	const { r, h } = room();
	h.weapons.set('riposte', { lvl: 1, t: 0 });
	const e = foe(r, 0, 120); // above the hero: out of the side swings, inside the round answer
	run(r, h, 0.5);
	const before = h.dmgBy.riposte ?? 0;
	h.x = h.y = 0;
	r.fx = [];
	r.hurtPlayer(h, 50, 'test');
	assert.ok(r.fx.some((f) => f[0] === 'crescent'), 'round answer');
	assert.ok((h.dmgBy.riposte ?? 0) > before, 'the answer hits');
	assert.ok(e.hp < e.maxHp);
	console.log('riposte: OK');
}
{
	// Громоотвод: strikes the nearest; an absorbed hit answers with a chained strike.
	const { r, h } = room();
	h.weapons.set('rod', { lvl: 1, t: 0 });
	crowd(r, 10);
	run(r, h, 2);
	const before = h.dmgBy.rod ?? 0;
	assert.ok(before > 0);
	r.fx = [];
	r.hurtPlayer(h, 50, 'test');
	assert.ok(r.fx.filter((f) => f[0] === 'zap').length >= 2, 'counter strike with a chain');
	assert.ok(h.dmgBy.rod > before);
	console.log('rod: OK');
}
{
	// Смола: pools behind a moving hero, they burn and slow; a standing hero leaves nothing.
	const { r, h } = room();
	h.weapons.set('pitch', { lvl: 1, t: 0 });
	const e = foe(r, 40, 0);
	run(r, h, 2);
	const pools = r.puddles.filter((z) => z.tag === 'pitch');
	assert.ok(pools.length > 3 && pools.length <= DUOS.pitch.levels[0].max, `pools: ${pools.length}`);
	assert.ok(pools.every((z) => z.drag >= 0.2 && !z.slow && z.burn > 0), 'a slow that is not cold');
	assert.ok(e.burnT > r.time, 'burns');
	assert.ok(e.dragT > r.time && !(e.steamT > r.time), 'slowed without «Пар»');
	const n = r.puddles.length;
	h.movedT = -10;
	for (let i = 0; i < TICK_HZ; i++) r.tick(dt);
	assert.ok(r.puddles.filter((z) => z.tag === 'pitch').length <= n, 'no new pools while standing');
	console.log('pitch: OK');
}
{
	// Огненный серп: a burning strip along the flight; hits ignite.
	const { r, h } = room();
	h.weapons.set('firescythe', { lvl: 1, t: 0 });
	const e = foe(r, 200, 0);
	run(r, h, 1);
	assert.ok(r.puddles.some((z) => z.tag === 'scythe' && z.burn > 0), 'burning strip');
	assert.ok(e.burnT > r.time, 'the hit ignites');
	console.log('firescythe: OK');
}

// --- affinity ---
const plainSrc = (r, id) => ({ weapon: id, tags: WEAPONS[id].tags }); // same shape as Room SRC
function pair(a, b) {
	const { r, h } = room();
	h.weapons.set(a, { lvl: 3, t: 99 });
	h.weapons.set(b, { lvl: 3, t: 99 });
	h.mods.critChance = 0;
	r.synergy = 0;
	const e = foe(r, 100, 0, 1e7, 'brute');
	return { r, h, e, hit: (id, dmg = 10) => r.hurtEnemy(e, dmg, h, plainSrc(r, id)) };
}
{
	// Тиски: the second hit is stronger; once per second per enemy and pair; a third weapon on its own does nothing.
	const { r, h, hit } = pair('whip', 'frost');
	assert.equal(hit('whip'), 10);
	assert.equal(hit('frost'), 10 * (1 + AFFINITY.vise.mul), 'cross hit +25%');
	assert.equal(hit('whip'), 10, 'cooldown');
	r.time += 1.01;
	assert.equal(hit('frost'), 10 * (1 + AFFINITY.vise.mul), 'again after a second');
	assert.equal(h.affN.vise, 2);
	// The window.
	r.time += 1.01;
	hit('whip');
	r.time += AFFINITY_WINDOW + 0.01;
	assert.equal(hit('frost'), 10, 'too late');
	// Off switch for the bench.
	r.affinityOff = true;
	r.time += 1.01;
	hit('whip');
	assert.equal(hit('frost'), 10, 'affinityOff');
	console.log('vise: OK');
}
{
	// Перекрёстный огонь: the cross hit gets AFFINITY.crossfire.crit more crit chance.
	const { r, h, hit } = pair('bolt', 'knives');
	hit('bolt');
	const rnd = Math.random;
	try {
		Math.random = () => AFFINITY.crossfire.crit - 0.01;
		hit('bolt');
		assert.equal(hit('knives'), 10 * h.mods.critMul, 'the cross hit crits below the added chance');
		assert.equal(hit('knives'), 10, 'no cross hit: no crit (crit chance 0)');
		r.time += 1.01;
		hit('bolt');
		Math.random = () => AFFINITY.crossfire.crit + 0.01;
		assert.equal(hit('knives'), 10, 'above the added chance: no crit');
	} finally {
		Math.random = rnd;
	}
	assert.ok(h.affN.crossfire >= 1);
	console.log('crossfire: OK');
}
{
	// Пропитка: 2 s of +20% from trace weapons of this player.
	const { r, h, e, hit } = pair('flask', 'traps');
	hit('flask');
	assert.equal(hit('traps'), 10 * (1 + AFFINITY.soak.mul));
	assert.ok(e.soakT > r.time);
	r.time += AFFINITY_WINDOW + 0.1; // out of the window, still soaked
	assert.equal(hit('flask'), 10 * (1 + AFFINITY.soak.mul), 'soaked: a trace hit is stronger');
	assert.equal(h.affN.soak, 1);
	console.log('soak: OK');
}
{
	// Отдача: knocked back from the hero and +10%.
	const { e, hit } = pair('bolt', 'whip');
	hit('bolt');
	const x0 = e.x;
	assert.equal(hit('whip'), 10 * (1 + AFFINITY.recoil.mul));
	assert.ok(e.x - x0 >= AFFINITY.recoil.kb * 0.5 - 0.01, 'knocked back');
	console.log('recoil: OK');
}
{
	// Вязкость: a slow that is not cold (no steam with fire).
	const { r, e, hit } = pair('whip', 'flask');
	hit('whip');
	assert.equal(hit('flask'), 10 * (1 + AFFINITY.drag.mul));
	assert.ok(e.dragT > r.time && e.drag === AFFINITY.drag.slow);
	assert.ok(!(e.slowT > r.time), 'not a cold slow');
	console.log('drag: OK');
}
{
	// Наводка: +12% from everyone for 2 s, on top of a mark.
	const { r, e, hit } = pair('knives', 'lantern');
	e.markT = r.time + 10;
	e.markMul = 0.2;
	hit('knives');
	hit('lantern');
	assert.ok(e.aimT > r.time);
	assert.ok(Math.abs(hit('knives') - 10 * 1.2 * (1 + AFFINITY.aim.vuln)) < 1e-9, 'mark and aim multiply');
	console.log('aim: OK');
}
{
	// A duo pair has no affinity; the first trigger of each kind sends one 'aff' message.
	const { h, hit } = pair('whip', 'lightning');
	hit('whip');
	hit('lightning');
	assert.ok(Object.values(h.affN).every((n) => n === 0));
	sent.length = 0;
	const v = pair('whip', 'frost');
	v.hit('whip');
	v.hit('frost');
	v.r.time += 1.01;
	v.hit('whip');
	assert.equal(sent.filter(([, m]) => m.t === 'aff').length, 1, 'one message per kind');
	assert.deepEqual(sent.find(([, m]) => m.t === 'aff')[1], { t: 'aff', id: 'vise', a: 'whip', b: 'frost' });
	console.log('affinity rules: OK');
}
{
	// In a real fight: every rule fires from the weapons themselves.
	const pairs = { vise: ['whip', 'frost'], crossfire: ['bolt', 'knives'], soak: ['flask', 'traps'], recoil: ['bolt', 'whip'], drag: ['whip', 'flask'], aim: ['knives', 'lantern'] };
	for (const [rule, [a, b]] of Object.entries(pairs)) {
		const { r, h } = room();
		h.weapons.set(a, { lvl: 3, t: 0 });
		h.weapons.set(b, { lvl: 3, t: 0 });
		crowd(r, 30);
		run(r, h, 6);
		assert.ok(h.affN[rule] > 0, `${rule} fires in a fight (${a} + ${b}): ${JSON.stringify(h.affN)}`);
	}
	console.log('affinity in a fight: OK');
}
{
	// Cards: every owned partner (two at most, the higher level first); the affinity line only without a partner.
	const { r, h } = room();
	h.weapons = new Map([['ward', { lvl: 2, t: 0 }], ['lightning', { lvl: 4, t: 0 }], ['whip', { lvl: 1, t: 0 }]]);
	const c = { kind: 'weapon', id: 'aura', level: 1 };
	r.duoHint(h, { ...c });
	const card = { kind: 'weapon', id: 'ward', level: 3 };
	r.duoHint(h, card);
	assert.deepEqual(card.duoHints.map((x) => x.id), ['rod', 'riposte'], 'both partners, the higher level first');
	assert.equal(card.duoHint.id, 'rod', 'old clients read the first one');
	assert.equal(card.affHint, undefined);
	const lone = { kind: 'weapon', id: 'frost', level: 1 };
	r.duoHint(h, lone);
	assert.equal(lone.duoHints, undefined);
	assert.deepEqual([lone.affHint.id, lone.affHint.with], ['vise', 'ward'], 'affinity with the first owned weapon');
	console.log('card hints: OK');
}
console.log('duos2-test: OK');
