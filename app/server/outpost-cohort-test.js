import assert from 'node:assert/strict';
import { Room } from './game.js';
import { ENEMIES, ENEMY_TYPES, enemyHpScale, enemyDmgScale, bossHpScale } from '../public/shared/content.js';

function setup(n, mode) {
	const r = new Room('COHORT', () => {}); r.setMode(mode);
	for (let i = 1; i <= n; i++) r.addPlayer(i, `P${i}`, 'knight');
	r.start(); r.enemies.length = 0; r.time = r.runLength * 2 / 3;
	const hs = [...r.heroes.values()]; r.updateOutposts(hs);
	const p = r.outposts.posts[0]; hs[0].x = p.x; hs[0].y = p.y; r.updateOutposts(hs);
	return { r, hs, p, nt: r.nt };
}
const close = (a, b, msg) => assert.ok(Math.abs(a / b - 1) < 1e-10, `${msg}: ${a} vs ${b}`);
const guards = (r, p) => r.enemies.filter(e => e.outpost === p && !e.dead);

for (const mode of ['night', 'lunch']) {
	const { r, hs, p, nt } = setup(8, mode), early = guards(r, p)[0];
	const ids = new Set(r.enemies.map(e => e.id));
	r.time = r.finPlan.pre - 1;
	r.killEnemy(guards(r, p)[1], hs[0]); r.compactEnemies(); r.updateOutposts(hs);
	const late = guards(r, p).find(e => !ids.has(e.id)); assert.ok(late, 'real reserve enters after a late combat death');
	close(late.maxHp / late.def.hp, early.maxHp / early.def.hp, 'late reserve keeps the cohort HP scale');
	close(late.dmg / late.def.dmg, early.dmg / early.def.dmg, 'late reserve keeps the cohort damage scale');
	assert.equal(r.outposts.creationNt, nt); assert.equal(p.total, 40);
	const fraction = .37; early.hp = early.maxHp * fraction;
	for (const pid of [8, 7, 6, 5, 4]) r.removePlayer(pid);
	const alive = [...r.heroes.values()];
	const expectedHp = type => ENEMIES[type].hp * enemyHpScale(nt, 3) * r.modeHp * 1.5;
	const expectedDmg = type => ENEMIES[type].dmg * enemyDmgScale(nt, 3) * r.modeDmg * 1.15;
	close(early.maxHp, expectedHp(ENEMY_TYPES[early.type]), 'late leave rescales existing guards at cohort time');
	close(early.hp / early.maxHp, fraction, 'late leave preserves the damaged health fraction');
	close(early.dmg, expectedDmg(ENEMY_TYPES[early.type]), 'late leave rescales damage at cohort time');
	const afterLeaveIds = new Set(r.enemies.map(e => e.id));
	r.killEnemy(guards(r, p).find(e => e !== early), alive[0]); r.compactEnemies(); r.updateOutposts(alive);
	const next = guards(r, p).find(e => !afterLeaveIds.has(e.id)); assert.ok(next);
	close(next.maxHp, expectedHp(ENEMY_TYPES[next.type]), 'pending uses the same cohort and new group as living guards');
	close(next.dmg, expectedDmg(ENEMY_TYPES[next.type]), 'pending damage follows the new group without late inflation');
	const untouched = r.outposts.posts[1]; alive[0].x = untouched.x; alive[0].y = untouched.y; r.updateOutposts(alive);
	for (const e of guards(r, untouched)) close(e.maxHp, expectedHp(ENEMY_TYPES[e.type]), 'first late approach also uses the cohort');
	assert.equal(r.outposts.target, 9); assert.equal(r.outposts.liveLimit, 32);
	r.resync(1); assert.equal(r.snapshot().op.guards, 360, 'leave/reconnect never recalculates total guards');
	console.log(`cohort ${mode}: NT${nt}→${r.nt.toFixed(1)}, real late reserve, leave8→3, HP fraction and untouched post: OK`);
}

for (const n of [1, 2, 4, 8]) for (const mode of ['night', 'lunch']) {
	const { r, hs, p, nt } = setup(n, mode);
	for (const type of ['skel', 'brute', 'shield', 'sniper']) {
		const guard = guards(r, p).find(e => e.def === ENEMIES[type]);
		const normal = r.spawnEnemy(type, hs, enemyHpScale(nt, n));
		close(guard.maxHp / normal.maxHp, 1.5, 'same-cohort HP');
		close(guard.dmg / normal.dmg, 1.15, 'same-cohort contact damage');
		if (type === 'shield') {
			const front = e => { e.fa = 0; return e.maxHp / r.shieldMul(e, { x: e.x + 100, y: e.y }); };
			close(front(guard) / front(normal), 1.5, 'same-cohort frontal EHP');
		}
		if (type === 'sniper') {
			const volley = e => { r.hostile.length = 0; e.windT = .01; e.bvx = 1; e.bvy = 0; r.sniperTick(e, hs[0], 100, .1); return r.hostile.map(s => s.dmg); };
			const a = volley(guard), b = volley(normal);
			assert.equal(a.length, ENEMIES.sniper.fan); assert.equal(a.length, b.length);
			close(a.reduce((a, b) => a + b, 0) / b.reduce((a, b) => a + b, 0), 1.15, 'actual sniper volley DPS at unchanged cadence');
		}
		r.setElite(normal, 'armored');
		assert.ok(guard.maxHp * guard.dmg < normal.maxHp * normal.dmg, 'same-type HP×contact damage stays below elite');
		for (const boss of ['brood', 'ram', 'gunner', 'twin']) {
			const hp = ENEMIES[boss].hp * bossHpScale(nt, n, 2) * r.modeHp;
			assert.ok(guard.maxHp < hp, 'individual guard health below the third-slot named miniboss benchmark');
		}
	}
}
console.log('Outpost cohort: constant40, HP1.5/contact+actual volley1.15, same-type EHP/elite and named miniboss benchmark: OK');
