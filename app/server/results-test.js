// v23 results card (`over.card`): per-player numbers, downs and lifts, the group count, awards, events, size.
// Solo, a pair, a hero lying at the end, a dropped connection. node server/results-test.js
import assert from 'node:assert/strict';
import { Room } from './game.js';
import { awards } from './runlog.js';
import { TICK_HZ, REVIVE_SECONDS } from '../public/shared/content.js';

const dt = 1 / TICK_HZ;
function room(heroes, mode = 'night') {
	const r = new Room('RES', () => {});
	r.setMode(mode);
	heroes.forEach((hero, i) => r.addPlayer(i + 1, 'P' + (i + 1), hero));
	r.start();
	return r;
}
const hero = (r, pid) => r.heroes.get(pid);
const run = (r, sec) => {
	for (let i = 0; i < sec * TICK_HZ && r.state === 'play'; i++) r.tick(dt);
};
const cardOf = (r) => r.overMsg?.card;
const pl = (c, pid) => c.players.find((p) => p.pid === pid);
const revive = (r, helper, down) => {
	helper.x = down.x + 20;
	helper.y = down.y;
	for (let i = 0; i < (REVIVE_SECONDS + 0.5) * TICK_HZ && down.st !== 0; i++) {
		r.time += dt;
		r.updateRevive(dt);
	}
	assert.equal(down.st, 0, 'lifted');
};

// --- 1. solo: real fight for 75 s, numbers match the hero, personal awards only ---
{
	const r = room(['witch']);
	run(r, 75);
	const h = hero(r, 1);
	assert.ok(h.kills > 0 && h.dmg > 0, 'the bot fought');
	r.finish(true);
	const c = cardOf(r);
	assert.ok(c && c.id === r.overMsg.runId, 'over carries the card with the log id');
	const p = pl(c, 1);
	assert.equal(p.kills, h.kills);
	assert.equal(p.dmg, Math.round(h.dmg));
	assert.equal(c.kills, r.kills);
	const pct = p.weapons.reduce((s, w) => s + w[2], 0);
	assert.ok(p.weapons.length >= 1 && pct > 90 && pct <= 100.5, `weapon shares add up: ${pct}`);
	assert.ok(p.weapons.every((w, i) => i === 0 || w[1] <= p.weapons[i - 1][1]), 'weapons by damage');
	assert.ok(p.bestHit && p.bestHit[0] > 0 && typeof p.bestHit[1] === 'string', 'strongest hit');
	assert.ok(p.streak && p.streak[0] >= 1, 'kill streak');
	assert.ok(p.dpm.length >= 1 && p.dpm.length === p.hpm.length, `curves by minute: ${p.dpm.length}/${p.hpm.length}`);
	assert.equal(p.state, 'alive');
	assert.deepEqual([p.downs, p.lifted, p.revives], [0, 0, 0]);
	assert.deepEqual(c.group, { downs: 0, lifted: 0, revives: 0 });
	assert.equal(c.fin, null, 'no finale in 75 s');
	const ids = c.awards.map((a) => a.id);
	assert.ok(!ids.some((id) => ['kills', 'dmg', 'tank', 'phoenix'].includes(id)), `solo: no group comparisons (${ids})`);
	for (const a of c.awards) assert.ok(a.pid === 1 && a.name === 'P1' && a.title && a.text, 'award shape');
	console.log('1 solo: OK (%d kills, awards: %s)', p.kills, ids.join(', ') || '—');
}

// --- 2. pair: a down, a lift; the counts land on the right players and on the group ---
{
	const r = room(['knight', 'witch']);
	run(r, 30);
	const [a, b] = [hero(r, 1), hero(r, 2)];
	b.iframes = 0;
	r.hurtPlayer(b, b.hp + 50, 'skel');
	assert.equal(b.st, 1, 'b is down');
	revive(r, a, b);
	b.iframes = 0;
	r.hurtPlayer(b, b.hp + 50, 'bloater:blast');
	revive(r, a, b);
	r.finish(true);
	const c = cardOf(r);
	const [pa, pb] = [pl(c, 1), pl(c, 2)];
	assert.deepEqual([pb.downs, pb.lifted, pb.revives], [2, 2, 0], 'b fell twice and was lifted twice');
	assert.deepEqual([pa.downs, pa.lifted, pa.revives], [0, 0, 2], 'a lifted twice');
	assert.equal(pb.downsAt.length, 2);
	assert.ok(pb.downsAt[0] <= pb.downsAt[1] && pb.liftedAt.length === 2);
	assert.deepEqual(c.group, { downs: 2, lifted: 2, revives: 2 });
	assert.ok(pb.takenTop.some(([name]) => name.startsWith('Костяк') || name.length > 0), 'who hit b, by name');
	const by = Object.fromEntries(c.awards.map((x) => [x.id, x]));
	assert.equal(by.rescuer?.pid, 1, 'Спасатель — a');
	assert.ok(!by.phoenix || by.phoenix.pid === 2, 'Феникс (2 downs) can only be b');
	assert.ok(!by.clean || by.clean.pid === 1, '«Ни царапины» never goes to the one who fell');
	const holders = new Map();
	for (const x of c.awards) holders.set(x.pid, (holders.get(x.pid) ?? 0) + 1);
	assert.ok([...holders.values()].every((n) => n <= 2), 'at most two titles each in a group');
	console.log('2 pair: OK (awards: %s)', c.awards.map((x) => `${x.id}→P${x.pid}`).join(', '));
}

// --- 3. a hero lying at the end of the run ---
{
	const r = room(['knight', 'ranger', 'witch']);
	run(r, 20);
	const c3 = hero(r, 3);
	c3.iframes = 0;
	r.hurtPlayer(c3, c3.hp + 50, 'ghoul');
	r.finish(true);
	const c = cardOf(r);
	assert.equal(pl(c, 3).state, 'down');
	assert.equal(pl(c, 3).downs, 1);
	assert.equal(pl(c, 3).lifted, 0);
	assert.equal(c.group.downs, 1);
	assert.equal(pl(c, 1).state, 'alive');
	console.log('3 lying at the end: OK');
}

// --- 4. a dropped connection is not a down by enemies; it shows as offline and a drop ---
{
	const r = room(['knight', 'witch']);
	run(r, 10);
	r.setOffline(2, true);
	r.finish(false);
	const c = cardOf(r);
	const p = pl(c, 2);
	assert.equal(p.state, 'offline');
	assert.equal(p.downs, 0, 'offline does not count as a down');
	assert.equal(p.drops, 1);
	assert.equal(c.group.downs, 0);
	console.log('4 offline: OK');
}

// --- 5. events and bosses are named; the card stays small for 8 players over a long run ---
{
	const r = room(['knight', 'witch', 'ranger', 'smith', 'alchemist', 'spearmaiden', 'stormcaller', 'herald'].map((h) => h), 'lunch');
	run(r, 200);
	if (r.state === 'play') r.finish(true);
	const c = cardOf(r);
	assert.equal(c.players.length, 8);
	for (const e of c.events) assert.ok(typeof e[0] === 'string' && typeof e[2] === 'string' && (e[3] === null || typeof e[3] === 'boolean'), `event row ${JSON.stringify(e)}`);
	for (const b of c.bosses) assert.ok(typeof b[0] === 'string');
	const size = JSON.stringify(c).length;
	assert.ok(size < 16 * 1024, `card size ${size} B`);
	// Resent on reconnect: the same message.
	const got = [];
	r.send = (pid, msg) => got.push(msg);
	r.resync(1);
	assert.equal(got[0]?.card, c);
	console.log('5 events + size: OK (%d events, %d bosses, %d B)', c.events.length, c.bosses.length, size);
}

// --- 6. awards from numbers: ties give nobody, «Ни царапины» needs no downs and health never under 30% ---
{
	const P = (pid, o) => ({ pid, name: 'P' + pid, kills: 10, dmg: 100, taken: 200, downs: 0, drops: 0, revives: 0, embers: 0, minHp: 80, maxHp: 100, bestHit: null, streak: null, ...o });
	const ids = (list) => Object.fromEntries(list.map((a) => [a.id, a.pid]));
	let a = ids(awards([P(1, { kills: 50 }), P(2, { kills: 50, taken: 900 })], { finale: null }));
	assert.equal(a.kills, undefined, 'a tie in kills gives nobody the title');
	assert.equal(a.tank, 2);
	assert.equal(a.clean, 1, 'P1 never fell, took the least');
	a = ids(awards([P(1, { minHp: 12, taken: 50 }), P(2, { downs: 1 })], { finale: null }));
	assert.equal(a.clean, undefined, 'down to 12% health is not «Ни царапины»');
	a = ids(awards([P(1, { drops: 1, taken: 10 }), P(2, { downs: 1 })], { finale: null }));
	assert.equal(a.clean, undefined, 'a dropped connection is not «Ни царапины»');
	a = ids(awards([P(1, { revives: 3 }), P(2, { downs: 3 })], { finale: { lastHit: 'P2' } }));
	assert.deepEqual([a.rescuer, a.lord, a.phoenix], [1, 2, 2]);
	a = ids(awards([P(1, { kills: 999, dmg: 9999, taken: 9999 })], { finale: null }));
	assert.ok(!a.kills && !a.dmg && !a.tank, 'solo: no comparisons');
	console.log('6 awards: OK');
}

console.log('results-test: OK');
