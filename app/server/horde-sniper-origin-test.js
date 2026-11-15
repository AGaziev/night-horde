import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { Hub } from './game.js';
import { HORDE_PACKS } from '../public/shared/horde-content.js';
import { PLAYER_RADIUS } from '../public/shared/content.js';
import { SnapshotDecoder } from '../public/js/snapshot-codec.js';

const source = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8')
	.replaceAll("'/shared/", "'" + new URL('../public/shared/', import.meta.url).href);
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-8, `${label}: ${a} !== ${b}`);

function paidSniper() {
	const messages = [], hub = new Hub((pid, msg, wire) => messages.push({ pid, msg: structuredClone(msg), wire }));
	for (let pid = 1; pid <= 3; pid++) hub.addPlayer(pid, `P${pid}`, `sniper-origin-${pid}`);
	hub.handle(1, { t: 'create', hero: 'ranger', ruleset: 'horde' });
	const room = hub.players.get(1).room;
	for (let pid = 2; pid <= 3; pid++) hub.handle(pid, { t: 'join', code: room.code, hero: 'ranger' });
	hub.handle(1, { t: 'start' });
	const mode = room.horde, heroes = [...room.heroes.values()], [target, ward] = heroes;
	mode.build.packs.snipers = 1;
	room.time = HORDE_PACKS.snipers.at;
	const wallet = mode.resource;
	hub.handle(1, { t: 'horde', roundId: mode.roundId, action: 'spawn', pack: 'snipers', x: -1100, y: 0, seq: 1 });
	assert.equal(mode.resource, wallet - HORDE_PACKS.snipers.cost, 'the native command pays for the sniper pack');
	assert.equal(mode.pending.length, 1);
	room.time = mode.pending[0].at;
	mode.tick(0, heroes);
	const cohort = room.enemies.filter((e) => e.hordeSource === 'manual');
	assert.equal(cohort.length, HORDE_PACKS.snipers.units.length);
	assert.equal(cohort.filter((e) => e.ai === 'sniper').length, 2);
	// Prepare only positions and cooldowns; aim, Ward knockback, recovery and combat stay native.
	cohort.forEach((e, i) => { e.x = -1100; e.y = -200 - i * 100; });
	const sniper = cohort.find((e) => e.ai === 'sniper');
	sniper.x = sniper.y = 0; sniper.shotT = 0;
	target.x = 550; target.y = 0;
	heroes.forEach((h) => { h.weapons.clear(); h.perk.readyAt = Infinity; h.mods.critChance = 0; });
	return { hub, room, mode, messages, heroes, target, ward, sniper };
}

function restore(f, reconnect) {
	const before = f.messages.length;
	if (reconnect) f.hub.welcome(f.target.pid);
	else f.hub.handle(f.target.pid, { t: 'join', code: f.room.code });
	const frames = f.messages.slice(before).filter((m) => m.pid === f.target.pid).map((m) => m.msg);
	const start = frames.find((m) => m.t === 'start'), state = frames.find((m) => m.t === 'horde-resync');
	assert.ok(start && state, 'Hub rejoin/session replacement sends start and resync');
	assert.ok(frames.indexOf(start) < frames.indexOf(state));
	const game = new Game({ send() {} }); game.me = f.target.pid;
	game.begin(start); game.onHordeResync(state);
	const decoder = new SnapshotDecoder();
	const snapshot = () => {
		const before = f.messages.length;
		f.room.snapshot();
		const frame = f.messages.slice(before).find((m) => m.pid === f.target.pid && m.msg.t === 's');
		assert.ok(frame?.wire, 'client receives the real snapshot wire');
		const wire = JSON.parse(frame.wire);
		const decoded = decoder.decode(wire);
		assert.ok(decoded && !decoded.gap);
		game.onSnapshot(decoded); game.view.tm = decoded.tm; game.applyEffects();
		game.teleTm = decoded.tm; game.updateEffects(0);
		return { wire, decoded };
	};
	assert.equal(snapshot().wire.K, 1, 'the first snapshot after recovery is a key');
	assert.equal(game.blines.length, sniperFan(f), 'the first key preserves exactly the restored fan');
	return { state, game, snapshot };
}

const sniperFan = (f) => f.sniper.def.fan;
const geometry = (lane) => [lane.x1, lane.y1, lane.x2, lane.y2, lane.w];
const distance = (lane, point) => Math.abs((lane.x2 - lane.x1) * (point.y - lane.y1)
	- (lane.y2 - lane.y1) * (point.x - lane.x1)) / Math.hypot(lane.x2 - lane.x1, lane.y2 - lane.y1);

function scene(displaced, t) {
	const f = paidSniper(), { room, sniper, target, ward } = f;
	ward.x = 0; ward.y = displaced ? 60 : 200;
	assert.equal(room.sniperTick(sniper, target, 550, 0), true);
	assert.deepEqual([sniper.aimX, sniper.aimY], [0, 0], 'native aim saves zero coordinates');
	const original = room.fx.filter((ev) => ev[0] === 'bline').map((ev) => ev.slice(1, 6));
	assert.equal(original.length, sniperFan(f));
	const deadline = room.time + sniper.windT;
	room.snapshot(); // The original aim has already reached a key before the hero rejoins.
	ward.weapons.set('ward', { lvl: 1, t: 0, bashT: Infinity });
	room.updateWeapon(ward, 'ward', ward.weapons.get('ward'), 0);
	assert.equal(ward.ward, 1, 'native Ward I starts charged');
	room.rebuildGrid(); room.hurtPlayer(ward, 8, 'ghoul');
	assert.equal(ward.ward, 0, 'the native hit consumes Ward and triggers its burst');
	assert.equal(sniper.dead, false);
	assert.deepEqual([sniper.x, sniper.y], [0, displaced ? -60 : 0], 'Ward I performs the real 60-unit push');
	assert.deepEqual([sniper.aimX, sniper.aimY], [0, 0], 'Ward cannot move the saved aim origin');
	const recoveries = [];
	for (const reconnect of [false, true]) {
		room.time += 0.2;
		room.sniperTick(sniper, target, 550, 0.2);
		const recovered = restore(f, reconnect);
		recoveries.push(recovered);
		for (const lane of recovered.game.blines) close(lane.life + lane.serverStart, deadline, 'repeated recovery keeps the original deadline');
	}
	const latest = recoveries.at(-1), visible = latest.game.blines.map(geometry);
	const outside = latest.game.blines.every((lane) => distance(lane, target) > lane.w / 2 + PLAYER_RADIUS);
	room.time = deadline - 0.001;
	room.sniperTick(sniper, target, 550, sniper.windT - 0.001);
	assert.equal(room.hostile.length, 0, 'the native volley waits for the remaining warning');
	room.time = deadline;
	room.sniperTick(sniper, target, 550, sniper.windT);
	assert.equal(room.hostile.length, sniperFan(f));
	const shots = room.hostile.map((s) => ({ ...s }));
	latest.snapshot();
	assert.equal(latest.game.blines.length, 0, 'the restored lanes expire at the native firing deadline');
	assert.equal(latest.game.hostile.size, sniperFan(f), 'the real volley reaches Game through the next wire snapshot');
	for (const shot of shots) {
		assert.deepEqual([shot.x, shot.y], [0, 0], 'the native volley fires from the saved zero origin');
		const client = latest.game.hostile.get(shot.id);
		assert.deepEqual([client.x0, client.y0], [shot.x, shot.y]);
	}
	const hp = target.hp;
	while (room.hostile.length) { room.time += 1 / 30; room.updateHostile(1 / 30); }
	latest.snapshot();
	const lost = hp - target.hp;
	assert.ok(lost > 0, 'the real middle orb hits the stationary target');
	assert.equal(latest.game.latest().pMap.get(target.pid)[3], Math.ceil(target.hp), 'Game receives the actual post-hit HP');
	assert.ok(room.runLog.p.get(target.pid).taken['sniper:shot'] > 0);
	t.diagnostic(JSON.stringify({ displaced, current: [sniper.x, sniper.y], aim: [sniper.aimX, sniper.aimY],
		restoredOrigin: visible[0].slice(0, 2), remaining: latest.state.lanes[0].remaining, deadline,
		outsideRestoredFan: outside, hpLost: lost, volleyOrigin: [shots[0].x, shots[0].y] }));
	return { f, original, recoveries, shots, visible, outside, lost };
}

test('paid sniper recovery after Ward I displacement matches the unchanged fan, volley and HP control', (t) => {
	const control = scene(false, t), displaced = scene(true, t);
	close(displaced.lost, control.lost, 'knockback/recovery cannot change native volley damage');
	for (const result of [control, displaced]) {
		assert.equal(result.outside, false, 'a damaging native volley must still warn the target in the restored fan');
		for (const { state, game } of result.recoveries) {
			state.lanes.forEach((lane, i) => assert.deepEqual(geometry(lane).map(Math.round), result.original[i], 'recovery preserves native aim geometry'));
			game.blines.forEach((lane) => assert.deepEqual([lane.x1, lane.y1], [0, 0]));
		}
		result.visible.forEach((lane, i) => {
			const shot = result.shots[i];
			close(lane[0], shot.x, 'warning/shot origin x'); close(lane[1], shot.y, 'warning/shot origin y');
			close(lane[2], shot.x + shot.vx * shot.life, 'warning/shot endpoint x');
			close(lane[3], shot.y + shot.vy * shot.life, 'warning/shot endpoint y');
		});
	}
});

test('sniper recovery uses the native nullish origin fallback and preserves explicit zero', () => {
	for (const saved of [[null, undefined], [0, 0]]) {
		const f = paidSniper(), { sniper, room, target } = f;
		sniper.x = 83; sniper.y = 96;
		[sniper.aimX, sniper.aimY] = saved;
		sniper.bvx = 1; sniper.bvy = 0; sniper.windT = 0.4;
		const lanes = f.mode.nativeLanes();
		room.sniperTick(sniper, target, 550, 0.4);
		assert.equal(lanes.length, room.hostile.length);
		lanes.forEach((lane, i) => {
			const shot = room.hostile[i];
			assert.deepEqual([lane.x1, lane.y1], [shot.x, shot.y], 'recovery and native shot use identical nullish fallback');
			close(lane.remaining, 0.4, 'fallback does not change remaining windup');
		});
	}
});
