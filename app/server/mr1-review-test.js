import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { SnapshotDecoder } from '../public/js/snapshot-codec.js';
import { DUOS } from '../public/shared/content.js';

const dt = 1 / 30;
function arena(weapons, players = 1) {
	const sent = [];
	const r = new Room('REVIEW', (pid, msg, json) => sent.push({ pid, msg, wire: json && JSON.parse(json) }));
	for (let pid = 1; pid <= players; pid++) r.addPlayer(pid, `P${pid}`, 'knight');
	r.start(); r.time = 100; r.enemies.length = 0;
	const h = r.heroes.get(1);
	h.x = h.y = 0; h.perk.readyAt = Infinity;
	h.weapons = new Map(weapons.map(([id, lvl]) => [id, { lvl, t: 0 }]));
	r.updateCombos(h);
	return { r, h, sent };
}
function fuse(r, h, id) {
	const pair = r.updateCombos(h).find((c) => c.id === id && c.ready);
	assert.ok(pair, `${id}: the actual parts qualify for fusion`);
	h.offer = [r.duoCard(h, pair)];
	r.handle(h.pid, { t: 'pick', i: 0 });
	return h.weapons.get(id);
}
function foe(r, x, y = 0, hp = 10000) {
	const e = r.spawnEnemy('ghoul', [...r.heroes.values()], 1);
	Object.assign(e, { x, y, hp, maxHp: hp, speed: 0, dmg: 0 });
	r.rebuildGrid();
	return e;
}

test('4540714269: Orrery keeps its live mask and inherited levels through key, delta and resync', () => {
	const { r, h, sent } = arena([['bolt', 3], ['orbit', 5]]);
	const w = fuse(r, h, 'orrery');
	const dec = new SnapshotDecoder();
	function read(expectedMask, key) {
		r.snapshot();
		const wire = sent.filter((m) => m.pid === 1 && m.wire?.t === 's').at(-1).wire;
		assert.equal(wire.K === 1, key, 'the expected wire path is exercised');
		const snapshot = dec.decode(wire);
		assert.ok(snapshot, 'the browser decoder accepts the snapshot');
		const row = snapshot.p[0][12][0];
		assert.equal(row[3], expectedMask, 'the client draws exactly the sparks still orbiting');
		assert.deepEqual(row[5], [['bolt', 4], ['orbit', 5]], 'the same row retains both attack levels');
	}
	r.updateWeapon(h, 'orrery', w, dt);
	const count = DUOS.orrery.levels[w.lvl - 1].count;
	const full = (1 << count) - 1;
	read(full, true);
	foe(r, 180);
	w.t = 0;
	r.updateWeapon(h, 'orrery', w, dt);
	const fired = w.ready.findIndex((at) => at > r.time);
	assert.ok(fired >= 0, 'a real Orrery cast launches one spark');
	const missing = full & ~(1 << fired);
	read(missing, false);
	dec.reset(); r.resync(1);
	read(missing, true);
	r.time = w.ready[fired];
	r.enemies.length = 0; r.rebuildGrid();
	r.updateWeapon(h, 'orrery', w, dt);
	read(full, false);
});
