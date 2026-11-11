// Wave 2 checks: states, reactions, direct synergies, new duos and evolutions. node server/wave2-test.js
import assert from 'node:assert/strict';
import { Room } from './game.js';
import { srcName } from './runlog.js';
import {
	TICK_HZ, DUOS, DUO_BY_PAIR, duoKey, EVOS, EVO_IDS, PASSIVES, PASSIVE_IDS, WEAPONS, REACTIONS, REACTION_IDS, REACT, ST,
} from '../public/shared/content.js';

const dt = 1 / TICK_HZ;
const S = (tags, weapon = 'test') => ({ weapon, tags });
const fx = [];

function room(heroes = ['knight']) {
	const r = new Room('W2', () => {});
	heroes.forEach((hero, i) => r.addPlayer(i + 1, 'P' + (i + 1), hero));
	r.start();
	r.enemies.length = 0;
	r.time = 100;
	return r;
}
function foe(r, x, y, type = 'brute') {
	const h = [...r.heroes.values()][0];
	const e = r.spawnEnemy(type, [h], 50);
	e.x = x;
	e.y = y;
	return e;
}
const hero = (r, pid = 1) => r.heroes.get(pid);
const grid = (r) => r.rebuildGrid();
const reacts = (r, kind) => r.fx.filter((f) => f[0] === 'react' && f[1] === REACTION_IDS.indexOf(kind));

// --- content invariants ---
{
	const per = {};
	for (const [id, D] of Object.entries(DUOS)) {
		for (const p of D.parts) per[p] = (per[p] ?? 0) + 1;
		assert.equal(DUO_BY_PAIR[duoKey(...D.parts)], id);
		assert.equal(D.levels.length, 3, id);
	}
	for (const id of Object.keys(WEAPONS).filter((id) => !['prism', 'tuning', 'anchor'].includes(id))) {
		assert.ok((per[id] ?? 0) >= 1 && per[id] <= 3, `${id} in 1..3 legacy duos (${per[id]})`);
	}
	for (const id of ['stormlight', 'volley', 'phalanx', 'firewheel']) assert.ok(DUOS[id]);
	const req = {};
	for (const id of EVO_IDS) {
		const E = EVOS[id];
		assert.ok(WEAPONS[E.from] && PASSIVES[E.requires], id);
		assert.ok(!req[E.requires], `${E.requires} opens one evolution`);
		req[E.requires] = id;
	}
	for (const w of ['spear', 'trail', 'lantern', 'flask']) assert.ok(Object.values(EVOS).some((E) => E.from === w), `${w} evolves`);
	for (const p of ['ember', 'frostcore', 'luck', 'bond']) assert.ok(PASSIVE_IDS.includes(p));
	assert.equal(REACTION_IDS.length, 8);
	for (const id of REACTION_IDS) assert.ok(srcName('r_' + id).includes(REACTIONS[id].name));
	console.log('content: OK');
}

// --- reactions ---
{
	// Проводник: a shock hit on a wet enemy discharges through everyone in the same puddle.
	const r = room(), h = hero(r);
	const z = { x: 500, y: 0, r: 70, life: 3, wet: true };
	const a = foe(r, 490, 0), b = foe(r, 530, 10), c = foe(r, 900, 0);
	for (const e of [a, b]) { e.wetT = r.time + 0.5; e.wetZ = z; }
	grid(r);
	const hp = b.hp, hc = c.hp;
	r.hurtEnemy(a, 40, h, S(['shock']));
	assert.ok(Math.abs(hp - b.hp - 40 * REACT.condFrac) < 0.01, 'conductor hits the puddle at 50%');
	assert.equal(c.hp, hc);
	assert.equal(reacts(r, 'cond').length, 1);
	assert.ok(h.dmgBy.r_cond > 0);
	r.hurtEnemy(a, 40, h, S(['shock']));
	assert.equal(r.reactN.cond, 1, 'once per 0.5 s per puddle');
	console.log('reaction cond: OK');
}
{
	// Вспышка: burning + shock → blast around, burn removed.
	const r = room(), h = hero(r);
	const a = foe(r, 400, 0), b = foe(r, 430, 0);
	r.burn(a, h, 5, 3);
	grid(r);
	const hb = b.hp;
	r.hurtEnemy(a, 20, h, S(['shock']));
	assert.ok(a.burnT <= r.time, 'burn removed');
	assert.ok(hb - b.hp >= REACT.flashBase, 'flash damages neighbours');
	assert.equal(r.reactN.flash, 1);
	console.log('reaction flash: OK');
}
{
	// Раскол: frozen + phys → ×2, thaw, shards.
	const r = room(), h = hero(r);
	const a = foe(r, 400, 0), b = foe(r, 425, 0);
	r.freeze(a, 2);
	grid(r);
	const hb = b.hp;
	const d = r.hurtEnemy(a, 20, h, S(['phys']));
	assert.equal(d, 40);
	assert.ok(a.frozenT <= r.time);
	assert.ok(hb - b.hp > 0);
	console.log('reaction shatter: OK');
}
{
	// Пар: burning + cold → both states gone, steam halves contact damage.
	const r = room(), h = hero(r);
	const a = foe(r, 400, 0);
	r.burn(a, h, 5, 3);
	a.slowT = r.time + 2;
	a.slow = 0.3;
	grid(r);
	r.hurtEnemy(a, 5, h, S(['cold']));
	assert.ok(a.burnT <= r.time && a.slowT <= r.time);
	assert.equal(r.steams.length, 1);
	assert.ok(r.inSteam(a));
	// Contact damage inside steam is halved.
	a.x = h.x + 10;
	a.y = h.y;
	Object.assign(r.steams[0], { x: a.x, y: a.y });
	h.iframes = 0;
	const hp = h.hp;
	grid(r);
	r.updatePlayers(dt, [h]);
	assert.ok(Math.abs(hp - h.hp - a.dmg * REACT.steamContact * h.trait.dmgTaken) < 0.6, `steam contact ${hp - h.hp} vs ${a.dmg}`);
	console.log('reaction steam: OK');
}
{
	// Подрыв, Наледь, Свет, Озноб.
	const r = room(), h = hero(r);
	const a = foe(r, 400, 0);
	grid(r);
	a.rootT = r.time + 1;
	assert.equal(r.hurtEnemy(a, 20, h, S(['fire', 'aoe'])), 20 * REACT.blastMul);
	a.rootT = 0;
	a.wetT = r.time + 0.5;
	r.hurtEnemy(a, 1, h, S(['cold']));
	assert.ok(a.frozenT > r.time, 'icing freezes');
	a.wetT = 0;
	a.frozenT = 0;
	a.markT = r.time + 1;
	a.markMul = 0.3;
	assert.ok(Math.abs(r.hurtEnemy(a, 10, h, S(['proj'])) - 13) < 1e-9);
	a.markT = 0;
	h.passives.set('frostcore', 2);
	r.recalcMods(h);
	a.slowT = r.time + 1;
	assert.ok(Math.abs(r.hurtEnemy(a, 10, h, S(['proj'])) - 11.2) < 1e-9);
	// Damage over time and reaction damage never trigger reactions.
	a.slowT = r.time + 1;
	r.burn(a, h, 4, 3);
	r.burnTick(a, 1);
	assert.ok(a.slowT > r.time && a.burnT > r.time, 'burn ticks do not make steam');
	console.log('reaction blast/icing/light/chill: OK');
}

// --- direct synergies ---
{
	const r = room(), h = hero(r);
	const e = foe(r, 40, 0, 'brute');
	grid(r);
	h.weapons = new Map([['aura', { lvl: 1, t: 0 }]]);
	h.passives.set('frostcore', 1);
	r.recalcMods(h);
	r.updateWeapon(h, 'aura', h.weapons.get('aura'), dt);
	assert.ok(e.slowT > r.time && e.slow >= 0.15, 'aura + frostcore chills');
	h.weapons = new Map([['lightning', { lvl: 1, t: 0 }]]);
	h.passives.set('ember', 1);
	r.recalcMods(h);
	r.updateWeapon(h, 'lightning', h.weapons.get('lightning'), dt);
	assert.ok(e.burnT > r.time, 'lightning + ember ignites');
	h.weapons = new Map([['orbit', { lvl: 1, t: 0 }]]);
	h.passives.set('mail', 1);
	r.recalcMods(h);
	h.guard = 2;
	const hp = h.hp;
	h.iframes = 0;
	r.hurtPlayer(h, 10);
	assert.equal(hp - h.hp, Math.max(1, 10 * h.trait.dmgTaken - 1 - 2), 'orbit + mail guard');
	assert.equal(h.guard, 0);
	console.log('direct synergies: OK');
}
{
	// Bond is never offered solo.
	const r = room(['knight']);
	for (let i = 0; i < 40; i++) assert.ok(!r.makeChoices(hero(r)).some((c) => c.id === 'bond'));
	console.log('bond solo: OK');
}

// --- new duos and evolutions deal damage and produce their effects ---
function arena(id, heroes = ['knight'], seconds = 8, setup) {
	const r = room(heroes);
	const h = hero(r);
	h.weapons = new Map([[id, { lvl: EVOS[id] ? 1 : 3, t: 0 }]]);
	if (EVOS[id]) h.passives.set(EVOS[id].requires, 1);
	r.recalcMods(h);
	setup?.(r, h);
	h.hp = h.maxHp = 1e6;
	for (const p of r.heroes.values()) p.hp = p.maxHp = 1e6;
	let moved = 0;
	for (let i = 0; i < seconds * TICK_HZ; i++) {
		while (r.enemies.filter((e) => !e.dead).length < 30) {
			const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 220;
			foe(r, h.x + Math.cos(a) * d, h.y + Math.sin(a) * d, 'ghoul');
		}
		moved++;
		r.handle(1, { t: 'pos', x: h.x + Math.cos(moved / 20) * 4, y: h.y + Math.sin(moved / 20) * 4, fx: 1, fy: 0 });
		r.tick(dt);
		fx.push(...r.fx.splice(0));
	}
	assert.ok((h.dmgBy[id] ?? 0) > 0, `${id} deals damage`);
	return { r, h };
}
{
	const { r } = arena('stormlight');
	assert.ok(r.enemies.some((e) => e.markT > r.time), 'stormlight marks');
	const { h: hv } = arena('volley');
	assert.ok(hv.dmgBy.volley > 0);
	const { r: rp, h: hp } = arena('phalanx');
	assert.ok(hp.ward >= 0);
	hp.ward = 1;
	const before = rp.projectiles.length;
	rp.hurtPlayer(hp, 10);
	assert.equal(rp.projectiles.length - before, DUOS.phalanx.levels[2].ring, 'broken charge → ring of spears');
	const { r: rf } = arena('firewheel');
	assert.ok(rf.puddles.some((z) => z.src?.weapon === 'firewheel'), 'firewheel leaves fire');
	console.log('new duos: OK');
}
{
	const { r: rt } = arena('firepath');
	// A burning enemy killed by the path ignites its neighbours.
	const h = hero(rt), a = foe(rt, h.x + 300, h.y), b = foe(rt, h.x + 330, h.y);
	grid(rt);
	rt.burn(a, h, 8, 3);
	rt.hurtEnemy(a, 1e9, h, S(['phys']));
	assert.ok(b.burnT > rt.time, 'firepath spreads fire');
	const { r: rb } = arena('beacon');
	const hb = hero(rb), e = foe(rb, hb.x + 100, hb.y);
	e.beaconT = rb.time + 1;
	const gems = rb.gems.length;
	rb.hurtEnemy(e, 1e9, hb, S(['phys']));
	assert.equal(rb.gems[gems]?.xp ?? rb.gems.at(-1).xp, e.xp * EVOS.beacon.levels[0].xpMul, 'beacon mark multiplies xp');
	const { r: rn, h: hn } = arena('banner', ['knight', 'witch']);
	assert.ok(fx.some((f) => f[0] === 'banner'), 'banner planted');
	const { h: hq } = arena('quagmire');
	assert.ok(hq.dmgBy.quagmire > 0);
	void rn;
	void hn;
	console.log('new evolutions: OK');
}
{
	// Reactions happen in a normal mixed fight: flask puddles + lightning, burning trail + frost.
	const { r } = arena('lightning', ['alchemist'], 12, (r, h) => h.weapons.set('flask', { lvl: 5, t: 0 }));
	assert.ok(r.reactN.cond > 0, 'conductor in a real fight');
	const { r: r2 } = arena('trail', ['knight'], 12, (r, h) => h.weapons.set('frost', { lvl: 5, t: 0 }));
	assert.ok(r2.reactN.steam + r2.reactN.shatter > 0, 'steam in a real fight');
	assert.ok(fx.some((f) => f[0] === 'react' && f.length === 5));
	const log = r.runLog.build(r, false);
	assert.ok(log.reactions.cond > 0 && log.summary.some((l) => l.startsWith('Реакции:')));
	console.log('reactions in a fight: OK');
}
{
	// Card hints: a reaction with the hero's or an ally's weapon, and weapon + artifact synergies.
	const r = room(['alchemist', 'knight']);
	const h = hero(r);
	const c = { id: 'lightning', kind: 'weapon', level: 1 };
	r.waveHints(h, c);
	assert.equal(c.reactHint?.name, 'Проводник');
	assert.equal(c.reactHint.ally, false);
	const k = hero(r, 2), c2 = { id: 'lightning', kind: 'weapon', level: 1 };
	r.waveHints(k, c2);
	assert.ok(c2.reactHint?.ally, 'ally puddles count');
	h.passives.set('crit', 1);
	const c3 = { id: 'knives', kind: 'weapon', level: 1 };
	r.waveHints(h, c3);
	assert.ok(c3.synHint?.desc.includes('пробивает'));
	console.log('card hints: OK');
}
console.log('wave2-test: OK');
