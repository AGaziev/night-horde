import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { SnapshotDecoder } from '../public/js/snapshot-codec.js';
import { DUOS, WEAPONS, DUO_INHERIT_POWER, DUO_SIGNATURE_POWER, EMBER_WEAK, orbitAngle } from '../public/shared/content.js';

const dt = 1 / 30;
function arena(weapons, players = 1) {
	const sent = [];
	const r = new Room('REVIEW', (pid, msg, json) => sent.push({ pid, msg, wire: json && JSON.parse(json) }));
	for (let pid = 1; pid <= players; pid++) r.addPlayer(pid, `P${pid}`, 'knight');
	r.start(); r.time = 100; r.enemies.length = 0;
	const h = r.heroes.get(1);
	h.x = h.y = 0; h.perk.readyAt = Infinity;
	h.weapons = new Map(weapons.map(([id, lvl]) => [id, { lvl, t: 0 }]));
	r.updateCombos(h);
	return { r, h, sent };
}
function fuse(r, h, id) {
	const pair = r.updateCombos(h).find((c) => c.id === id && c.ready);
	assert.ok(pair, `${id}: the actual parts qualify for fusion`);
	h.offer = [r.duoCard(h, pair)];
	r.sendOffer(h);
	r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: h.offerEpoch });
	return h.weapons.get(id);
}
function foe(r, x, y = 0, hp = 10000) {
	const e = r.spawnEnemy('ghoul', [...r.heroes.values()], 1);
	Object.assign(e, { x, y, hp, maxHp: hp, speed: 0, dmg: 0 });
	r.rebuildGrid();
	return e;
}

test('4540714269: Orrery keeps its live mask and inherited levels through key, delta and resync', () => {
	const { r, h, sent } = arena([['bolt', 3], ['orbit', 5]]);
	const w = fuse(r, h, 'orrery');
	const dec = new SnapshotDecoder();
	function read(expectedMask, key) {
		r.snapshot();
		const wire = sent.filter((m) => m.pid === 1 && m.wire?.t === 's').at(-1).wire;
		assert.equal(wire.K === 1, key, 'the expected wire path is exercised');
		const snapshot = dec.decode(wire);
		assert.ok(snapshot, 'the browser decoder accepts the snapshot');
		const row = snapshot.p[0][12][0];
		assert.equal(row[3], expectedMask, 'the client draws exactly the sparks still orbiting');
		assert.deepEqual(row[5], [['bolt', 4], ['orbit', 5]], 'the same row retains both attack levels');
	}
	r.updateWeapon(h, 'orrery', w, dt);
	const count = DUOS.orrery.levels[w.lvl - 1].count;
	const full = (1 << count) - 1;
	read(full, true);
	foe(r, 180);
	w.t = 0;
	r.updateWeapon(h, 'orrery', w, dt);
	const fired = w.ready.findIndex((at) => at > r.time);
	assert.ok(fired >= 0, 'a real Orrery cast launches one spark');
	const missing = full & ~(1 << fired);
	read(missing, false);
	dec.reset(); r.resync(1);
	read(missing, true);
	r.time = w.ready[fired];
	r.enemies.length = 0; r.rebuildGrid();
	r.updateWeapon(h, 'orrery', w, dt);
	read(full, false);
});

test('4540714284: an asymmetric fusion spends and refills the actual inherited Ward level', () => {
	for (const [tuning, ward, charges, cooldown] of [[3, 5, 3, 7], [5, 3, 2, 8]]) {
		for (const reverse of [false, true]) {
			const parts = [['tuning', tuning], ['ward', ward]];
			const { r, h } = arena(reverse ? parts.reverse() : parts);
			const w = fuse(r, h, 'resonantshield');
			assert.equal(w.lvl, 2);
			r.updateWeapon(h, 'resonantshield', w, dt);
			assert.equal(h.wardMax, charges, `Ward ${ward} retains its charges after fusion`);
			assert.equal(h.ward, charges);
			assert.equal(w.t, cooldown, `Ward ${ward} retains its refill clock`);
			const hp = h.hp, ready = h.perk.readyAt;
			for (let n = charges; n > 0; n--) {
				r.hurtPlayer(h, 50, 'test');
				assert.equal(h.ward, n - 1, 'one real incoming hit spends one inherited charge');
				assert.equal(h.hp, hp);
				assert.equal(h.perk.readyAt, ready, 'the inherited shield does not spend the hero shield');
			}
			r.updateWeapon(h, 'resonantshield', w, cooldown - 0.01);
			assert.equal(h.ward, 0, 'a charge cannot refill early');
			r.updateWeapon(h, 'resonantshield', w, 0.02);
			assert.equal(h.ward, 1, 'the actual Ward cooldown refills one charge');
			assert.equal(w.t, cooldown);
			w.lvl = 3;
			r.updateWeapon(h, 'resonantshield', w, dt);
			assert.equal(h.wardMax, 3, 'upgrading the duo still raises a lower inherited Ward to V');
		}
	}
});

test('4540714331: Icebomb retains its fire part for full Ember, with a non-fire control', () => {
	const random = Math.random;
	try {
		for (const fire of [true, false]) for (const roll of [0, 0.99]) {
			const { r, h } = arena(fire ? [['bomb', 3], ['frost', 3], ['aura', 1]] : [['frost', 3], ['aura', 1]]);
			h.passives.set('ember', 5); r.recalcMods(h);
			if (fire) fuse(r, h, 'icebomb');
			const e = foe(r, 40);
			Math.random = () => roll;
			r.updateWeapon(h, 'aura', h.weapons.get('aura'), dt);
			if (fire && roll > h.mods.burnChance) {
				assert.ok(e.burnT <= r.time, 'retained fire uses the full Ember chance, rather than guaranteed weak fire');
			} else {
				assert.ok(e.burnT > r.time, 'the real aura hit ignites');
				assert.equal(e.burnDps, h.mods.burnDps * (fire ? 1 : EMBER_WEAK.frac), 'only a build with inherited fire gets full Ember damage');
			}
			assert.equal(h.fireW, fire, 'the ownership cache includes the fused bomb attack');
		}
	} finally { Math.random = random; }
});

test('4540714302: mark support is the extra dealt damage after fixed flash damage, armor and HP caps', () => {
	for (const [hp, armored] of [[10000, false], [17, false], [16, false], [1, false], [10000, true], [8.5, true]]) {
		function hit(marked) {
			const { r, h } = arena([['lantern', 1]], 2);
			const e = foe(r, 40);
			r.updateWeapon(h, 'lantern', h.weapons.get('lantern'), dt);
			assert.equal(e.markMul, 0.25, 'the real Lantern cast supplies the mark');
			if (!marked) r.time += 3.01;
			e.hp = hp;
			if (armored) e.elite = 'armored';
			const ally = r.heroes.get(2);
			r.burn(e, ally, 1, 3);
			const support = h.supportDamage, damage = ally.dmg;
			r.hurtEnemy(e, 5, ally, { weapon: 'lightning', tags: ['shock', 'proj'] });
			return { damage: ally.dmg - damage, support: h.supportDamage - support };
		}
		const plain = hit(false), marked = hit(true), mitigation = armored ? 0.5 : 1;
		assert.equal(plain.damage, Math.min(hp, 16.5 * mitigation));
		assert.equal(marked.damage, Math.min(hp, 18.125 * mitigation));
		assert.equal(marked.support, marked.damage - plain.damage, `support counts only the actual mark benefit at hp=${hp}, armored=${armored}`);
	}
});

test('4540714319: Whirlwind has only its signature contact clock', () => {
	const { r, h } = arena([['orbit', 3], ['aura', 3]]);
	const w = fuse(r, h, 'whirlwind');
	r.time = 1;
	const angle = orbitAngle(r.time, WEAPONS.orbit.levels[2].rps, 0, WEAPONS.orbit.levels[2].count);
	const e = foe(r, Math.cos(angle) * 92, Math.sin(angle) * 92);
	e.r = 20;
	const expected = (DUOS.whirlwind.levels[0].bladeDmg * DUO_SIGNATURE_POWER) * (1 + r.synergy);
	r.updateWeapon(h, 'whirlwind', w, dt);
	assert.ok(Math.abs(h.dmg - expected) < 1e-9, `both rings hit: expected ${expected}, got ${h.dmg}`);
	const damage = h.dmg;
	r.time += 0.1;
	r.updateWeapon(h, 'whirlwind', w, dt);
	assert.equal(h.dmg, damage, 'neither ring bypasses its own contact cooldown');
	r.time = 1 + 1 / WEAPONS.orbit.levels[2].rps;
	r.updateWeapon(h, 'whirlwind', w, dt);
	assert.ok(Math.abs(h.dmg - 2 * expected) < 1e-9, 'both rings can hit again after their cooldowns');
});

test('4540714319: all blades of one ring still share a cooldown, independently for each player', () => {
	const { r, h } = arena([['orbit', 3]], 2);
	const ally = r.heroes.get(2);
	ally.x = ally.y = 0; ally.perk.readyAt = Infinity;
	ally.weapons = new Map([['orbit', { lvl: 3, t: 0 }]]);
	const e = foe(r, 0); e.r = 120; // Every blade overlaps this one large target.
	for (const owner of [h, ally]) {
		r.updateWeapon(owner, 'orbit', owner.weapons.get('orbit'), dt);
		assert.equal(owner.dmg, 12, 'overlapping blades produce only one contact hit per ring');
		r.updateWeapon(owner, 'orbit', owner.weapons.get('orbit'), dt);
		assert.equal(owner.dmg, 12, 'a second call cannot bypass the same ring cooldown');
	}
	assert.equal(e.maxHp - e.hp, 24, 'one player does not consume another player’s contact hit');
});

test('4540714342: a Coil target search cannot truncate the outer aura attack in either enemy order', () => {
	for (const coil of [false, true]) for (const reverse of [false, true]) for (const killedX of [-200, 200]) {
		const { r, h } = arena([['aura', 5]]);
		if (coil) { h.passives.set('coil', 1); r.recalcMods(h); }
		h.mods.areaMul = 2;
		const positions = [killedX, -killedX];
		const enemies = new Map((reverse ? positions.reverse() : positions).map((x) => [x, foe(r, x, 0, x === killedX ? 1 : 100)]));
		r.updateWeapon(h, 'aura', h.weapons.get('aura'), dt);
		assert.ok(enemies.get(killedX).dead, 'the real area attack kills the first victim');
		assert.equal(enemies.get(-killedX).hp, 90, `the distant survivor still takes 10 damage: coil=${coil}, reverse=${reverse}, killedX=${killedX}`);
		assert.ok(!r.fx.some(([fx]) => fx === 'zap'), 'the other target is outside Coil range');
	}
});
