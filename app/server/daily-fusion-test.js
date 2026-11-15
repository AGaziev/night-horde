import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { Room } from './game.js';
import { ENEMIES, enemyDmgScale, MODES } from '../public/shared/content.js';
import { dailyFor } from '../public/shared/daily.js';
import { updateCaravan } from './caravans.js';
import { Net } from '../public/js/net.js';
import { SnapshotDecoder } from '../public/js/snapshot-codec.js';

const source = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8')
	.replaceAll("'/shared/", "'" + new URL('../public/shared/', import.meta.url).href);
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

function scene(rule, mode) {
	const frames = [], messages = [];
	const room = new Room('DAILYFUSION', (pid, msg, json) => {
		messages.push(msg);
		if (json && pid === 1) frames.push(JSON.parse(json));
	});
	room.setMode(mode); room.addPlayer(1, 'Player', 'knight');
	room.handle(1, { t: 'daily', enabled: true });
	let day = Date.UTC(2026, 10, 14);
	while (dailyFor(day).id !== rule) day += 86_400_000;
	room.lockDaily(day); room.start();
	const hero = room.heroes.get(1);
	hero.x = hero.y = 0; hero.perk.readyAt = Infinity;
	hero.weapons = new Map([['bolt', { lvl: 3, t: 0 }], ['lightning', { lvl: 3, t: 0 }], ['knives', { lvl: 3, t: 0 }]]);
	return { room, hero, frames, messages };
}

function pickFusion(room, hero, messages) {
	room.grantOffer(hero);
	const offer = messages.findLast(msg => msg.t === 'lvl');
	const i = offer.choices.findIndex(card => card.kind === 'duo' && card.id === 'orb');
	assert.ok(i >= 0, 'native offer generation presents the ready III+III fusion');
	room.handle(hero.pid, { t: 'pick', i, offerEpoch: offer.offerEpoch });
	assert.deepEqual([...hero.weapons.keys()], ['orb', 'knives']);
	assert.deepEqual(hero.weapons.get('orb').parts.map(part => [part.id, part.lvl]), [['bolt', 3], ['lightning', 3]]);
}

for (const rule of ['glass', 'armor', 'gather', 'swarm']) for (const mode of ['lunch', 'night']) {
	test(`${rule}/${mode}: native fusion pick preserves daily terms, single attack, pressure and pause`, () => {
		const { room, hero, messages } = scene(rule, mode);
		const locked = structuredClone(room.daily), mods = structuredClone(hero.mods);
		assert.equal(room.runLength, MODES[mode].seconds);
		room.setPaused(true); room.step(1); assert.equal(room.time, 0);
		room.setPaused(false); room.time = 100;
		room.addProjectile(hero, 'bolt', 0, 400, 10, 1, 2, null);
		room.addProjectile(hero, 'knife', 0, 400, 10, 1, 2, null);
		const retired = room.projectiles.find(projectile => projectile.src.weapon === 'bolt').id;
		pickFusion(room, hero, messages);
		assert.ok(room.consumedAttacks.has(`0:${retired}`));
		assert.deepEqual(room.projectiles.map(projectile => projectile.src.weapon), ['knives']);
		assert.deepEqual(hero.mods, mods);
		assert.deepEqual(room.daily, locked);

		const enemy = room.spawnEnemy('brute', [hero], 1);
		Object.assign(enemy, { x: 50, y: 0, hp: 1e7, maxHp: 1e7, speed: 0 });
		const pressure = mode === 'night' ? .65 : .75;
		assert.ok(Math.abs(enemy.dmg - ENEMIES.brute.dmg * enemyDmgScale(room.nt, 1) * pressure) < 1e-9);
		for (let frame = 0; frame < 120; frame++) {
			room.time += 1 / 30; room.rebuildGrid();
			room.updateWeapon(hero, 'orb', hero.weapons.get('orb'), 1 / 30);
			room.updateOrbs(1 / 30);
		}
		assert.ok(hero.dmgBy.orb > 0, 'native signature attack damages the enemy');
		assert.equal(hero.dmgBy.bolt ?? 0, 0); assert.equal(hero.dmgBy.lightning ?? 0, 0);
		room.resync(1); assert.deepEqual(room.daily, locked);
		room.finish(false);
		assert.deepEqual(room.overMsg.daily, locked); assert.deepEqual(room.lastLog.daily, locked);
		assert.equal(room.overMsg.stats[0].ach, null); assert.equal(room.overMsg.stats[0].tot, undefined);
	});
}

for (const mode of ['lunch', 'night']) test(`Swarm/${mode}: lost fusion cancel recovers with Swarm, caravan and movement metadata`, () => {
	const { room, hero, frames, messages } = scene('swarm', mode);
	const cohort = room.swarm.cohorts[1];
	// The caravan and Tide Swarm cohort naturally overlap at this time in both modes.
	room.time = Math.max(cohort.at, room.runLength * .35) + 1;
	assert.ok(room.time < cohort.end);
	room.updatePeaks([hero]); room.spawnAcc = 1; room.spawn(0, [hero]);
	updateCaravan(room, [hero], 1 / 30);
	assert.ok(cohort.spawned > 0); assert.ok(room.caravan);
	assert.ok(room.enemies.filter(enemy => enemy.caravan).every(enemy => !enemy.swarmCohort));
	hero.posAck = 17; hero.moveEpoch = 2;
	room.addProjectile(hero, 'bolt', 0, 400, 10, 1, 2, null);
	room.addProjectile(hero, 'knife', 0, 400, 10, 1, 2, null);
	const [retired, independent] = room.projectiles;
	const requests = [], net = Object.create(Net.prototype);
	Object.assign(net, { snapDec: new SnapshotDecoder(), keyAskedAt: -Infinity, handlers: new Map(), outbox: [] });
	net.send = msg => requests.push(msg);
	const game = new Game(net); game.me = 1; game.begin(room.startMsg());
	let decoded;
	net.on('s', msg => { decoded = msg; game.onSnapshot(msg); });
	room.snapshot(); net.receive(JSON.stringify(frames.at(-1)));
	assert.ok(game.shots.has(retired.id)); assert.ok(game.shots.has(independent.id));
	assert.ok(game.snaps.at(-1).swarm); assert.ok(game.snaps.at(-1).cv);
	room.killEnemy(room.enemies.find(enemy => enemy.swarmCohort === cohort), hero);
	room.time += .1; room.snapshot(); net.receive(JSON.stringify(frames.at(-1)));
	assert.notEqual(frames.at(-1).K, 1, 'an accepted delta updates all coexistence metadata before recovery');
	assert.equal(game.snaps.at(-1).swarm.killed, 1);
	assert.ok(game.snaps.at(-1).cv); assert.deepEqual(decoded.pa, [[1, 17, 2]]);
	pickFusion(room, hero, messages);
	room.time += .1; room.snapshot(); // Drop the delta carrying the retirement event.
	room.time += .1; room.snapshot(); net.receive(JSON.stringify(frames.at(-1)));
	assert.equal(requests.at(-1)?.t, 'kf');
	assert.ok(game.shots.has(retired.id), 'missing cancel remains visible until a key repairs the gap');
	const locked = structuredClone(room.daily);
	room.resync(1); room.time += .1; const expected = room.snapshot();
	assert.equal(frames.at(-1).K, 1);
	net.receive(JSON.stringify(frames.at(-1)));
	assert.equal(game.shots.has(retired.id), false); assert.ok(game.shots.has(independent.id));
	assert.deepEqual(game.snaps.at(-1).swarm, expected.swarm);
	assert.deepEqual(game.snaps.at(-1).cv, expected.cv);
	assert.deepEqual(decoded.pa, [[1, 17, 2]]);
	assert.deepEqual(game.daily, locked); assert.deepEqual(room.daily, locked);
	game.shotEvent(['shot', retired.id, 0, 0, 0, 400, 0, 2, 0, room.time]);
	assert.equal(game.shots.has(retired.id), false, 'late source event cannot resurrect a consumed attack');
});
