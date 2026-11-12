import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { WEAPONS } from '../public/shared/content.js';

const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-8, `${message}: expected ${b}, got ${a}`);
const kinds = ['shatter', 'resonance', 'cond', 'flash-cond', 'all'];

function reactionScene({ kind = 'shatter', marked = true, local = false, sameOwner = false,
	count = 8, primaryHp = 10000, neighborHp = 10000, shield = false, back = false,
	armored = false, dead = false, reverse = false, repeat = false, expireNext = false } = {}) {
	const random = Math.random;
	let randomCalls = 0;
	Math.random = () => { randomCalls++; return 0.99; };
	try {
		const r = new Room('REACTION-SUPPORT', () => {});
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
		const neighbors = Array.from({ length: count }, (_, i) => enemy(shield ? 'shield' : 'ghoul', 40, 25 + i, 10000));
		r.rebuildGrid();
		r.updateWeapon(a, 'lantern', a.weapons.get('lantern'), 1 / 30);
		assert.equal(primary.markOwner, a);
		assert.ok(neighbors.every((e) => e.markT <= r.time), 'only the primary is in the real Lantern cone');
		if (!marked) r.time += 3.01;
		if (local) {
			assert.equal(count, 1);
			const owner = sameOwner ? a : b;
			owner.x = 40; owner.y = 220; owner.weapons.get('lantern').t = 0;
			r.updateWeapon(owner, 'lantern', owner.weapons.get('lantern'), 1 / 30);
			assert.equal(neighbors[0].markOwner, owner);
			assert.equal(primary.markOwner, a);
			owner.x = owner.y = 0;
		}
		c.x = 200; c.y = 25;
		if (reverse) r.enemies.reverse();
		r.rebuildGrid();
		const all = [primary, ...neighbors];
		const sources = [], splash = r.splash.bind(r);
		r.splash = (...args) => {
			const src = args[5];
			sources.push({ weapon: src.weapon, tags: [...src.tags], react: src.react, owner: src.markSupport?.owner.pid ?? null });
			return splash(...args);
		};
		function prepare() {
			// Native state-entry points, before the measured interval; no synthetic marks.
			if (kind === 'resonance' || kind === 'all') r.tuningWave(a, WEAPONS.tuning.levels[0], 1, { weapon: 'tuning', tags: ['aoe'] });
			if (kind === 'shatter' || kind === 'all') assert.ok(r.freeze(primary, 3));
			if (['cond', 'flash-cond', 'all'].includes(kind)) {
				r.addPatch(c, 40, 0, 65, 4, 1, 1, { weapon: 'flask', tags: ['poison'] }, 0, 'support-wet', 1, { wet: true, zk: 0 });
				r.updatePuddles(0);
				assert.ok(primary.wetT > r.time && primary.wetZ.life > 0);
			}
			if (kind === 'flash-cond' || kind === 'all') r.burn(primary, c, 1, 3);
		}
		const results = [];
		for (let hit = 0; hit < (repeat || expireNext ? 2 : 1); hit++) {
			if (hit) r.time += expireNext ? 3.01 : 1.6;
			prepare();
			primary.hp = primaryHp;
			if (armored) primary.elite = 'armored';
			for (const e of neighbors) { e.hp = neighborHp; if (shield) e.fa = back ? Math.PI : 0; }
			if (dead) neighbors.at(-1).dead = true;
			const hp = all.map((e) => e.hp), damage = c.dmg, by = { ...c.dmgBy };
			const support = [a, b, c].map((h) => h.supportDamage), beforeRandom = randomCalls, sourceStart = sources.length;
			const tags = kind === 'all' ? ['phys', 'shock', 'proj'] : kind === 'shatter' || kind === 'resonance' ? ['phys', 'proj'] : ['shock', 'proj'];
			r.hurtEnemy(primary, 5, c, { weapon: tags.includes('shock') ? 'lightning' : 'whip', tags });
			results.push({ damage: c.dmg - damage, loss: all.map((e, i) => Math.min(hp[i], hp[i] - e.hp)),
				support: [a, b, c].map((h, i) => h.supportDamage - support[i]), randomCalls: randomCalls - beforeRandom,
				by: Object.fromEntries(Object.entries(c.dmgBy).map(([id, n]) => [id, n - (by[id] ?? 0)]).filter(([, n]) => n !== 0)),
				dead: all.map((e) => e.dead), burn: primary.burnT, reactions: { ...r.reactN }, sources: sources.slice(sourceStart) });
		}
		return results;
	} finally { Math.random = random; }
}

test('4547133986: the primary Lantern mark credits all eight Shatter neighbors', () => {
	const [plain] = reactionScene({ marked: false }), [marked] = reactionScene();
	assert.equal(plain.damage, 34);
	assert.equal(marked.damage, 42.5);
	assert.equal(marked.support[0], 8.5);
	assert.deepEqual(marked.loss, [12.5, ...Array(8).fill(3.75)]);
	assert.deepEqual(marked.by, { whip: 12.5, r_shatter: 30 });
});

test('4547133986: resonance, conduction and fixed Flash followed by conduction retain their actual added damage', () => {
	for (const [kind, d00, d10] of [['resonance', 31, 38.75], ['cond', 25, 31.25], ['flash-cond', 174.5, 185.625], ['all', 269, 303.75]]) {
		const [plain] = reactionScene({ kind, marked: false }), [marked] = reactionScene({ kind });
		assert.equal(plain.damage, d00, kind);
		assert.equal(marked.damage, d10, kind);
		close(marked.support[0], d10 - d00, `${kind}: fixed Flash is not credited as a primary mark`);
		assert.deepEqual(marked.support.slice(1), [0, 0]);
		assert.equal(marked.randomCalls, plain.randomCalls);
	}
});

test('4547133986: inherited reaction support uses each target’s HP, defense and dead state', () => {
	for (const kind of kinds) for (const options of [
		{ primaryHp: 1 }, { neighborHp: 1 }, { neighborHp: 3.2 }, { shield: true },
		{ shield: true, back: true },
		{ armored: true }, { dead: true, reverse: true },
	]) {
		const [plain] = reactionScene({ ...options, kind, marked: false }), [marked] = reactionScene({ ...options, kind });
		close(marked.support[0], marked.damage - plain.damage, `${kind} ${JSON.stringify(options)}`);
		if (options.dead) assert.equal(marked.loss.at(-1), 0);
	}
});

test('4547133986: HP caps apply per damage entry, including an earlier kill inside a compound hit', () => {
	const options = { shield: true, neighborHp: 0.7 };
	for (const kind of ['shatter', 'resonance', 'cond', 'flash-cond']) {
		const [plain] = reactionScene({ ...options, kind, marked: false }), [marked] = reactionScene({ ...options, kind });
		close(marked.support[0], marked.damage - plain.damage, `${kind}: per-entry clipped HP gain`);
	}
	const [plain] = reactionScene({ ...options, kind: 'all', marked: false });
	const [marked] = reactionScene({ ...options, kind: 'all' });
	const [earlyPlain] = reactionScene({ ...options, kind: 'resonance', marked: false });
	const [earlyMarked] = reactionScene({ ...options, kind: 'resonance' });
	// Resonance kills each marked neighbor at this entry. In the unmarked
	// comparison a later Shatter kills it instead. Preserve the existing per-hit
	// support convention; no simulation of future counterfactual dead-target hits.
	const earlierNeighborGain = earlyMarked.loss.slice(1).reduce((sum, hp, i) => sum + hp - earlyPlain.loss[i + 1], 0);
	close(marked.support[0], marked.loss[0] - plain.loss[0] + earlierNeighborGain, 'early kill credit plus primary credit');
	close(marked.support[0], 3.65, 'the early-kill boundary stays explicit');
});

test('4547133986: two reaction mark owners divide the measured HP gain without duplicate cross terms', () => {
	for (const kind of kinds) for (const options of [{}, { neighborHp: 1 }, { neighborHp: 3.2 }, { shield: true }, { primaryHp: 1 }]) {
		const args = { ...options, kind, count: 1 };
		const [d00] = reactionScene({ ...args, marked: false }), [d10] = reactionScene(args);
		const [d11] = reactionScene({ ...args, local: true }), [shared] = reactionScene({ ...args, local: true, sameOwner: true });
		close(d11.support[0], d10.damage - d00.damage, `${kind}: inherited A`);
		close(d11.support[1], d11.damage - d10.damage, `${kind}: local B`);
		close(shared.support[0], shared.damage - d00.damage, `${kind}: shared owner`);
		assert.equal(shared.support[1], 0);
		assert.equal(d11.support[2], 0);
		assert.deepEqual(shared.loss, d11.loss);
	}
});

test('4547133986: independent and repeated reactions do not retain an old primary mark', () => {
	for (const kind of kinds) {
		const [first, second] = reactionScene({ kind, repeat: true });
		assert.deepEqual(second.support, first.support);
		assert.deepEqual(second.by, first.by);
		const [_, expired] = reactionScene({ kind, expireNext: true });
		const [plain] = reactionScene({ kind, marked: false });
		assert.deepEqual(expired.support, [0, 0, 0]);
		assert.equal(expired.damage, plain.damage);
		assert.deepEqual(expired.by, plain.by);
		assert.ok(first.sources.every((src) => src.owner === 1));
		assert.ok(expired.sources.every((src) => src.owner === null));
		assert.deepEqual(expired.sources.map(({ owner, ...src }) => src), first.sources.map(({ owner, ...src }) => src),
			'weapon identity, tags and reaction behavior survive the accounting metadata');
	}
});
