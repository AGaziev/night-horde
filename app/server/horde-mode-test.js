import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hub, Room } from './game.js';
import { runStore } from './runlog.js';
import { ENEMIES, enemyHpScale, enemyDmgScale } from '../public/shared/content.js';
import {
	HORDE_ARENA, HORDE_BOSS_AT, HORDE_SECONDS, HORDE_BUILD, HORDE_ECONOMY, HORDE_LIMITS,
	HORDE_PACKS, HORDE_WEAPONS, HORDE_ARTIFACTS,
} from '../public/shared/horde-content.js';

function encounter(count = 1, start = true) {
	const messages = [];
	const hub = new Hub((pid, msg) => messages.push({ pid, msg: structuredClone(msg) }));
	for (let pid = 1; pid <= count + 1; pid++) hub.addPlayer(pid, `P${pid}`, `horde-test-${pid}`);
	hub.handle(1, { t: 'create', hero: 'ranger', ruleset: 'horde' });
	const room = hub.players.get(1).room;
	for (let pid = 2; pid <= count + 1; pid++) hub.handle(pid, { t: 'join', code: room.code, hero: 'ranger' });
	if (start) hub.handle(1, { t: 'start' });
	return { hub, room, mode: room.horde, messages, heroes: [...room.heroes.values()] };
}

function command(room, data, pid = room.directorPid) {
	room.handle(pid, { t: 'horde', seq: room.horde.lastSeq + 1, ...data });
}

function due(room, at = room.time + 2) {
	room.time = at;
	room.horde.tick(0, [...room.heroes.values()].filter((h) => h.st === 0));
}

function manual(room) { return room.enemies.filter((e) => !e.dead && e.hordeSource === 'manual'); }
function close(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} !== ${expected}`); }

test('Hub enforces one director, 1–4 distinct heroes, role changes and hero-only start composition', () => {
	const { hub, room, messages } = encounter(0, false);
	hub.handle(1, { t: 'start' });
	assert.equal(room.state, 'lobby', 'a director alone cannot start');
	for (let pid = 2; pid <= 6; pid++) {
		hub.addPlayer(pid, `P${pid}`, `horde-test-${pid}`);
		hub.handle(pid, { t: 'join', code: room.code, hero: 'ranger' });
	}
	assert.equal(room.size, 5);
	assert.equal(hub.players.get(6).room, null, 'sixth participant is rejected');
	hub.addPlayer(7, 'Same user', 'horde-test-1');
	hub.handle(7, { t: 'join', code: room.code });
	assert.equal(hub.players.get(7).room, null);
	assert.ok(room.setRole(2, 'director'), 'a second director cannot take an occupied role');
	assert.equal(room.setRole(1, 'hero'), null);
	hub.handle(1, { t: 'start' });
	assert.equal(room.state, 'lobby', 'five heroes without a director cannot start');
	assert.equal(room.setRole(2, 'director'), null);
	hub.handle(1, { t: 'start' });
	assert.equal(room.state, 'play');
	assert.equal(room.directorPid, 2);
	assert.deepEqual([...room.heroes.keys()], [1, 3, 4, 5]);
	assert.equal(room.heroCount, 4);
	assert.equal(room.runLength, HORDE_SECONDS);
	const start = messages.findLast(({ msg }) => msg.t === 'start').msg;
	assert.deepEqual(start.players.map((h) => h.pid), [1, 3, 4, 5]);
	assert.equal(start.directorPid, 2);
	assert.deepEqual(start.arena, HORDE_ARENA);
	assert.ok(room.setRole(3, 'director'), 'roles are locked during the run');
	assert.deepEqual(hub.busy(), { playing: 1, players: 4, online: 7, scheduled: 0 });
});

test('duplicate identities are rejected both on join and when switching an existing PvE lobby', () => {
	const room = new Room('UIDS', () => {});
	room.addPlayer(1, 'One', 'ranger', null, 10);
	room.addPlayer(2, 'Two', 'ranger', null, '10');
	assert.ok(room.setRuleset('horde'));
	assert.equal(room.ruleset, 'pve');
	room.removePlayer(2);
	assert.equal(room.setRuleset('horde'), null);
	assert.ok(room.addPlayer(3, 'Duplicate', 'ranger', null, '10'));
	assert.equal(room.size, 1, 'identity rejection must precede membership mutation');
});

test('director is absent from enemy scaling and Horde offers/menu never pause solo heroes', () => {
	for (const count of [1, 4]) {
		const { room, heroes } = encounter(count);
		room.time = 100;
		const e = room.spawnEnemy('brute', heroes, enemyHpScale(room.nt, room.heroes.size), [1000, 0]);
		close(e.maxHp, ENEMIES.brute.hp * enemyHpScale(100, count), 'hero-only enemy HP');
		close(e.dmg, ENEMIES.brute.dmg * enemyDmgScale(100, count), 'hero-only enemy damage');
		const h = heroes[0];
		room.grantOffer(h);
		room.handle(h.pid, { t: 'pause', v: true });
		assert.ok(h.offer);
		assert.equal(room.isSolo(), false);
		assert.equal(room.frozen, false);
		room.step(0.01);
		assert.equal(room.time, 100.01, 'time advances through the hero offer and director draft');
	}
	const pve = new Room('PVE', () => {});
	pve.addPlayer(1, 'One', 'ranger'); pve.start();
	pve.grantOffer(pve.heroes.get(1));
	pve.updateFrozen(); // The regular tick refreshes pause state after granting rewards.
	assert.equal(pve.frozen, true, 'ordinary solo PvE still pauses for its offer');
	pve.step(1);
	assert.equal(pve.time, 0);
});

test('Room authorizes director commands and strict seq acknowledges failed, replayed and stale requests', () => {
	const { room, mode, heroes: [h], messages } = encounter();
	const initial = mode.resource;
	command(room, { action: 'spawn', pack: 'swarm', x: 1000, y: 0 }, h.pid);
	assert.equal(mode.lastSeq, 0);
	assert.equal(mode.resource, initial);
	for (const seq of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, 2]) command(room, { seq, action: 'spawn', pack: 'swarm', x: 1000, y: 0 });
	assert.equal(mode.lastSeq, 0, 'invalid and skipped sequence numbers do not advance state');
	command(room, { action: 'spawn', pack: 'swarm', x: 0, y: 0 });
	assert.equal(mode.lastSeq, 1, 'a valid next sequence is consumed even on failed purchase');
	command(room, { seq: 1, action: 'spawn', pack: 'swarm', x: 1000, y: 0 });
	assert.equal(mode.pending.length, 0, 'a failed command cannot succeed later when replayed with a safe position');
	command(room, { action: 'spawn', pack: 'swarm', x: 1000, y: 0 });
	assert.equal(mode.pending.length, 1);
	assert.equal(mode.resource, initial - HORDE_PACKS.swarm.cost);
	command(room, { seq: 2, action: 'spawn', pack: 'swarm', x: -1000, y: 0 });
	assert.equal(mode.pending.length, 1);
	const first = mode.offer;
	command(room, { action: 'reroll', offerId: first.id });
	const fresh = mode.offer;
	assert.notEqual(fresh.id, first.id);
	command(room, { action: 'pick', offerId: first.id, choice: 0 });
	assert.equal(mode.offer, fresh);
	assert.equal(mode.picksTaken, 0);
	assert.equal(mode.lastSeq, 4, 'stale offer failure is acknowledged');
	assert.ok(messages.some(({ pid, msg }) => pid === 1 && msg.t === 'err'));
	room.resync(1);
	const restored = messages.findLast(({ pid, msg }) => pid === 1 && msg.t === 'horde').msg;
	assert.equal(restored.lastSeq, 4);
	assert.equal(restored.offer.id, fresh.id);
	assert.equal(restored.queued, 1);
	assert.equal(restored.rerolls, 1);
	assert.ok(messages.filter(({ msg }) => msg.t === 'horde').every(({ pid }) => pid === 1), 'wallet, build and draft are private to the director');
});

test('draft gates unlocks, caps slots/levels and always includes an available owned upgrade', () => {
	const { room, mode } = encounter();
	const has = (kind, id) => mode.candidates().some((c) => c.kind === kind && c.id === id);
	assert.equal(has('pack', 'bombers'), false);
	assert.equal(has('pack', 'shields'), false);
	for (const id of ['lens', 'hourglass', 'powder', 'conductor', 'hunter', 'tether', 'march', 'idol', 'censer']) assert.equal(has('artifact', id), false, `${id} must have a usable dependency`);
	for (const id of ['brood', 'carapace', 'supply']) assert.equal(has('artifact', id), true);
	room.time = 80;
	assert.equal(has('pack', 'bombers'), true);
	assert.equal(has('pack', 'shields'), false);
	room.time = 160;
	assert.equal(has('pack', 'shields'), true);
	mode.build.weapons = { venom: 1 };
	mode.build.packs.brutes = 1;
	for (const id of ['lens', 'hourglass', 'conductor', 'hunter', 'tether', 'march', 'idol', 'censer']) assert.equal(has('artifact', id), true, `${id} becomes usable`);
	assert.equal(has('artifact', 'powder'), false, 'projectiles alone do not satisfy an area dependency');
	mode.build.weapons.reaper = 1;
	assert.equal(has('artifact', 'powder'), true);
	mode.build = {
		packs: { swarm: 5, brutes: 5, ranged: 5, wisps: 4 },
		weapons: { venom: 3, frost: 3, storm: 3, arbalest: 2 },
		artifacts: { lens: 3, hourglass: 3, powder: 3, conductor: 3, hunter: 3, supply: 2 },
	};
	assert.deepEqual(mode.candidates(), [
		{ kind: 'pack', id: 'wisps', level: 5 }, { kind: 'weapon', id: 'arbalest', level: 3 }, { kind: 'artifact', id: 'supply', level: 3 },
	]);
	for (let i = 0; i < 10; i++) {
		const offer = mode.makeOffer();
		assert.equal(offer.choices.length, 3);
		assert.ok(offer.choices.some((c) => c.level > 1));
		assert.equal(new Set(offer.choices.map((c) => `${c.kind}:${c.id}`)).size, 3);
	}
});

test('unpicked ranks accumulate to 22, current immutable offer survives clock/resync and rerolls are finite', () => {
	const { room, mode, messages } = encounter();
	const first = mode.offer;
	assert.equal(mode.choicesPending, 1);
	assert.ok(Object.isFrozen(first) && Object.isFrozen(first.choices) && first.choices.every(Object.isFrozen));
	assert.throws(() => { first.choices[0].level = 99; }, TypeError);
	due(room, 120);
	assert.equal(mode.rank, 4);
	assert.equal(mode.choicesPending, 4);
	assert.equal(mode.offer, first, 'new ranks must not replace an open choice');
	room.resync(1);
	assert.equal(messages.findLast(({ pid, msg }) => pid === 1 && msg.t === 'horde').msg.offer.id, first.id);
	for (let i = 0; i < 2; i++) command(room, { action: 'reroll', offerId: mode.offer.id });
	const finalReroll = mode.offer;
	command(room, { action: 'reroll', offerId: finalReroll.id });
	assert.equal(mode.rerolls, 0);
	assert.equal(mode.offer, finalReroll);
	assert.equal(mode.picksTaken, 0, 'rerolls do not consume pending ranks');
	due(room, HORDE_SECONDS);
	assert.equal(mode.rank, HORDE_BUILD.maxPicks);
	assert.equal(mode.nextRankAt, null);
	for (let i = 0; i < HORDE_BUILD.maxPicks; i++) {
		const offer = mode.offer;
		assert.ok(offer?.choices.length, `choice ${i + 1} remains available`);
		const card = offer.choices[0];
		command(room, { action: 'pick', offerId: offer.id, choice: 0 });
		assert.equal(mode.picksTaken, i + 1);
		assert.equal(mode.build[{ pack: 'packs', weapon: 'weapons', artifact: 'artifacts' }[card.kind]][card.id], card.level);
	}
	assert.equal(mode.choicesPending, 0);
	assert.equal(mode.offer, null);
	assert.equal(mode.picks.length, 22);
	assert.equal(mode.rerollHistory.length, 2);
});

test('a new round resets sequence/economy/build and rejects an offer ID from the previous round', () => {
	const { room, mode } = encounter();
	const old = mode.offer;
	command(room, { action: 'pick', offerId: old.id, choice: 0 });
	room.finish(false, 0, 'wipe');
	room.handle(1, { t: 'again' });
	room.handle(1, { t: 'start' });
	assert.notEqual(room.horde, mode);
	assert.equal(room.horde.lastSeq, 0);
	assert.equal(room.horde.resource, HORDE_ECONOMY.start);
	assert.deepEqual(room.horde.build, { packs: { swarm: 1 }, weapons: {}, artifacts: {} });
	assert.notEqual(room.horde.offer.id, old.id);
	const fresh = room.horde.offer;
	command(room, { action: 'pick', offerId: old.id, choice: 0 });
	assert.equal(room.horde.offer, fresh);
	assert.equal(room.horde.picksTaken, 0);
});

test('paid cohort snapshots preserve build, level, discount, escort population and exact warning positions at birth', () => {
	const { room, mode, heroes } = encounter(2);
	mode.build = { packs: { swarm: 3 }, weapons: { venom: 2 }, artifacts: { supply: 2, brood: 3, carapace: 2 } };
	const before = mode.resource;
	command(room, { action: 'spawn', pack: 'swarm', x: 1000, y: 0 });
	const order = mode.pending[0];
	assert.equal(order.cost, 22, '10% discount rounds the 24 resource pack up to 22');
	assert.equal(mode.resource, before - 22);
	assert.equal(order.units.length, 15);
	assert.equal(mode.privateState().population, 15, 'escorts count while still queued');
	assert.deepEqual(room.fx.find((f) => f[0] === 'warn'), ['warn', 1000, 0, 88, 2]);
	const positions = order.units.map(({ x, y }) => [x, y]);
	assert.ok(Object.isFrozen(order.build) && Object.isFrozen(order.build.weapons));
	mode.build.packs.swarm = 5; mode.build.weapons.venom = 3; mode.build.artifacts.carapace = 3; mode.build.artifacts.brood = 0;
	due(room, 1.999);
	assert.equal(manual(room).length, 0);
	due(room, 2);
	const cohort = manual(room);
	assert.equal(cohort.length, 15);
	assert.deepEqual(cohort.map(({ x, y }) => [x, y]), positions, 'birth never teleports a paid cohort away from its warning');
	for (const e of cohort) {
		assert.equal(e.hordeLevel, 3);
		assert.equal(e.hordeBuild.weapons.venom, 2);
		assert.equal(e.hordeBuild.artifacts.carapace, 2);
		close(e.maxHp, e.def.hp * enemyHpScale(2, heroes.length) * 1.32, 'additive purchased HP');
		close(e.dmg, e.def.dmg * enemyDmgScale(2, heroes.length) * 1.16, 'additive purchased damage');
		close(e.hordeBarrier, e.maxHp * 0.24, 'barrier uses paid build');
	}
	const hp = cohort[0].hp;
	mode.build.packs.swarm = 1;
	assert.equal(cohort[0].hp, hp, 'later draft changes cannot retroactively heal or strengthen an existing cohort');
});

test('spawn validation covers downed heroes, non-finite/outside positions, locked packs, queue and full escort reservations', () => {
	const { room, mode, heroes: [live, downed] } = encounter(2);
	Object.assign(downed, { x: 1000, y: 0, st: 1 });
	for (const [x, y] of [[1000, 0], [NaN, 0], [Infinity, 0], [0, NaN], [1790, 0], [-1790, 0], [0, 1190]]) {
		const resource = mode.resource;
		command(room, { action: 'spawn', pack: 'swarm', x, y });
		assert.equal(mode.pending.length, 0);
		assert.equal(mode.resource, resource);
	}
	command(room, { action: 'spawn', pack: 'brutes', x: -1000, y: 0 });
	assert.equal(mode.pending.length, 0, 'unlocked-by-time does not mean owned');
	Object.assign(downed, { x: 0, y: 50 });
	mode.resource = mode.resourceCap;
	for (let i = 0; i < 3; i++) command(room, { action: 'spawn', pack: 'swarm', x: 1000, y: i * 100 });
	assert.equal(mode.pending.length, HORDE_LIMITS.queued);
	const afterThree = mode.resource;
	command(room, { action: 'spawn', pack: 'swarm', x: -1000, y: 0 });
	assert.equal(mode.pending.length, 3);
	assert.equal(mode.resource, afterThree);
	mode.pending.length = 0;
	mode.build.artifacts.brood = 3;
	for (let i = 0; i < 166; i++) {
		const e = room.spawnEnemy('bat', [live], 1, [-1000, 0]);
		e.hordeSource = 'manual';
	}
	command(room, { action: 'spawn', pack: 'swarm', x: 1000, y: 0 });
	assert.equal(mode.pending.length, 0, '166 + 12 base + 3 escorts exceeds the manual population cap');
});

test('moving any hero into paid birth positions cancels the whole order and refunds only up to the current cap', () => {
	for (const downed of [false, true]) {
		const { room, mode, heroes: [h], messages } = encounter();
		command(room, { action: 'spawn', pack: 'swarm', x: 1000, y: 0 });
		const point = mode.pending[0].units[0];
		Object.assign(h, { x: point.x, y: point.y, st: downed ? 1 : 0 });
		mode.resource = mode.resourceCap - 1;
		due(room, 2);
		assert.equal(manual(room).length, 0);
		assert.equal(mode.pending.length, 0);
		assert.equal(mode.resource, mode.resourceCap);
		assert.ok(messages.some(({ msg }) => msg.t === 'err' && msg.msg.includes('Ресурс возвращён')));
		due(room, 3);
		assert.equal(mode.resource, mode.resourceCap, 'a cancelled order cannot refund twice');
	}
});

test('manual population preserves a separate ambient XP reserve and supply changes only wallet/cost', () => {
	const { room, mode, heroes } = encounter();
	mode.build.artifacts.supply = 3;
	assert.equal(mode.resourceCap, 240);
	mode.resource = 239;
	mode.tick(1, heroes);
	assert.equal(mode.resource, 240);
	for (let i = 0; i < HORDE_LIMITS.manual; i++) {
		const e = room.spawnEnemy('bat', heroes, 1, [1000, 0]);
		e.hordeSource = 'manual';
	}
	room.spawnAcc = 10;
	mode.ambient(0, heroes);
	const ambient = room.enemies.filter((e) => e.hordeSource === 'ambient');
	assert.equal(ambient.length, 10, 'full manual army cannot consume the background reserve');
	assert.ok(ambient.every((e) => e.xp > 0));
	assert.equal(mode.counts().manual, 180);
	assert.ok(ambient.every((e) => !e.hordeBuild && !e.hordeBarrier), 'economy artifact does not leak army buffs to background enemies');
});

test('hero departure rescales paid cohorts at their birth time and never counts director departure as a hero', () => {
	const { room, mode, heroes } = encounter(2);
	mode.build.packs.swarm = 3;
	mode.build.artifacts.carapace = 2;
	command(room, { action: 'spawn', pack: 'swarm', x: 1000, y: 0 });
	due(room, 2);
	const e = manual(room)[0];
	e.hp /= 2;
	const before = { hp: e.hp, maxHp: e.maxHp, barrier: e.hordeBarrier, dmg: e.dmg };
	room.time = 600;
	room.removePlayer(heroes[1].pid);
	const hpRatio = enemyHpScale(2, 1) / enemyHpScale(2, 2);
	close(e.hp, before.hp * hpRatio, 'remaining HP keeps its birth cohort scaling');
	close(e.maxHp, before.maxHp * hpRatio, 'max HP keeps its birth cohort scaling');
	close(e.hordeBarrier, before.barrier * hpRatio, 'unspent barrier rescales with its cohort');
	close(e.dmg, before.dmg * enemyDmgScale(2, 1) / enemyDmgScale(2, 2), 'damage rescales at birth time');
	assert.equal(e.hordeLevel, 3);
	assert.equal(room.state, 'play');
});

test('boss appears once at 12:00, ignores director upgrades and its death wins even alongside a complete wipe', () => {
	const { room, mode, heroes: [h] } = encounter();
	mode.build = { packs: Object.fromEntries(Object.keys(HORDE_PACKS).map((id) => [id, 5])), weapons: Object.fromEntries(Object.keys(HORDE_WEAPONS).map((id) => [id, 3])), artifacts: Object.fromEntries(Object.keys(HORDE_ARTIFACTS).map((id) => [id, 3])) };
	due(room, HORDE_BOSS_AT - 0.001);
	assert.equal(room.bosses.length, 0);
	due(room, HORDE_BOSS_AT);
	const boss = room.bosses[0];
	assert.ok(boss?.hordeBoss);
	assert.equal(boss.hordeBuild, undefined);
	assert.equal(boss.hordeBarrier, undefined);
	const control = encounter();
	due(control.room, HORDE_BOSS_AT);
	close(boss.maxHp, control.room.bosses[0].maxHp, 'boss health ignores the entire director build');
	close(boss.dmg, control.room.bosses[0].dmg, 'boss damage ignores the entire director build');
	due(room, HORDE_BOSS_AT + 1);
	assert.equal(room.bosses.length, 1);
	room.killEnemy(boss, h);
	room.downHero(h, 'test-simultaneous');
	room.checkAllDown();
	assert.equal(room.overMsg.win, true);
	assert.equal(room.overMsg.directorWin, false);
	assert.equal(room.overMsg.reason, 'boss');
	assert.equal(room.overMsg.grade, 2);
});

test('time, wipe, explicit leaves and disconnect outcomes finish once with the correct winner', () => {
	for (const [scenario, reason, win] of [['time', 'time', true], ['wipe', 'wipe', false], ['director-left', 'director-left', true], ['heroes-left', 'heroes-left', false], ['hero-offline', 'wipe', false]]) {
		const { room, hub, heroes: [h], messages } = encounter();
		if (scenario === 'time') { room.time = HORDE_SECONDS - 0.01; room.step(0.01); }
		if (scenario === 'wipe') { room.downHero(h, 'test'); room.checkAllDown(); }
		if (scenario === 'director-left') hub.handle(1, { t: 'leave' });
		if (scenario === 'heroes-left') hub.handle(h.pid, { t: 'leave' });
		if (scenario === 'hero-offline') hub.setOffline(h.pid, true);
		assert.equal(room.state, 'over', scenario);
		assert.equal(room.overMsg.reason, reason, scenario);
		assert.equal(room.overMsg.win, win, scenario);
		assert.equal(room.overMsg.directorWin, !win, scenario);
		const result = room.overMsg;
		room.finish(!win);
		assert.equal(room.overMsg, result, 'the first terminal outcome is immutable');
		assert.ok(messages.filter(({ msg }) => msg.t === 'over').length > 0);
	}
	const { room, hub } = encounter();
	hub.setOffline(1, true);
	assert.equal(room.state, 'play', 'director network grace does not count as explicit surrender');
	room.step(0.01);
	assert.equal(room.state, 'play');
});

test('Horde results archive the director build but award no PvE hook, achievements, card or ranking', () => {
	const { room, mode } = encounter();
	let awards = 0;
	room.onRunEnd = () => { awards++; return new Map(); };
	const chosen = mode.offer;
	command(room, { action: 'pick', offerId: chosen.id, choice: 0 });
	room.finish(true, 1, 'time');
	const over = room.overMsg;
	assert.equal(awards, 0);
	assert.equal(over.ruleset, 'horde');
	assert.equal(over.card, null);
	assert.ok(over.stats.every((s) => !Object.hasOwn(s, 'ach') && !Object.hasOwn(s, 'tot')));
	assert.equal(over.log.players, 1);
	assert.equal(over.log.ranked, false);
	assert.deepEqual(over.log.director.build, mode.build);
	assert.equal(over.log.director.picks[0].offerId, chosen.id);
	assert.equal(runStore.getCard(over.runId), null);
	assert.equal(runStore.list().find((row) => row.id === over.runId).ranked, false);
	const pve = new Room('CONTROL', () => {});
	pve.addPlayer(9, 'PvE', 'ranger'); pve.start(); pve.onRunEnd = () => { awards++; return new Map(); };
	pve.finish(true);
	assert.equal(awards, 1, 'the control proves the PvE reward hook remains functional');
	assert.equal(pve.overMsg.stats[0].ach.wins, 1);
});
