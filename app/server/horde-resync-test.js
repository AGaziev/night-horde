import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hub } from './game.js';
import { HORDE_COMBAT, HORDE_LIMITS } from '../public/shared/horde-content.js';

const raw = { weapon: 'other', tags: [], raw: true };
const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-8, `${label}: ${a} !== ${b}`);

function encounter(weapons = {}, artifacts = {}, count = 1) {
	const messages = [], hub = new Hub((pid, msg) => messages.push({ pid, msg: structuredClone(msg) }));
	for (let pid = 1; pid <= count + 1; pid++) hub.addPlayer(pid, `P${pid}`, `resync-${pid}`);
	hub.handle(1, { t: 'create', hero: 'ranger', ruleset: 'horde' });
	const room = hub.players.get(1).room;
	for (let pid = 2; pid <= count + 1; pid++) hub.handle(pid, { t: 'join', code: room.code, hero: 'ranger' });
	hub.handle(1, { t: 'start' });
	const mode = room.horde, combat = mode.combat;
	mode.build.weapons = { ...weapons }; mode.build.artifacts = { ...artifacts };
	const heroes = [...room.heroes.values()];
	return { hub, room, mode, combat, heroes, messages };
}

function purchase(f) {
	f.hub.handle(1, { t: 'horde', roundId: f.mode.roundId, action: 'spawn', pack: 'swarm', x: -1100, y: 0, seq: f.mode.lastSeq + 1 });
	assert.equal(f.mode.pending.length, 1, 'fixture uses an actual paid order');
	f.room.time = f.mode.pending[0].at;
	f.mode.tick(0, f.heroes);
	const cohort = f.combat.units();
	cohort.forEach((e) => { e.x = -1100; e.y = 0; });
	const carrier = cohort[0]; carrier.x = 0; carrier.y = 0;
	f.heroes.forEach((h, i) => { h.x = 100 + 80 * i; h.y = 0; });
	return carrier;
}

function stateSentTo(f, pid, reconnect = false) {
	const before = f.messages.length;
	if (reconnect) f.hub.welcome(pid); // Session replacement without an offline/death transition.
	else f.hub.handle(pid, { t: 'join', code: f.room.code });
	const frames = f.messages.slice(before).filter((m) => m.pid === pid).map((m) => m.msg);
	const state = frames.find((m) => m.t === 'horde-resync');
	assert.ok(state, 'Hub rejoin/reconnect sends authoritative combat state');
	assert.ok(frames.findIndex((m) => m.t === 'start') < frames.indexOf(state), 'combat resync follows the client reset');
	assert.equal(state.roundId, f.mode.roundId); assert.equal(state.time, f.room.time);
	assert.ok(!('resource' in state) && !('offer' in state), 'combat resync exposes no private wallet/draft');
	return state;
}

test('Hub join and live session replacement restore only the remaining paid warning', () => {
	const f = encounter();
	f.hub.handle(1, { t: 'horde', roundId: f.mode.roundId, action: 'spawn', pack: 'swarm', x: 1100, y: 0, seq: 1 });
	const warning = HORDE_LIMITS.warning + HORDE_LIMITS.preparation;
	f.room.time = 0.7;
	for (const reconnect of [false, true]) {
		const state = stateSentTo(f, f.heroes[0].pid, reconnect);
		assert.deepEqual(state.warnings, [{ x: 1100, y: 0, r: 88, remaining: warning - 0.7 }]);
		assert.deepEqual(state.shots, []);
		assert.equal(f.heroes[0].st, 0, 'restoration does not drop the live hero');
	}
	f.room.time = 1.5;
	close(stateSentTo(f, 2).warnings[0].remaining, 0.5, 'repeated resync cannot restart the warning clock');
	f.room.time = warning;
	f.mode.tick(0, f.heroes);
	assert.deepEqual(stateSentTo(f, 2).warnings, [], 'born cohorts no longer have a spawn warning');
});

test('storm windup survives Hub resync and expires at the original damaging deadline', () => {
	const f = encounter({ storm: 1 }), carrier = purchase(f), hero = f.heroes[0], hp = hero.hp;
	f.combat.cast('storm', f.combat.units());
	const deadline = f.room.time + HORDE_COMBAT.warning;
	f.room.time += 0.5;
	let state = stateSentTo(f, hero.pid, true);
	assert.deepEqual(state.warnings, [{ x: hero.x, y: hero.y, r: 48, remaining: deadline - f.room.time }]);
	assert.ok(carrier && state.warnings[0].remaining < HORDE_COMBAT.warning);
	f.room.time = deadline - 0.001; f.combat.tick(0);
	assert.equal(hero.hp, hp);
	f.room.time = deadline; f.combat.tick(0);
	assert.equal(hp - hero.hp, 8);
	state = stateSentTo(f, hero.pid);
	assert.deepEqual(state.warnings, [], 'fired single-target storm has no stale warning');
});

test('travelled army and native projectiles restore their actual current position and remaining life', () => {
	const f = encounter({ venom: 1 }); purchase(f);
	f.combat.cast('venom', f.combat.units());
	f.combat.tickProjectiles(0.1); f.room.time += 0.1;
	const native = f.room.spawnEnemy('spitter', f.heroes, 1, [-250, 100]);
	f.room.fireHostile(native, f.heroes[0]);
	f.room.updateHostile(0.1); f.room.time += 0.1;
	const active = [...f.combat.shots, ...f.room.hostile];
	const state = stateSentTo(f, 2);
	assert.equal(state.shots.length, 2);
	for (const shot of active) {
		assert.deepEqual(state.shots.find((s) => s.id === shot.id), {
			id: shot.id, x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy, remaining: shot.life, r: shot.r ?? 7,
		});
	}
	assert.ok(state.shots[0].x > 0 && state.shots[0].remaining < 2, 'resync does not replay the original launch');
	f.combat.tickProjectiles(0.5);
	assert.equal(f.combat.shots.length, 0);
	assert.ok(!stateSentTo(f, 2, true).shots.some((s) => s.id === active[0].id), 'a hit projectile is never resurrected');
	f.room.updateHostile(4);
	assert.deepEqual(stateSentTo(f, 2).shots, [], 'expired native projectiles are absent');
});

test('reaper, ember and secondary delayed effects retain warning geometry and cannot extend on repeated resync', () => {
	for (const id of ['reaper', 'ember', 'conductor', 'censer']) {
		const weapon = id === 'conductor' || id === 'censer' ? 'venom' : id;
		const f = encounter({ [weapon]: 1 }, id === 'conductor' || id === 'censer' ? { [id]: 3 } : {}, 2);
		const carrier = purchase(f), attack = f.combat.attack(carrier, weapon);
		if (id === 'ember') f.room.killEnemy(carrier, f.heroes[0], raw);
		else if (id === 'conductor') {
			const random = Math.random; Math.random = () => 0;
			try { f.combat.conductor(f.heroes[0], attack, 1); } finally { Math.random = random; }
		} else if (id === 'censer') f.combat.censer(f.heroes[0], attack);
		else f.combat.cast(id, f.combat.units());
		assert.equal(f.combat.events.length, 1, `${id} fixture schedules a real warned attack`);
		const deadline = f.combat.events[0].at;
		f.room.time += 0.4;
		let state = stateSentTo(f, 2);
		assert.equal(state.warnings.length, 1, `${id} keeps its warned geometry`);
		close(state.warnings[0].remaining, deadline - f.room.time, `${id} original deadline`);
		f.room.time += 0.3;
		state = stateSentTo(f, 2, true);
		close(state.warnings[0].remaining, deadline - f.room.time, `${id} remaining clock shrinks`);
		if (id === 'reaper') {
			f.room.killEnemy(carrier, f.heroes[0], raw);
			assert.deepEqual(stateSentTo(f, 2).warnings, [], 'cancelled reaper windup is not an active warning');
		}
	}
});

test('native damaging blasts restore remaining warnings and fxBefore snapshots only the pre-resync queue', () => {
	const f = encounter();
	f.room.addBlast(40, 50, 60, 8, 0, null, 1, 1.2);
	f.room.addBlast(-40, -50, 70, 0, 8, null, 0, 1.2); // Hero weapon: not a hostile warning.
	f.room.time = 0.4;
	const state = stateSentTo(f, 2);
	assert.deepEqual(state.warnings, [{ x: 40, y: 50, r: 60, remaining: 1.2 - 0.4 }]);
	assert.deepEqual(state.fxBefore, f.room.fx);
	assert.notEqual(state.fxBefore, f.room.fx);
	assert.notEqual(state.fxBefore[0], f.room.fx[0]);
	f.room.fx.push(['warn', 500, 0, 48, 1.2]);
	assert.equal(state.fxBefore.length, 1, 'new events after the boundary remain visible in the next snapshot');
	f.room.time = 1.2;
	f.room.updateBlasts();
	assert.deepEqual(stateSentTo(f, 2).warnings, []);
});

test('storm hops and cremation repeats serialize the current warned stage with its own original deadline', () => {
	for (const id of ['storm', 'ember']) {
		const f = encounter({ [id]: 1 }, id === 'ember' ? { powder: 1 } : {}, 2);
		const carrier = purchase(f);
		if (id === 'ember') f.room.killEnemy(carrier, f.heroes[0], raw);
		else f.combat.cast(id, f.combat.units());
		f.room.time += HORDE_COMBAT.warning; f.combat.tick(0);
		assert.equal(f.combat.events.length, 1, `${id} schedules one next warned stage`);
		const current = f.combat.events[0];
		f.room.time += 0.5;
		const state = stateSentTo(f, 2, true);
		assert.deepEqual(state.warnings, [{ ...current.warning, remaining: current.at - f.room.time }]);
		assert.ok(state.warnings[0].remaining < HORDE_COMBAT.warning, 'a later stage also retains elapsed warning time');
		if (id === 'storm') assert.equal(state.warnings[0].x, f.heroes[1].x, 'only the next hero is currently warned');
	}
});

test('native shield charges and sniper fans restore the actual remaining telegraph lanes', () => {
	const f = encounter(), hero = f.heroes[0];
	hero.x = 200; hero.y = 0;
	const shield = f.room.spawnEnemy('shield', f.heroes, 1, [0, 0]);
	shield.dcd = 0;
	assert.equal(f.room.dashTick(shield, hero, 200, 0, true), true);
	const sniper = f.room.spawnEnemy('sniper', f.heroes, 1, [-300, 0]);
	sniper.shotT = 0;
	assert.equal(f.room.sniperTick(sniper, hero, 500, 0), true);
	const emitted = f.room.fx.filter((e) => e[0] === 'bline');
	assert.equal(emitted.length, 6, 'fixture creates a real shield lane and five real sniper lanes');
	f.room.time += 0.2;
	f.room.dashTick(shield, hero, 200, 0.2, true);
	f.room.sniperTick(sniper, hero, 500, 0.2);
	const state = stateSentTo(f, 2);
	assert.equal(state.lanes.length, emitted.length);
	state.lanes.forEach((lane, i) => {
		assert.deepEqual([lane.x1, lane.y1, lane.x2, lane.y2, lane.w].map(Math.round), emitted[i].slice(1, 6), 'resync geometry matches the actual native telegraph');
		close(lane.remaining, emitted[i][6] - 0.2, 'native remaining windup is not restarted');
	});
	shield.dead = sniper.dead = true;
	assert.deepEqual(stateSentTo(f, 2, true).lanes, [], 'dead native carriers do not leave active aim lanes');
});
