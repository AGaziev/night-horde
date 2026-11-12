import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';

const dt = 1 / 30;
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9,
	`${message}: expected ${expected}, got ${actual}`);

// Both marks come from actual Lantern casts. Only the measured shock hit is
// included in the HP/damage/support deltas; the setup casts are not counted.
function scene({ primaryMark = true, localMark = false, sameOwner = false, count = 8,
	primaryHp = 10000, neighborHp = 10000, primaryArmor = false, neighborType = 'ghoul',
	front = true, deadNeighbor = false, reverse = false, selfAttack = false } = {}) {
	const random = Math.random;
	let randomCalls = 0;
	Math.random = () => { randomCalls++; return 0.99; };
	try {
		const r = new Room('FLASH-SUPPORT', () => {});
		for (let pid = 1; pid <= 3; pid++) r.addPlayer(pid, `P${pid}`, 'knight');
		r.start(); r.time = 100; r.enemies.length = 0; r.synergy = 0;
		const [a, b, c] = [...r.heroes.values()];
		for (const h of [a, b, c]) {
			h.x = h.y = 0; h.perk.readyAt = Infinity;
			h.weapons = new Map([['lantern', { lvl: 1, t: 0 }]]);
		}
		function enemy(type, x, y, hp) {
			const e = r.spawnEnemy(type, [a, b, c], 1);
			Object.assign(e, { x, y, hp, maxHp: hp, speed: 0, dmg: 0 });
			return e;
		}
		const primary = enemy('ghoul', 40, 0, 20000);
		const neighbors = Array.from({ length: count }, (_, i) => enemy(neighborType, 0, 20 + i, 10000));
		r.rebuildGrid();
		r.updateWeapon(a, 'lantern', a.weapons.get('lantern'), dt);
		assert.equal(primary.markOwner, a);
		assert.equal(primary.markMul, 0.25);
		assert.ok(neighbors.every((e) => e.markT <= r.time), 'neighbors are outside the primary Lantern cone');
		if (!primaryMark) r.time += 3.01;
		if (localMark) {
			assert.equal(count, 1, 'the separate owner scenario uses one neighbor');
			const owner = sameOwner ? a : b;
			owner.x = 0; owner.y = 220;
			owner.weapons.get('lantern').t = 0;
			r.updateWeapon(owner, 'lantern', owner.weapons.get('lantern'), dt);
			assert.equal(neighbors[0].markOwner, owner, 'the local mark is applied by its own real cast');
			assert.equal(primary.markOwner, a, 'the local cast cannot replace the primary mark');
			owner.x = owner.y = 0;
		}
		primary.hp = primaryHp;
		if (primaryArmor) primary.elite = 'armored';
		for (const e of neighbors) {
			e.hp = neighborHp;
			if (neighborType === 'shield') e.fa = front ? 0 : Math.PI;
		}
		const attacker = selfAttack ? a : c;
		attacker.x = 200; attacker.y = 25; // Facing the shield; other mark owners are on other sides.
		if (deadNeighbor) neighbors.at(-1).dead = true;
		if (reverse) r.enemies.reverse();
		r.rebuildGrid();
		const all = [primary, ...neighbors];
		const hp = all.map((e) => e.hp);
		const damage = attacker.dmg, support = [a, b, c].map((h) => h.supportDamage);
		const by = { ...attacker.dmgBy }, beforeRandom = randomCalls;
		r.burn(primary, attacker, 1, 3);
		r.hurtEnemy(primary, 5, attacker, { weapon: 'lightning', tags: ['shock', 'proj'] });
		const loss = all.map((e, i) => Math.min(hp[i], hp[i] - e.hp));
		return { r, a, b, c, primary, neighbors, loss, damage: attacker.dmg - damage, randomCalls: randomCalls - beforeRandom,
			support: [a, b, c].map((h, i) => h.supportDamage - support[i]),
			by: Object.fromEntries(Object.entries(attacker.dmgBy).map(([id, n]) => [id, n - (by[id] ?? 0)]).filter(([, n]) => n !== 0)) };
	} finally { Math.random = random; }
}

test('4546767569: a real Lantern mark credits its extra Flash damage on all eight unmarked neighbors', () => {
	const plain = scene({ primaryMark: false }), marked = scene();
	assert.equal(plain.damage, 108.5);
	assert.equal(marked.damage, 113.125);
	assert.deepEqual(plain.loss, [16.5, ...Array(8).fill(11.5)]);
	assert.deepEqual(marked.loss, [18.125, ...Array(8).fill(11.875)]);
	assert.equal(marked.support[0], 4.625);
	assert.equal(marked.support[0], marked.damage - plain.damage);
	assert.deepEqual(marked.support.slice(1), [0, 0], 'only the mark owner gets support credit');
	assert.deepEqual(plain.by, { lightning: 5, r_flash: 103.5 });
	assert.deepEqual(marked.by, { lightning: 6.25, r_flash: 106.875 });
	assert.equal(marked.primary.burnT, 0);
	assert.equal(marked.r.reactN.flash, 1);
	assert.equal(marked.randomCalls, plain.randomCalls, 'accounting does not add random combat decisions');
});

test('4546767569: per-target HP, armor, shield direction and dead targets bound inherited support', () => {
	for (const options of [
		{ primaryHp: 1 }, { primaryArmor: true }, { neighborHp: 11.6 }, { neighborHp: 1 },
		{ neighborType: 'shield', front: true }, { neighborType: 'shield', front: false },
		{ neighborType: 'shield', front: true, neighborHp: 2.35 }, { deadNeighbor: true },
		{ primaryHp: 1, deadNeighbor: true, reverse: true },
	]) {
		const plain = scene({ ...options, primaryMark: false }), marked = scene(options);
		close(marked.support[0], marked.damage - plain.damage, JSON.stringify(options));
		close(marked.loss.reduce((sum, n) => sum + n, 0), marked.damage, 'support does not add to HP damage');
		if (options.primaryHp === 1) assert.equal(marked.support[0], deadNeighborCount(options) * 0.375,
			'primary overkill does not erase the live neighbor benefit');
		if (options.primaryArmor) assert.equal(marked.support[0], 0.8125 + 8 * 0.375,
			'projectile armor on the primary does not mitigate non-projectile Flash neighbors');
		if (options.deadNeighbor) assert.equal(marked.loss.at(-1), 0);
	}
});
function deadNeighborCount(options) { return options.deadNeighbor ? 7 : 8; }

test('4546767569: inherited and local marks split the actual HP gain once, including shared owners', () => {
	for (const options of [
		{}, { neighborHp: 11.6 }, { neighborHp: 13 }, { neighborHp: 1 },
		{ neighborType: 'shield', front: true }, { neighborType: 'shield', front: false },
		{ neighborType: 'shield', front: true, neighborHp: 2.35 }, { primaryHp: 1, reverse: true },
	]) {
		const args = { ...options, count: 1 };
		const d00 = scene({ ...args, primaryMark: false });
		const d10 = scene(args);
		const d11 = scene({ ...args, localMark: true });
		const shared = scene({ ...args, localMark: true, sameOwner: true });
		const inherited = d10.damage - d00.damage, local = d11.damage - d10.damage;
		close(d11.support[0], inherited, `inherited A ${JSON.stringify(options)}`);
		close(d11.support[1], local, `local B ${JSON.stringify(options)}`);
		close(d11.support[0] + d11.support[1], d11.damage - d00.damage, 'the cross term is never counted twice');
		close(shared.support[0], shared.damage - d00.damage, 'one owner receives the combined benefit once');
		assert.equal(shared.support[1], 0);
		assert.equal(d11.support[2], 0, 'the attacker cannot inherit another hero’s support');
		assert.deepEqual(shared.loss, d11.loss, 'ownership does not affect combat damage');
	}
});

test('4546767569: an expired mark and a later independent Flash cannot leak inherited support', () => {
	const expired = scene({ primaryMark: false });
	assert.deepEqual(expired.support, [0, 0, 0]);
	const { r, a, c, primary, neighbors } = scene();
	r.time += 3.01;
	const support = a.supportDamage, damage = c.dmg;
	const hp = [primary, ...neighbors].map((e) => e.hp);
	r.burn(primary, c, 1, 3);
	r.hurtEnemy(primary, 5, c, { weapon: 'lightning', tags: ['shock', 'proj'] });
	assert.equal(a.supportDamage, support);
	assert.equal(c.dmg - damage, 108.5);
	assert.deepEqual([primary, ...neighbors].map((e, i) => hp[i] - e.hp), [16.5, ...Array(8).fill(11.5)]);
	assert.equal(r.reactN.flash, 2);
});

test('4546767569: attacking one’s own mark retains one support credit without adding combat damage', () => {
	for (const options of [{}, { count: 1, localMark: true }, { primaryHp: 1 }, { neighborHp: 1 }]) {
		const allyHit = scene(options), selfHit = scene({ ...options, selfAttack: true });
		assert.deepEqual(selfHit.loss, allyHit.loss);
		assert.deepEqual(selfHit.by, allyHit.by);
		assert.deepEqual(selfHit.support, allyHit.support);
		assert.equal(selfHit.damage, allyHit.damage);
		assert.equal(selfHit.randomCalls, allyHit.randomCalls);
	}
});
