import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { HORDE_COMBAT, HORDE_PACKS } from '../public/shared/horde-content.js';

const raw = { weapon: 'other', tags: [], raw: true };
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} !== ${expected}`);

// Each carrier is born from an actual paid order. Only positions and the random source
// are controlled; damage, travel, callbacks, timers and status handling are production code.
function encounter(weapons = {}, artifacts = {}, count = 1, packs = { swarm: 1 }) {
	const messages = [];
	const room = new Room('COMBAT', (pid, msg) => messages.push({ pid, msg: structuredClone(msg) }));
	room.addPlayer(1, 'Director', 'ranger'); room.setRuleset('horde');
	for (let i = 0; i < count; i++) room.addPlayer(i + 2, `Hero${i}`, 'ranger');
	assert.equal(room.start(), true);
	room.horde.build = { packs: { ...packs }, weapons: { ...weapons }, artifacts: { ...artifacts } };
	const cohort = purchase(room, 'swarm');
	const heroes = [...room.heroes.values()];
	heroes.forEach((h, i) => { h.x = 100 + i * 80; h.y = 0; });
	const carrier = cohort[0]; carrier.x = 0; carrier.y = 0;
	return { room, mode: room.horde, combat: room.horde.combat, carrier, cohort, heroes, messages };
}

function purchase(room, pack) {
	const before = new Set(room.enemies.map((e) => e.id));
	room.horde.resource = room.horde.resourceCap;
	room.handle(1, { t: 'horde', seq: room.horde.lastSeq + 1, action: 'spawn', pack, x: -1000, y: 0 });
	assert.equal(room.horde.pending.length, 1, 'fixture must create a real paid order');
	room.time += 2;
	room.horde.tick(0, [...room.heroes.values()].filter((h) => h.st === 0));
	const cohort = room.enemies.filter((e) => !before.has(e.id) && e.hordeSource === 'manual');
	assert.ok(cohort.length >= HORDE_PACKS[pack].units.length);
	cohort.forEach((e, i) => { e.x = -1000; e.y = i * 2; });
	return cohort;
}

function advance(fixture, seconds, travel = 0) {
	fixture.room.time += seconds;
	fixture.room.tickNo++;
	for (const h of fixture.heroes) h.iframes = Math.max(0, h.iframes - seconds);
	fixture.combat.tick(travel);
}

function fire(fixture, id, travel = 0.5) {
	fixture.combat.cast(id, fixture.combat.units());
	if (travel) fixture.combat.tickProjectiles(travel);
}

function withRandom(value, fn) {
	const original = Math.random;
	Math.random = () => value;
	try { return fn(); } finally { Math.random = original; }
}

test('venom travels, hits and deals three timed poison ticks with a visible finite status', () => {
	const f = encounter({ venom: 1 });
	const h = f.heroes[0], hp = h.hp;
	f.combat.cast('venom', f.combat.units());
	assert.equal(f.combat.shots.length, 1);
	assert.equal(h.hp, hp, 'the cursor and cast itself do not deal immediate damage');
	f.combat.tickProjectiles(0.5);
	assert.equal(hp - h.hp, 4);
	assert.equal(f.combat.statusMsg().effects[0].poisonUntil, 5);
	advance(f, 0.99);
	assert.equal(hp - h.hp, 4);
	for (const delta of [0.01, 1, 1]) advance(f, delta);
	assert.equal(hp - h.hp, 16, 'one direct hit plus three bounded poison ticks');
	assert.deepEqual(f.combat.statusMsg().effects, []);
	assert.equal(f.combat.status.size, 0);
});

test('frost slows without freezing, does not stack to immobilization and expires on server time', () => {
	const f = encounter({ frost: 1 });
	const h = f.heroes[0], hp = h.hp;
	fire(f, 'frost');
	assert.equal(hp - h.hp, 5);
	close(f.combat.heroSpeedMul(h), 0.82, 'base frost slow');
	const attack = f.combat.attack(f.carrier, 'frost');
	for (let i = 0; i < 20; i++) f.combat.chill(h, attack);
	assert.ok(f.combat.heroSpeedMul(h) >= 1 - HORDE_COMBAT.slowCap);
	assert.equal(f.combat.statusMsg().effects[0].chillUntil, 4.5);
	advance(f, 2.49);
	assert.ok(f.combat.heroSpeedMul(h) > 0 && f.combat.heroSpeedMul(h) < 1);
	advance(f, 0.01);
	assert.equal(f.combat.heroSpeedMul(h), 1);
	assert.deepEqual(f.combat.statusMsg().effects, []);
});

test('storm warns for 1.2 seconds, hops once to a different hero and cannot hit either twice', () => {
	const f = encounter({ storm: 1 }, {}, 3);
	const hp = f.heroes.map((h) => h.hp);
	for (const h of f.heroes) h.x = 100 + (h.pid - 2) * 80;
	fire(f, 'storm', 0);
	assert.ok(f.room.fx.some((fx) => fx[0] === 'warn' && fx[4] >= 1.2));
	assert.deepEqual(f.heroes.map((h) => h.hp), hp);
	advance(f, 1.199);
	assert.deepEqual(f.heroes.map((h) => h.hp), hp);
	advance(f, 3.2 - f.room.time);
	assert.deepEqual(f.heroes.map((h, i) => hp[i] - h.hp), [8, 0, 0]);
	advance(f, 1.2);
	assert.deepEqual(f.heroes.map((h, i) => hp[i] - h.hp), [8, 8, 0]);
	advance(f, 1.2);
	assert.equal(f.combat.events.length, 0);
	assert.deepEqual(f.heroes.map((h, i) => hp[i] - h.hp), [8, 8, 0]);
});

test('arbalest fires a real two-arrow fan and ordinary iframes prevent simultaneous double damage', () => {
	const f = encounter({ arbalest: 1 });
	const h = f.heroes[0], hp = h.hp;
	f.combat.cast('arbalest', f.combat.units());
	assert.equal(f.combat.shots.length, 2);
	assert.ok(f.combat.shots[0].vy < 0 && f.combat.shots[1].vy > 0);
	f.combat.tickProjectiles(0.5);
	assert.equal(hp - h.hp, 6, 'two overlapping arrows use the ordinary hit protection');
	assert.equal(f.combat.shots.length, 0, 'collided shots are consumed even during iframes');
});

test('ember uses the real death hook once, warns, damages nearby heroes and respects the army cooldown', () => {
	const f = encounter({ ember: 1 });
	const h = f.heroes[0], hp = h.hp;
	const resource = f.mode.resource, count = f.room.enemies.length;
	f.room.killEnemy(f.carrier, h, raw);
	f.room.killEnemy(f.carrier, h, raw);
	assert.equal(f.combat.events.length, 1);
	assert.equal(h.hp, hp);
	assert.equal(f.mode.resource, resource, 'death never generates director resource');
	assert.equal(f.room.enemies.length, count, 'death never creates new generations of carriers');
	const second = f.cohort[1]; second.x = 0; second.y = 0;
	f.room.killEnemy(second, h, raw);
	assert.equal(f.combat.events.length, 1, 'a second carrier death cannot bypass the shared cooldown');
	advance(f, 1.199);
	assert.equal(h.hp, hp);
	advance(f, 3.2 - f.room.time);
	assert.equal(hp - h.hp, 10);
	assert.equal(f.combat.events.length, 0);
});

test('reaper requires a live carrier through windup and gains damage against an actually chilled target', () => {
	const dead = encounter({ reaper: 1 });
	const hp = dead.heroes[0].hp;
	fire(dead, 'reaper', 0);
	dead.room.killEnemy(dead.carrier, dead.heroes[0], raw);
	advance(dead, 1.2);
	assert.equal(dead.heroes[0].hp, hp, 'killing the preparing carrier cancels its area hit');
	const f = encounter({ frost: 1, reaper: 1 });
	const h = f.heroes[0], before = h.hp;
	fire(f, 'frost');
	fire(f, 'reaper', 0);
	advance(f, 1.2);
	assert.equal(before - h.hp, 20, 'five frost damage plus a 25% stronger twelve-damage reaper hit');
});

test('weapon levels add 35% each and never compound across real projectile damage', () => {
	for (const [level, expected] of [[1, 4], [2, 5.4], [3, 6.8]]) {
		const f = encounter({ venom: level });
		const h = f.heroes[0], hp = h.hp;
		fire(f, 'venom');
		close(hp - h.hp, expected, `venom level ${level}`);
	}
});

test('lens extends actual firing range and projectile speed; volley adds a third arrow with reduced per-arrow damage', () => {
	const bare = encounter({ arbalest: 1 });
	bare.heroes[0].x = 550;
	fire(bare, 'arbalest', 0);
	assert.equal(bare.combat.shots.length, 0, 'base arbalest cannot reach this hero');
	const f = encounter({ arbalest: 1 }, { lens: 1 });
	f.heroes[0].x = 550;
	fire(f, 'arbalest', 0);
	assert.equal(f.combat.shots.length, 3, 'the volley synergy changes the real fan');
	close(Math.hypot(f.combat.shots[1].vx, f.combat.shots[1].vy), 324, 'lens projectile speed');
	const hp = f.heroes[0].hp;
	f.combat.tickProjectiles(1.7);
	close(hp - f.heroes[0].hp, 4.8, 'volley damage is 80% per arrow');
});

test('hourglass extends real chill/poison lifetimes and fever strengthens poison only while the target is chilled', () => {
	const f = encounter({ venom: 1, frost: 1 }, { hourglass: 1 });
	const h = f.heroes[0];
	fire(f, 'frost');
	advance(f, 0.5);
	fire(f, 'venom');
	const hp = h.hp;
	advance(f, 1);
	close(hp - h.hp, 5.4, 'fever gives the real poison tick +35% against chill');
	advance(f, 1.1);
	close(f.combat.heroSpeedMul(h), 0.82, 'hourglass chill still lasts after the base 2.5s');
	advance(f, 0.4);
	assert.equal(f.combat.heroSpeedMul(h), 1);
	const beforePlainTick = h.hp;
	advance(f, 0.5);
	close(beforePlainTick - h.hp, 4, 'poison loses the fever multiplier after chill expires');
	assert.ok(f.combat.statusMsg().effects[0].poisonUntil > f.room.time, 'extended poison still remains after three seconds');
});

test('powder enlarges a real death blast and storm hop distance', () => {
	for (const powder of [0, 3]) {
		const f = encounter({ ember: 1 }, powder ? { powder } : {});
		const h = f.heroes[0]; h.x = 180;
		const hp = h.hp;
		f.room.killEnemy(f.carrier, h, raw);
		advance(f, 1.2);
		assert.equal(hp - h.hp, powder ? 10 : 0, 'powder makes an out-of-base-radius blast reach the hero');
	}
	const f = encounter({ storm: 1 }, { powder: 3 }, 2);
	f.heroes[1].x = 300; // 200 apart: outside the base 160 hop, inside the powder range.
	fire(f, 'storm', 0);
	advance(f, 1.2); advance(f, 1.2);
	assert.equal(f.heroes[1].maxHp - f.heroes[1].hp, 8);
});

test('conductor increases solo damage, warns a bounded secondary and shares its three-second cooldown', () => withRandom(0, () => {
	const f = encounter({ arbalest: 1 }, { conductor: 3 }, 3);
	const [a, b, c] = f.heroes;
	const before = f.heroes.map((h) => h.hp);
	fire(f, 'arbalest');
	close(before[0] - a.hp, 6.9, 'conductor has a useful damage effect even on the primary');
	assert.equal(f.combat.events.length, 1, 'a two-arrow volley cannot schedule two secondaries');
	assert.equal(b.hp, before[1], 'secondary has a warning rather than instant hidden damage');
	advance(f, 1.2);
	close(before[1] - b.hp, 3.45, 'secondary deals a single half-strength hit');
	assert.equal(c.hp, before[2]);
	assert.equal(f.combat.events.length, 0, 'secondary never calls the projectile-hit recursion');
	const attack = f.combat.attack(f.carrier, 'arbalest');
	f.combat.conductor(a, attack, 1);
	assert.equal(f.combat.events.length, 0, 'the army-wide conductor cooldown remains active');
	advance(f, 1.8);
	f.combat.conductor(a, attack, 1);
	assert.equal(f.combat.events.length, 1, 'the same army can proc again at three seconds');
}));

test('hunter uses real debuffs; idol requires an actually injured carrier; tether counts distinct nearby manual families', () => {
	const hunter = encounter({ frost: 1, reaper: 1 }, { hunter: 1 });
	const h = hunter.heroes[0];
	fire(hunter, 'frost');
	const hp = h.hp;
	fire(hunter, 'reaper', 0);
	advance(hunter, 1.2);
	close(hp - h.hp, 17.25, 'hunter multiplies the real weakened-target reaper hit');
	for (const injured of [false, true]) {
		const f = encounter({ venom: 1 }, { idol: 3 });
		if (injured) f.room.hurtEnemy(f.carrier, f.carrier.maxHp * 0.51, f.heroes[0], raw);
		const before = f.heroes[0].hp;
		fire(f, 'venom');
		close(before - f.heroes[0].hp, injured ? 5.8 : 4, 'idol checks the carrier health condition');
	}
	for (const count of [0, 1, 3]) {
		const f = encounter({ venom: 1 }, { tether: 3 }, 1, { swarm: 1, brutes: 1, ranged: 1, wisps: 1 });
		for (const pack of ['brutes', 'ranged', 'wisps'].slice(0, count)) {
			const cohort = purchase(f.room, pack);
			cohort.forEach((e) => { e.x = -100; e.y = 0; });
		}
		const hp = f.heroes[0].hp;
		fire(f, 'venom');
		close(hp - f.heroes[0].hp, [4, 4.72, 0, 6.16][count], `tether with ${count} distinct nearby families`);
	}
});

test('carapace is a one-use actual damage barrier and does not protect ambient enemies or bosses', () => {
	const f = encounter({}, { carapace: 2 });
	const e = f.carrier, h = f.heroes[0], hp = e.hp, barrier = e.hordeBarrier;
	assert.ok(barrier > 0);
	assert.equal(f.room.hurtEnemy(e, barrier / 2, h, raw), 0);
	assert.equal(e.hp, hp);
	close(e.hordeBarrier, barrier / 2, 'first absorbed damage spends barrier');
	f.room.hurtEnemy(e, barrier / 2 + 1, h, raw);
	close(e.hp, hp - 1, 'overflow reaches HP');
	assert.equal(e.hordeBarrier, 0);
	f.room.hurtEnemy(e, 1, h, raw);
	close(e.hp, hp - 2, 'spent barrier never refreshes');
	for (const type of ['bat', 'boss']) {
		const other = f.room.spawnEnemy(type, f.heroes, 1, [0, 0]);
		other.hordeBarrier = 100;
		const before = other.hp;
		f.room.hurtEnemy(other, 2, h, raw);
		assert.equal(before - other.hp, 2, `${type} cannot use a manual-army barrier`);
	}
});

test('march changes real movement once per unit near another family and ignores background/boss carriers', () => withRandom(0.5, () => {
	const distances = [];
	for (const march of [0, 3]) {
		const f = encounter({}, march ? { march } : {}, 1, { swarm: 1, brutes: 1 });
		const support = purchase(f.room, 'brutes');
		support.forEach((e) => { e.x = -100; e.y = 0; });
		f.heroes[0].x = 500;
		f.room.moveEnemies(0.1, f.heroes);
		distances.push(f.carrier.x);
		close(f.combat.unitSpeedMul(f.carrier), march ? 1.18 : 1, 'a crowd of holders supplies one aura');
		const ambient = f.room.spawnEnemy('bat', f.heroes, 1, [-100, 100]);
		const boss = f.room.spawnEnemy('boss', f.heroes, 1, [-100, -100]);
		assert.equal(f.combat.unitSpeedMul(ambient), 1);
		assert.equal(f.combat.unitSpeedMul(boss), 1);
	}
	close(distances[1] / distances[0], 1.18, 'march affects actual enemy movement');
}));

test('censer extends primary poison, infects one warned neighbor and never spreads recursively', () => {
	const f = encounter({ venom: 1 }, { censer: 1 }, 3);
	const [a, b, c] = f.heroes, before = f.heroes.map((h) => h.hp);
	fire(f, 'venom');
	close(f.combat.statusMsg().effects[0].poisonUntil, 5.3, 'censer extends poison even in solo');
	assert.equal(f.combat.events.length, 1);
	advance(f, 1.2);
	assert.equal(before[1] - b.hp, 1, 'neighbor takes the warned quarter-strength initial dose');
	assert.equal(c.hp, before[2]);
	assert.equal(f.combat.status.get(b.pid).poison.length, 1);
	assert.equal(f.combat.events.length, 0);
	const beforeDose = b.hp;
	advance(f, 1);
	assert.equal(beforeDose - b.hp, 2, 'secondary poison has half the original stack damage');
	assert.equal(c.hp, before[2]);
	assert.equal(f.combat.events.length, 0, 'infected neighbors do not create further infections');
	assert.ok(a.hp < before[0]);
});

test('conduit adds a distinct third hop and expands the real solo warning radius', () => {
	const f = encounter({ storm: 1 }, { conductor: 1 }, 3);
	const hp = f.heroes.map((h) => h.hp);
	fire(f, 'storm', 0);
	for (let i = 0; i < 3; i++) advance(f, 1.2);
	f.heroes.forEach((h, i) => close(hp[i] - h.hp, 8.4, `conduit hits hero ${i} exactly once`));
	assert.equal(f.combat.events.length, 0);
	for (const synergy of [false, true]) {
		const solo = encounter({ storm: 1 }, synergy ? { conductor: 1 } : {});
		const h = solo.heroes[0], before = h.hp;
		fire(solo, 'storm', 0);
		h.x += 70; // Outside base radius+hero size (62), inside conduit radius+hero size (74).
		advance(solo, 1.2);
		close(before - h.hp, synergy ? 8.4 : 0, 'solo conduit changes the actual dodge boundary');
	}
});

test('cremation repeats once at 45% with its own full warning and pursuit extends reach/reduces real cooldown', () => {
	const f = encounter({ ember: 1 }, { powder: 1 });
	const h = f.heroes[0], hp = h.hp;
	f.room.killEnemy(f.carrier, h, raw);
	advance(f, 1.2);
	assert.equal(hp - h.hp, 10);
	assert.equal(f.combat.events.length, 1);
	assert.ok(f.room.fx.filter((fx) => fx[0] === 'warn' && fx[4] >= 1.2).length >= 3, 'purchase, initial blast and repeat all warn');
	advance(f, 1.199);
	assert.equal(hp - h.hp, 10);
	advance(f, 0.001);
	close(hp - h.hp, 14.5, 'the repeat has 45% damage');
	assert.equal(f.combat.events.length, 0, 'second pulse does not create a third');
	const bare = encounter({ reaper: 1 }); bare.heroes[0].x = 160;
	fire(bare, 'reaper', 0);
	assert.equal(bare.combat.events.length, 0);
	const pursuit = encounter({ reaper: 1 }, { march: 1 }, 1, { swarm: 1, brutes: 1 });
	pursuit.heroes[0].x = 160;
	fire(pursuit, 'reaper', 0);
	assert.equal(pursuit.combat.events.length, 1);
	assert.equal(pursuit.combat.cooldowns.get('reaper'), pursuit.room.time + 4);
	advance(pursuit, 1.2);
	assert.equal(pursuit.heroes[0].maxHp - pursuit.heroes[0].hp, 12);
});

test('three poison stacks combine into one ordinary hit respecting armor, ward and iframes', () => {
	const f = encounter({ venom: 1 });
	const h = f.heroes[0], attack = f.combat.attack(f.carrier, 'venom');
	h.passives.set('mail', 2); f.room.recalcMods(h);
	for (let i = 0; i < 20; i++) f.combat.poison(h, attack);
	assert.equal(f.combat.status.get(h.pid).poison.length, 3);
	const hp = h.hp;
	advance(f, 1);
	assert.equal(hp - h.hp, 10, '12 combined poison damage pays armor once, not once per stack');
	const after = h.hp;
	f.combat.hit(h, attack);
	assert.equal(h.hp, after, 'the poison hit opens the normal iframe window');
	h.ward = 1;
	advance(f, 1);
	assert.equal(h.ward, 0);
	assert.equal(h.hp, after, 'one ward absorbs the combined poison hit');
	advance(f, 1);
	assert.equal(h.hp, after - 10);
	assert.equal(f.combat.status.size, 0);
});

test('a ward-blocked projectile applies no poison/chill and down/offline clears actual status for reconnect', () => {
	for (const id of ['venom', 'frost']) {
		const f = encounter({ [id]: 1 });
		const h = f.heroes[0], hp = h.hp;
		h.ward = 1;
		fire(f, id);
		assert.equal(h.hp, hp);
		assert.equal(h.ward, 0);
		assert.equal(f.combat.status.size, 0, `${id} cannot apply a status through a blocked hit`);
	}
	const f = encounter({ venom: 1, frost: 1 }, {}, 2);
	const h = f.heroes[0];
	fire(f, 'venom'); advance(f, 0.5); fire(f, 'frost');
	assert.ok(f.combat.status.has(h.pid));
	f.room.setOffline(h.pid, true);
	assert.equal(f.combat.status.has(h.pid), false);
	f.room.resync(h.pid);
	const status = f.messages.findLast(({ pid, msg }) => pid === h.pid && msg.t === 'horde-status').msg;
	assert.ok(status.effects.every((effect) => effect.pid !== h.pid));
});

test('cultists heal only manual units once per four seconds using the strongest nearby level', () => {
	const f = encounter({}, {}, 1, { swarm: 1, cultists: 5 });
	f.room.time = 80;
	const cultists = purchase(f.room, 'cultists');
	cultists.forEach((e) => { e.x = 100; e.y = 100; });
	const ambient = f.room.spawnEnemy('brute', f.heroes, 1, [0, 0]);
	const boss = f.room.spawnEnemy('boss', f.heroes, 1, [0, 0]);
	for (const e of [f.carrier, ambient, boss]) f.room.hurtEnemy(e, e.maxHp * 0.5, f.heroes[0], raw);
	const before = [f.carrier, ambient, boss].map((e) => e.hp);
	f.combat.tick(0);
	close(f.carrier.hp - before[0], f.carrier.maxHp * 0.07, 'many level-five cultists give one seven-percent heal');
	assert.equal(ambient.hp, before[1]); assert.equal(boss.hp, before[2]);
	const healed = f.carrier.hp;
	advance(f, 3.999);
	assert.equal(f.carrier.hp, healed);
	advance(f, 0.001);
	close(f.carrier.hp - healed, f.carrier.maxHp * 0.07, 'heal becomes available exactly four seconds later');
});

test('background enemies, bosses, frozen and far-away units cannot cast army weapons or trigger death weapons', () => {
	for (const kind of ['ambient', 'boss', 'frozen', 'far']) {
		const f = encounter({ venom: 1, ember: 1 });
		if (kind === 'ambient') f.carrier.hordeSource = 'ambient';
		if (kind === 'boss') f.carrier.boss = true;
		if (kind === 'frozen') f.carrier.frozenT = f.room.time + 10;
		if (kind === 'far') f.carrier.x = -1000;
		f.combat.tick(0);
		assert.equal(f.combat.shots.length, 0, `${kind} cannot cast`);
		if (kind === 'ambient' || kind === 'boss') {
			f.room.killEnemy(f.carrier, f.heroes[0], raw);
			assert.equal(f.combat.events.length, 0, `${kind} cannot trigger army death effects`);
		}
	}
	const distant = encounter({ ember: 1 });
	distant.carrier.x = -1700; distant.heroes[0].x = 1700;
	const ambient = distant.room.spawnEnemy('bat', distant.heroes, 1, [-1700, 0]);
	ambient.hordeSource = 'ambient';
	distant.mode.retireFar(distant.heroes);
	assert.equal(distant.carrier.dead, false, 'distance never retires a paid weapon carrier');
	assert.equal(ambient.dead, true, 'background pressure may still retire far away');
	assert.equal(distant.combat.events.length, 0, 'distance management is not a combat death');
});

test('180 real carriers keep army-wide cooldowns, a three-proc tick budget and fair access to all four weapons', () => withRandom(0.5, () => {
	const f = encounter({ venom: 1, frost: 1, storm: 1, arbalest: 1 });
	for (let i = 1; i < 15; i++) purchase(f.room, 'swarm');
	const units = f.combat.units();
	assert.equal(units.length, 180);
	units.forEach((e, i) => { e.x = -i / 10; e.y = 0; });
	f.heroes[0].x = 100;
	const counts = new Map(), last = new Map();
	for (let tick = 0; tick < 600; tick++) {
		advance(f, 1 / 60, 1 / 60);
		assert.ok(f.combat.procs <= HORDE_COMBAT.maxProcsPerTick);
		for (const [id, at] of f.combat.cooldowns) if (last.get(id) !== at) { counts.set(id, (counts.get(id) ?? 0) + 1); last.set(id, at); }
	}
	assert.deepEqual(Object.fromEntries(counts), { frost: 2, storm: 2, arbalest: 3, venom: 3 }, '180 carriers get the same cast count as one army, with no fourth-weapon starvation');
	assert.ok(f.heroes[0].hp < f.heroes[0].maxHp && f.heroes[0].hp > 0, 'real travel and status effects deal bounded damage during the pressure sample');
	assert.ok(f.combat.shots.length <= HORDE_COMBAT.maxHostile);
}));

test('hostile projectile budget rejects a partial fan without spending its cooldown and later recovers', () => {
	const f = encounter({ arbalest: 1 });
	const attack = f.combat.attack(f.carrier, 'arbalest');
	for (let i = 0; i < HORDE_COMBAT.maxHostile - 1; i++) assert.equal(f.combat.projectile(f.carrier, f.heroes[0], attack), true);
	f.combat.cast('arbalest', f.combat.units());
	assert.equal(f.combat.shots.length, HORDE_COMBAT.maxHostile - 1);
	assert.equal(f.combat.cooldowns.has('arbalest'), false, 'an incomplete volley cannot spend the army cooldown');
	assert.equal(f.combat.projectile(f.carrier, f.heroes[0], attack), true);
	assert.equal(f.combat.projectile(f.carrier, f.heroes[0], attack), false);
	f.combat.tickProjectiles(4);
	assert.equal(f.combat.shots.length, 0, 'expired projectiles release all budget');
	f.combat.cast('arbalest', f.combat.units());
	assert.equal(f.combat.shots.length, 2);
});
