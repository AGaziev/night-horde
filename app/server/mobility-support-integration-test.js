import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { Room } from './game.js';
import { EVOS, HOSTILE_R, PLAYER_RADIUS } from '../public/shared/content.js';
import { dailyFor } from '../public/shared/daily.js';
import { Net } from '../public/js/net.js';
import { SnapshotDecoder } from '../public/js/snapshot-codec.js';

const source = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8')
	.replaceAll("'/shared/", "'" + new URL('../public/shared/', import.meta.url).href);
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const dt = 1 / 30;
function arena(count = 2, daily = false) {
	const wire = [], r = new Room('DASH-SUPPORT', (pid, _msg, json) => { if (pid === 1 && json) wire.push(JSON.parse(json)); });
	for (let pid = 1; pid <= count; pid++) r.addPlayer(pid, `P${pid}`, 'ranger');
	if (daily) {
		r.handle(1, { t: 'daily', enabled: true });
		let day = Date.UTC(2026, 10, 14); while (dailyFor(day).id !== 'swarm') day += 86_400_000;
		r.lockDaily(day);
	}
	r.start(); r.time = 100; r.enemies = []; r.spawn = () => {}; r.breakAround = () => {};
	r.events.next = Infinity; r.peaks = []; r.bossAt = []; r.nextEliteT = r.nextInvasionT = Infinity;
	const heroes = [...r.heroes.values()];
	for (const h of heroes) { h.x = h.y = 0; h.hp = h.maxHp = 100; h.weapons.clear(); h.perk.readyAt = Infinity; }
	return { r, heroes, wire };
}
function pick(r, h, card) {
	h.offer = [card]; r.sendOffer(h); r.handle(h.pid, { t: 'pick', i: 0, offerEpoch: h.offerEpoch });
}
function gift(r, recipient, donor) {
	recipient.weapons.set('ward', { lvl: 3, t: 0 });
	r.updateWeapon(recipient, 'ward', recipient.weapons.get('ward'), dt);
	r.hurtPlayer(recipient, 1); recipient.iframes = 0;
	donor.weapons.set('ward', { lvl: 5, t: 0 }); donor.passives.set(EVOS.bastion.requires, 1);
	pick(r, donor, r.evoCard(donor, 'bastion'));
	r.updateWeapon(donor, 'bastion', donor.weapons.get('bastion'), dt); r.hurtPlayer(donor, 1);
	assert.equal(recipient.sharedWard?.owner, donor);
}
function dash(r, h) {
	r.handle(h.pid, { t: 'dash', run: r.runLog.id, request: 1, expiresAt: Date.now() + 1500, x: 1, y: 0 });
	assert.ok(h.dash);
}
function shot(r, at, damage = 10) {
	r.hostile.push({ id: r.nextId++, x: HOSTILE_R + PLAYER_RADIUS + 1200 * at, y: 0,
		vx: 0, vy: 0, life: 1, dmg: damage, from: 'dash-support-shot' });
}

for (const kind of ['body', 'projectile']) for (const at of [107.99, 108, 108.005]) {
	test(`native dash ${kind} contact at ${at} respects gift expiry rather than tick end`, () => {
		const { r, heroes: [h, donor] } = arena(); gift(r, h, donor);
		const own = h.ward, before = donor.support.blocked;
		donor.x = 1000; r.time = 107.98;
		if (kind === 'body') {
			const e = r.spawnEnemy('ghoul', [h, donor], 1);
			Object.assign(e, { x: e.r + PLAYER_RADIUS + 1200 * (at - r.time), y: 0, speed: 0, dmg: 10, hp: 1e6 });
		} else shot(r, at - r.time);
		const times = [], hurt = r.hurtPlayer;
		r.hurtPlayer = function (...args) { times.push(args[3]); return hurt.apply(this, args); };
		dash(r, h); r.tick(dt);
		assert.equal(h.x, 40); assert.equal(h.hp, 100); assert.equal(h.sharedWard, null);
		assert.equal(h.ward, own - (at < 108 ? 0 : 1));
		assert.equal(donor.support.blocked - before, at < 108 ? 10 : 0);
		assert.equal(times.length, 1); assert.ok(Math.abs(times[0] - at) < 1e-9);
	});
}

function frozenScene({ credit = true, shotAt = null, protection = 0, twoHeroes = false } = {}) {
	const random = Math.random; let draws = 0; Math.random = () => { draws++; return .99; };
	try {
		const { r, heroes: [h, owner, ally] } = arena(3);
		const e = r.spawnEnemy('ghoul', [h, owner, ally], 1);
		Object.assign(e, { x: 40, y: 0, speed: 0, dmg: 10, hp: 1e6 }); r.rebuildGrid();
		owner.weapons.set('frost', { lvl: 1, t: 0 });
		r.updateWeapon(owner, 'frost', owner.weapons.get('frost'), dt); r.updateColdWaves(.15);
		assert.equal(e.frozenOwner, owner); assert.ok(e.frozenT > r.time);
		owner.weapons.clear(); owner.x = 1000; ally.x = twoHeroes ? 0 : 1000;
		if (!credit) e.frozenOwner = null;
		h.iframes = protection; if (shotAt !== null) shot(r, shotAt);
		dash(r, h); if (twoHeroes) dash(r, ally);
		const startDraws = draws; r.tick(dt);
		return { control: owner.support.control, state: {
			heroes: [...r.heroes.values()].map(p => [p.x, p.y, p.hp, p.iframes, p.ward]),
			enemy: [e.x, e.y, e.hp, e.frozenT], shots: r.hostile.map(s => [s.id, s.x, s.y, s.life]),
			fx: r.fx, rng: draws - startDraws,
		} };
	} finally { Math.random = random; }
}
for (const [name, options, delivered] of [
	['unprotected body', {}, true], ['earlier shot protection', { shotAt: .003 }, false],
	['later shot still hits', { shotAt: .012, protection: .005 }, true],
	['whole-frame protection', { protection: dt }, false], ['two heroes share one enemy budget', { twoHeroes: true }, true],
]) test(`dash frozen-body observer: ${name}, combat state and RNG unchanged by credit`, () => {
	const plain = frozenScene({ ...options, credit: false }), credited = frozenScene(options);
	assert.deepEqual(credited.state, plain.state); assert.equal(plain.control, 0);
	assert.equal(credited.control, delivered ? dt : 0);
	if (options.shotAt !== undefined) assert.equal(credited.state.heroes[0][2], 90, 'observation cannot grant protection');
});

test('lost delta recovers Daily, dash, gift, support and retirement in one production client key', () => {
	const { r, heroes: [h, donor], wire } = arena(2, true);
	// Keep a prior result and a nonempty current cohort in the same recovery fixture.
	Object.assign(r.swarm.cohorts[0], { resolved: true, success: true, spawned: 10, killed: 7 });
	r.swarm.wins = 1; r.swarm.cohorts[1].spawned = 12; r.swarm.cohorts[1].killed = 5;
	r.time = r.swarm.cohorts[1].at + 1; gift(r, h, donor); donor.x = 1000;
	h.weapons.set('bolt', { lvl: 3, t: 0 }); h.weapons.set('lightning', { lvl: 3, t: 0 });
	r.addProjectile(h, 'bolt', 0, 100, 10, 1, 3, null); const retired = r.projectiles.at(-1).id;
	r.addProjectile(h, 'knife', 0, 100, 10, 1, 3, null); const independent = r.projectiles.at(-1).id;
	r.caravan = { status: 'guarded', x: 1200, y: 0, killed: 0, total: 12, expires: r.time + 30 };
	h.posAck = 17;
	const requests = [], net = Object.create(Net.prototype);
	Object.assign(net, { snapDec: new SnapshotDecoder(), keyAskedAt: -Infinity, handlers: new Map(), outbox: [] });
	net.send = msg => requests.push(msg);
	const g = new Game(net); g.me = h.pid; g.begin(r.startMsg()); let decoded;
	net.on('s', msg => { decoded = msg; g.onSnapshot(msg); });
	r.snapshot(); net.receive(JSON.stringify(wire.at(-1)));
	assert.ok(g.shots.has(retired)); assert.ok(g.latest().wardGift.has(h.pid));
	pick(r, h, r.duoCard(h, { id: 'orb', a: 'bolt', b: 'lightning' })); dash(r, h);
	r.tick(dt); r.snapshot(); // Drop the only cancel/first-dash delta.
	r.tick(dt); r.snapshot(); net.receive(JSON.stringify(wire.at(-1)));
	assert.equal(requests.at(-1)?.t, 'kf'); assert.ok(g.shots.has(retired));
	r.needKey.add(h.pid); const expected = r.snapshot(); assert.equal(wire.at(-1).K, 1);
	net.receive(JSON.stringify(wire.at(-1)));
	assert.equal(g.shots.has(retired), false); assert.ok(g.shots.has(independent));
	assert.equal(g.moveEpoch, h.moveEpoch); assert.equal(g.local.x, h.x);
	assert.deepEqual(decoded.mob, expected.mob); assert.deepEqual(decoded.pa, expected.pa);
	assert.deepEqual(g.daily, r.daily); assert.deepEqual(g.latest().swarm, expected.swarm);
	assert.equal(g.latest().swarm.killed, 5); assert.equal(g.latest().swarmResult.success, true);
	assert.deepEqual(g.latest().swarmResult, expected.swarmResult);
	assert.deepEqual(g.latest().cv, expected.cv); assert.deepEqual(g.latest().support, expected.support);
	assert.deepEqual([...g.latest().wardGift], expected.wardGift);
	assert.ok(wire.at(-1).consumedAttacks.some(([kind, id]) => kind === 0 && id === retired));
});
