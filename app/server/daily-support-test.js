import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { EVOS, xpForNext } from '../public/shared/content.js';
import { dailyFor } from '../public/shared/daily.js';
import { SnapshotDecoder } from '../public/js/snapshot-codec.js';

const dt = 1 / 30;
function scene() {
	const frames = [], messages = [], r = new Room('DAILY-SUPPORT', (pid, msg, json) => {
		messages.push(msg); if (pid === 1 && json) frames.push(JSON.parse(json));
	});
	r.setMode('lunch');
	for (let pid = 1; pid <= 2; pid++) r.addPlayer(pid, `P${pid}`, 'ranger');
	r.handle(1, { t: 'daily', enabled: true });
	let day = Date.UTC(2026, 10, 14); while (dailyFor(day).id !== 'swarm') day += 86_400_000;
	r.lockDaily(day); r.start();
	const [h, donor] = r.heroes.values();
	for (const p of [h, donor]) { p.x = p.y = 0; p.weapons.clear(); p.perk.readyAt = Infinity; }
	return { r, h, donor, frames, messages };
}
function pick(r, h, card) {
	h.offer = [card]; r.sendOffer(h);
	r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: h.offerEpoch });
}

for (const age of [7.99, 8]) test(`Swarm v5: native fusion grant, gift at age ${age}, wire and saved support stay together`, () => {
	const { r, h, donor, frames, messages } = scene();
	r.time = r.swarm.cohorts[0].at + 1;
	const daily = structuredClone(r.daily), birth = r.time;
	h.weapons = new Map([['ward', { lvl: 3, t: 0 }], ['aura', { lvl: 3, t: 0 }]]);
	r.updateWeapon(h, 'ward', h.weapons.get('ward'), dt); r.hurtPlayer(h, 10); h.iframes = 0;
	const own = h.ward;
	donor.weapons.set('ward', { lvl: 5, t: 0 }); donor.passives.set(EVOS.bastion.requires, 1);
	pick(r, donor, r.evoCard(donor, 'bastion'));
	r.updateWeapon(donor, 'bastion', donor.weapons.get('bastion'), dt); r.hurtPlayer(donor, 10);
	assert.equal(h.sharedWard?.grantedAt, birth); assert.equal(h.sharedWard?.until, birth + 8);
	r.grantOffer(h);
	const offer = messages.findLast(m => m.t === 'lvl' && m.choices.some(c => c.id === 'dome'));
	assert.ok(offer, 'production grant offers the ready III+III Dome');
	r.handle(h.pid, { t: 'pick', i: offer.choices.findIndex(c => c.id === 'dome'), offerEpoch: offer.offerEpoch });
	assert.deepEqual([...h.weapons.keys()], ['dome']); assert.equal(h.ward, own);
	const expected = r.snapshot(), decoded = new SnapshotDecoder().decode(frames.at(-1));
	assert.deepEqual(decoded.wardGift, [[h.pid, birth + 8]]);
	assert.deepEqual(decoded.support, expected.support); assert.deepEqual(decoded.swarm, expected.swarm);
	const blocked = donor.support.blocked;
	r.time = birth + age; r.hurtPlayer(h, 10, 'daily-contact', r.time);
	assert.equal(h.ward, own - (age < 8 ? 0 : 1)); assert.equal(h.sharedWard, null);
	assert.equal(donor.support.blocked - blocked, age < 8 ? 10 : 0);
	assert.deepEqual(r.daily, daily); r.finish(true, 1);
	assert.deepEqual(r.lastLog.daily, daily); assert.deepEqual(r.overMsg.card.daily, daily);
	for (const p of r.lastLog.team) assert.deepEqual(p.support, r.overMsg.card.players.find(row => row.pid === p.pid).support);
	assert.deepEqual(r.lastLog.team[0].build.weapons, ['dome1']);
	assert.ok(r.overMsg.stats.every(row => row.ach === null && row.tot === undefined));
});

test('Swarm resolution and the support interval both run in the native boundary tick', () => {
	const { r, h, donor } = scene(), cohort = r.swarm.cohorts[0];
	r.time = cohort.at; r.updatePeaks([h, donor]);
	const enemies = r.enemies.filter(e => e.swarmCohort === cohort);
	assert.ok(enemies.length > 0);
	for (const e of enemies.slice(0, Math.ceil(enemies.length * .7))) r.killEnemy(e, h);
	assert.ok(cohort.killed * 10 >= cohort.spawned * 7);
	r.enemies = []; r.gems = []; r.items = []; r.time = cohort.end - dt;
	const e = r.spawnEnemy('ghoul', [h, donor], 1);
	Object.assign(e, { x: 200, y: 0, hp: 1e6, maxHp: 1e6, speed: 20, dmg: 0 });
	r.freeze(e, 2, donor); r.controlCredited.add(e);
	h.xp = donor.xp = 0;
	const reward = xpForNext(h.level, 2) * .15;
	r.tick(dt);
	assert.equal(cohort.resolved, true); assert.equal(cohort.success, true);
	assert.equal(h.xp, reward); assert.equal(donor.xp, reward);
	assert.equal(h.support.control, 0); assert.equal(donor.support.control, dt);
	const snap = r.snapshot();
	assert.equal(snap.swarmResult.success, true);
	assert.equal(snap.support.find(row => row[0] === donor.pid)[4], 0, 'sub-tenth credit is only rounded for display');
});
