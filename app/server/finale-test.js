// v21 finale «Последний рубеж»: schedule, the wall, the prelude, absorbing the horde, the Lord's hp, packs, rage and the
// ray of dawn, the three endings, pause / resync, load. node server/finale-test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Room } from './game.js';
import {
	TICK_HZ, ENEMIES, WARN_MIN, FINALE, finaleFight, finaleRingR, finaleHpMul, clampToRing, bossTimes, peakSchedule, bossHpScale,
	modeHpMul, finaleAddScale, finaleAddCap, spawnRateScale, PLAYER_RADIUS, REVIVE_HP_FRACTION, GAME_VERSION, MODES, mergeAchStats,
} from '../public/shared/content.js';
import { PROTO } from './snapshot-codec.js';

const dt = 1 / TICK_HZ;
const HEROES8 = ['knight', 'witch', 'ranger', 'herald', 'smith', 'stormcaller', 'alchemist', 'spearmaiden'];
// A room with weaponless heroes (nothing dies unless the test says so) standing together; msgs collects what is sent to pid 1.
function room(n = 1, mode = 'night', weapons = false) {
	const msgs = [];
	const r = new Room('FIN', (pid, msg) => { if (pid === 1) msgs.push(msg); });
	r.setMode(mode);
	for (let i = 0; i < n; i++) r.addPlayer(i + 1, 'P' + (i + 1), HEROES8[i]);
	r.start();
	r.events.next = Infinity;
	for (const h of r.heroes.values()) if (!weapons) h.weapons = new Map();
	r.msgs = msgs;
	return r;
}
const hero = (r, pid) => r.heroes.get(pid);
const alive = (r) => [...r.heroes.values()].filter((h) => h.st === 0);
// Every fx of a kind so far as [time, ...fx]: the ones already sent in snapshots and the ones still waiting for the next one.
const fxOf = (r, kind) => [
	...r.msgs.filter((m) => m.t === 's').flatMap((m) => m.fx.filter((f) => f[0] === kind).map((f) => [m.tm, ...f])),
	...(r.state === 'play' ? r.fx.filter((f) => f[0] === kind).map((f) => [r.time, ...f]) : []),
];
const over = (r) => r.msgs.find((m) => m.t === 'over');
// Ticks until `until()` or the time is up; heroes are kept alive and offers declined unless `raw`.
function run(r, sec, until = null, raw = false) {
	for (let i = 0; i < Math.round(sec * TICK_HZ) && r.state === 'play'; i++) {
		for (const h of r.heroes.values()) {
			if (!raw && h.st === 0) { h.hp = h.maxHp; h.iframes = 9; }
			while (h.offer) r.handle(h.pid, { t: 'skip' });
		}
		r.tick(dt);
		if (until?.()) return true;
	}
	return false;
}
// Jumps to `before` seconds ahead of the prelude with the bosses already «spawned», then runs into the fight.
function toPrelude(r, before = 0.5) {
	r.bossIdx = r.bossAt.length - 1;
	r.time = r.finPlan.pre - before;
	r.nextEliteT = r.nextInvasionT = Infinity;
}
function toFight(r) {
	toPrelude(r);
	assert.ok(run(r, FINALE.prelude + 2, () => r.fin?.lord), 'the Lord came out');
	return r.fin.lord;
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

assert.equal(GAME_VERSION, 'v30');
assert.equal(PROTO, 23);

// --- 1. schedule ---
{
	const n = room(1, 'night'), l = room(1, 'lunch');
	assert.deepEqual([n.finPlan.warn, n.finPlan.pre, n.finPlan.lord, n.peaks.at(-1).at], [811, 815, 825, 885], 'night: 13:31 / 13:35 / 13:45 / 14:45');
	assert.deepEqual([l.finPlan.warn, l.finPlan.pre, l.finPlan.lord, l.peaks.at(-1).at], [526, 530, 540, 585], 'lunch: 8:46 / 8:50 / 9:00 / 9:45');
	assert.equal(bossTimes(900).at(-1), 825);
	assert.equal(bossTimes(600).at(-1), 540);
	assert.equal(peakSchedule(900, bossTimes(900)).at(-1).at, 885, '«Светает» is not moved past the Lord');
	assert.ok(n.peaks.at(-1).burn && n.peaks.at(-1).id === 'dawn' && !n.peaks.at(-1).spawnMul, 'dawn: speed only, no extra horde');
	assert.equal(finaleFight(900), 75);
	assert.equal(finaleFight(600), 60);
	assert.equal(finaleFight(300), 30, 'custom length: 10%');
	assert.equal(finaleFight(100), 0, 'short runs have no finale');
	const s = room(1);
	s.runLength = 100;
	s.resetSim();
	assert.equal(s.finPlan, null);
	assert.equal(s.bossAt.at(-1), 70, 'short run: the Lord 30 s before the end, as before');
	// No event may start later than 60 s before the prelude.
	for (const r of [n, l]) {
		r.time = r.finPlan.pre - 59;
		assert.ok(r.events.blocked(), 'events are blocked 60 s before the prelude');
		r.time = r.runLength - 20;
		assert.ok(r.events.blocked(), 'and all the way to the end');
	}
	// The warning and the prelude fire once, in order.
	const r = room(1);
	r.bossIdx = r.bossAt.length - 1;
	r.time = r.finPlan.warn - 0.5;
	r.nextEliteT = r.nextInvasionT = Infinity;
	run(r, 6);
	const w = fxOf(r, 'finw'), p = fxOf(r, 'fin').filter((f) => f[2] === 1);
	assert.ok(w.length === 1 && p.length === 1 && close(w[0][0], 811, 0.001) && close(p[0][0], 815, 0.001), `finw ${w[0]?.[0]}, fin 1 ${p[0]?.[0]}`);
	console.log('1 schedule: OK');
}

// --- 2. the wall ---
{
	assert.deepEqual(clampToRing(100, 0, 0, 0, 50), [50, 0]);
	assert.deepEqual(clampToRing(10, 5, 0, 0, 50), [10, 5]);
	const [x, y] = clampToRing(300, 400, 0, 0, 100);
	assert.ok(close(x, 60) && close(y, 80));
	assert.deepEqual([1, 2, 4, 8].map(finaleRingR), [440, 465, 515, 615]);
	// The client predicts with the same function from the shared module.
	const client = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8');
	assert.ok(/import \{[^}]*clampToRing[^}]*\} from '\/shared\/content\.js'/.test(client) && client.includes('clampToRing(this.local.x, this.local.y'), 'client prediction uses the shared clampToRing');

	// A pos outside the ring comes back onto the circle; a downed ally 900 px away is dragged inside during the prelude.
	const r = room(2);
	const [a, b] = [hero(r, 1), hero(r, 2)];
	a.x = 0; a.y = 0;
	b.x = 900; b.y = 0;
	b.st = 1;
	toPrelude(r);
	run(r, 1, () => r.fin);
	const f = r.fin;
	assert.deepEqual([f.cx, f.cy, f.r1], [0, 0, 465], 'the ring is centred on the alive hero');
	assert.ok(f.r > 900 && f.r <= 900 + FINALE.ring.pad, `starts wide enough for the downed one: ${f.r}`);
	run(r, FINALE.prelude + 1, () => r.fin.lord);
	assert.equal(f.r, f.r1, 'closed by the time the Lord comes');
	assert.ok(Math.hypot(b.x - f.cx, b.y - f.cy) <= f.r1 - PLAYER_RADIUS + 0.01, 'the downed hero is inside');
	a.iframes = 99;
	for (let i = 0; i < 90; i++) {
		a.lastPosT = r.time - 1;
		r.handle(1, { t: 'pos', x: a.x + 40, y: a.y, fx: 1, fy: 0 });
		assert.ok(Math.hypot(a.x - f.cx, a.y - f.cy) <= f.r - PLAYER_RADIUS + 0.01, 'pos is projected into the ring');
	}
	assert.ok(close(a.x, f.r1 - PLAYER_RADIUS, 1e-3), `the hero stands at the wall: ${a.x}`);
	a.x = 5000;
	run(r, dt);
	assert.ok(close(Math.hypot(a.x - f.cx, a.y - f.cy), f.r - PLAYER_RADIUS, 1e-3), 'a hero outside is put back on the circle');
	// The Lord's charge does not carry him through the wall.
	const lord = r.fin.lord;
	lord.immuneT = 0;
	lord.x = f.cx + f.r - 60; lord.y = f.cy;
	lord.bs = 'dash'; lord.bvx = 1; lord.bvy = 0; lord.bt = 0.5;
	run(r, 0.5);
	assert.ok(Math.hypot(lord.x - f.cx, lord.y - f.cy) <= f.r - lord.r + 0.01, 'the Lord stays inside after a charge');
	console.log('2 wall: OK');
}

// --- 3. prelude: no regular spawn, specials, elites or invasions ---
{
	const r = room(2);
	toPrelude(r, 6);
	r.nextEliteT = r.nextInvasionT = r.finPlan.pre + 1;
	run(r, 5.5);
	assert.ok(r.enemies.length > 20, 'the horde spawns before the prelude');
	run(r, 1, () => r.fin);
	const pre = r.time;
	for (const id of Object.keys(r.specialT)) r.specialT[id] = 0;
	run(r, FINALE.prelude - 0.5);
	assert.ok(!r.fin.lord, 'still the prelude');
	assert.equal(r.enemies.filter((e) => e.born > pre).length, 0, 'nothing is born during the prelude');
	assert.ok(!r.enemies.some((e) => e.elite), 'no elite');
	assert.equal(fxOf(r, 'inv').length, 0, 'no invasion');
	assert.ok(r.enemies.length > 0, 'the living horde stays and attacks');
	const snap = r.snapshot();
	assert.equal(snap.fin[0], 1);
	assert.ok(snap.fin[1] > 0 && snap.fin[1] <= FINALE.prelude, 'seconds to the Lord');
	console.log('3 prelude: OK');
}

// --- 4. absorbing the horde ---
{
	const r = room(2);
	toPrelude(r, 6);
	run(r, 6 + FINALE.prelude - 0.3);
	const ram = r.spawnBoss('ram', alive(r), 3);
	r.hostile.push({ id: r.nextId++, x: 0, y: 0, vx: 0, vy: 0, life: 9, dmg: 1, from: 'x' });
	// v28: the heroes' weapons used to finish an enemy in the last 0.3 s before the absorption now and then (flaky since v23):
	// disarm them and drop whatever still flies, burns or waits, so only the absorption itself is measured.
	for (const h of r.heroes.values()) h.weapons.clear();
	r.projectiles.length = r.puddles.length = r.traps.length = r.blasts.length = 0;
	for (const e of r.enemies) e.burnT = 0;
	const before = { enemies: r.enemies.filter((e) => !e.dead).length, kills: r.kills, gems: r.gems.length, bossKills: r.bossKills, lvl: alive(r).map((h) => h.level) };
	assert.ok(before.enemies > 20);
	run(r, 1, () => r.fin.lord);
	const lord = r.fin.lord;
	assert.equal(r.enemies.filter((e) => !e.dead && e !== lord).length, 0, 'everyone but the Lord is gone');
	assert.ok(ram.dead && !r.bosses.includes(ram) && r.bosses.length === 1 && r.bosses[0] === lord);
	assert.equal(r.kills, before.kills, 'no kills');
	assert.equal(r.gems.length, before.gems, 'no gems');
	assert.equal(r.bossKills, before.bossKills, 'the absorbed boss is not a kill');
	assert.deepEqual(alive(r).map((h) => h.level), before.lvl);
	assert.equal(r.hostile.length, 0, 'enemy shots are cleared');
	assert.ok(alive(r).every((h) => !h.offer), 'no chest for the absorbed boss');
	const ab = fxOf(r, 'absorb');
	assert.ok(ab.length === 1 && ab[0][2] === before.enemies, `absorb fx counts the horde: ${ab[0]?.[2]} vs ${before.enemies}`);
	assert.ok(fxOf(r, 'boss').some((f) => f[2] === ENEMIES.boss.name));
	assert.ok(r.runLog.bosses.find((b) => b.type === 'ram').absorbed, 'log: absorbed');
	assert.equal(r.runLog.fin.absorbed, before.enemies);
	// The Lord comes out harmless and immune for lordSpawnWarn seconds, then fights.
	const h = hero(r, 1);
	assert.equal(r.hurtEnemy(lord, 100, h), 0, 'immune while coming out');
	const x0 = lord.x;
	run(r, FINALE.lordSpawnWarn - 0.2);
	assert.equal(lord.x, x0, 'stands still');
	run(r, 0.4);
	assert.ok(r.hurtEnemy(lord, 100, h) > 0, 'takes damage afterwards');
	assert.equal(r.snapshot().fin[0], 2);
	console.log('4 absorb: OK');
}

// --- 5. the Lord's hp for 1, 2, 4, 8 players in both modes; a player leaving ---
{
	const table = {};
	for (const mode of ['night', 'lunch']) for (const n of [1, 2, 4, 8]) {
		const r = room(n, mode);
		r.time = r.finPlan.lord;
		const lord = r.finaleLord(alive(r), 4);
		const want = ENEMIES.boss.hp * bossHpScale(r.nt, n, 4) * modeHpMul(mode, n) * finaleHpMul(mode, n);
		assert.ok(close(lord.maxHp, want), `${mode} ${n}: ${lord.maxHp} vs ${want}`);
		(table[mode] ??= []).push(Math.round(lord.maxHp));
		if (n === 2) {
			r.removePlayer(2);
			const solo = ENEMIES.boss.hp * bossHpScale(r.nt, 1, 4) * modeHpMul(mode, 1) * finaleHpMul(mode, 1);
			assert.ok(close(lord.maxHp, solo), `${mode}: rescaled to solo ${lord.maxHp} vs ${solo}`);
			assert.equal(r.fin.r1, finaleRingR(2), 'the arena keeps its size');
		}
	}
	assert.ok(table.night.every((v, i, a) => i === 0 || v > a[i - 1]), 'more players — more hp');
	console.log(`5 Lord hp: OK (night ${table.night.join(' / ')}, lunch ${table.lunch.join(' / ')})`);
}

// --- 6. packs ---
{
	const sizes = [];
	for (const n of [1, 2, 4, 8]) {
		const r = room(n);
		const lord = toFight(r);
		const t0 = r.time;
		const want = r.finaleAddCount(alive(r));
		run(r, FINALE.adds.first - 0.2);
		assert.equal(r.enemies.filter((e) => e.add).length, 0, 'the first pack comes after adds.first');
		run(r, 0.4);
		const adds = r.enemies.filter((e) => e.add && !e.dead);
		assert.equal(adds.length, Math.min(want, finaleAddCap(n)), `pack size for ${n}: ${adds.length}`);
		assert.ok(adds.every((e) => close(e.xp, e.def.xp * FINALE.adds.xpMul)), 'xp ×0.5');
		const f = r.fin;
		assert.ok(adds.every((e) => Math.hypot(e.x - f.cx, e.y - f.cy) < f.r1 + FINALE.ring.addsOut + 40), 'packs step out of the wall');
		sizes.push(want);
		// Nobody kills them: the field never holds more than the cap of packs.
		lord.bcd = 1e9;
		let max = 0;
		run(r, 40, () => { max = Math.max(max, r.enemies.filter((e) => e.add && !e.dead).length); });
		assert.ok(max <= finaleAddCap(n), `cap ${max}`);
		assert.ok(r.time - t0 > 30 && r.runLog.fin.adds.pulses >= 6);
		if (n === 8) assert.equal(max, finaleAddCap(8), 'eight players reach the cap');
	}
	// v23: solo and pair unchanged; from three players a pack is sized for one player and the cap is lower (#9FKPYY).
	assert.ok(sizes[1] > sizes[0], `the pair's pack is bigger than solo: ${sizes}`);
	assert.deepEqual([finaleAddScale(1), finaleAddScale(2)], [spawnRateScale(1), spawnRateScale(2)]);
	assert.ok(sizes[2] === sizes[0] && sizes[3] === sizes[0], `3+ players: a solo-sized pack: ${sizes}`);
	assert.ok(finaleAddCap(3) < FINALE.adds.cap && finaleAddCap(2) === FINALE.adds.cap);
	console.log(`6 packs: OK (${sizes.join(' / ')} per pack)`);
}

// --- 7. rage: a charge with a warning, the ray of dawn once, not for solo or the dropped ---
{
	const r = room(3);
	const [a, b, c] = [hero(r, 1), hero(r, 2), hero(r, 3)];
	const lord = toFight(r);
	run(r, FINALE.lordSpawnWarn + 0.2);
	r.setOffline(3, true);
	assert.equal(c.st, 1);
	r.downHero(b, 'boss');
	lord.x = r.fin.cx; lord.y = r.fin.cy;
	a.x = lord.x + 300; a.y = lord.y;
	const revives = a.revives;
	r.hurtEnemy(lord, lord.maxHp * 0.51, a);
	a.iframes = 9;
	run(r, dt, null, true); // raw: the helper would refill the risen hero's hp
	const rage = fxOf(r, 'fin').filter((f) => f[2] === 3), ray = fxOf(r, 'ray');
	assert.ok(rage.length === 1 && ray.length === 1 && ray[0][2] === 1, 'rage and the ray with one hero lifted');
	assert.ok(b.st === 0 && close(b.hp, b.maxHp * REVIVE_HP_FRACTION, 0.2), 'the downed one rises with half hp');
	assert.equal(c.st, 1, 'the dropped one stays down');
	assert.equal(a.revives, revives, 'nobody is credited with the revive');
	assert.equal(r.runLog.fin.revived, 1);
	assert.equal(r.snapshot().fin[0], 3);
	r.downHero(b, 'boss');
	run(r, 1);
	assert.equal(b.st, 1, 'the ray comes once');
	assert.equal(fxOf(r, 'fin').filter((f) => f[2] === 3).length, 1);
	assert.equal(fxOf(r, 'ray').length, 1);
	// The charge is warned ≥ WARN_MIN ahead.
	a.x = lord.x + 300; a.y = lord.y;
	lord.dcd = 0;
	// Lanes of the Lord only (width = his diameter): a Трубач born before the prelude draws lanes too.
	const lanes = (q) => fxOf(q, 'bline').filter((f) => f[6] === ENEMIES.boss.r * 2);
	run(r, 4, () => lanes(r).length);
	const lane = lanes(r)[0];
	assert.ok(lane && lane.at(-1) >= WARN_MIN, `charge lane warns ${lane?.at(-1)} s`);
	assert.ok(ENEMIES.boss.dashWarn >= WARN_MIN);
	// Before rage the Lord never charges.
	const q = room(2);
	const l2 = toFight(q);
	l2.dcd = 0;
	run(q, 12);
	assert.equal(lanes(q).length, 0, 'no charge before rage');
	// Solo: no ray.
	const s = room(1);
	const l3 = toFight(s);
	run(s, FINALE.lordSpawnWarn + 0.2);
	s.hurtEnemy(l3, l3.maxHp * 0.51, hero(s, 1));
	run(s, dt * 2);
	assert.equal(fxOf(s, 'fin').filter((f) => f[2] === 3).length, 1);
	run(s, 40);
	assert.equal(fxOf(s, 'ray').length, 0, 'solo: no ray');
	// v23: no rage by the middle of the fight — the ray comes there (once).
	const m = room(3);
	const l4 = toFight(m);
	const mid = m.fin.fightAt + m.finPlan.fight * FINALE.rayAt;
	run(m, mid - m.time - 1);
	m.downHero(hero(m, 2), 'boss');
	run(m, 0.8, null, true);
	assert.equal(fxOf(m, 'ray').length, 0, 'not before the middle');
	run(m, 0.5, null, true);
	assert.ok(!m.fin.rage && fxOf(m, 'ray').length === 1 && hero(m, 2).st === 0, 'the ray at the middle without rage');
	assert.ok(close(m.runLog.fin.rayAt, m.finPlan.fight * FINALE.rayAt, 0.05) && m.runLog.fin.revived === 1);
	m.downHero(hero(m, 2), 'boss');
	m.hurtEnemy(l4, l4.maxHp * 0.6, hero(m, 1));
	run(m, 1, null, true);
	assert.ok(m.fin.rage && fxOf(m, 'ray').length === 1 && hero(m, 2).st === 1, 'rage after it brings no second ray');
	// 3+: nobody down at the middle — the ray waits and comes with the first down.
	const w = room(3);
	toFight(w);
	run(w, w.fin.fightAt + w.finPlan.fight * FINALE.rayAt - w.time + 2);
	assert.equal(fxOf(w, 'ray').length, 0, 'a healthy group keeps the ray');
	w.downHero(hero(w, 3), 'boss');
	run(w, 0.2, null, true);
	assert.ok(fxOf(w, 'ray').length === 1 && hero(w, 3).st === 0, 'the ray comes with the first down');
	// A pair keeps the v21 rule: nothing at the middle, the ray at rage.
	const d = room(2);
	const l5 = toFight(d);
	run(d, d.fin.fightAt + d.finPlan.fight * FINALE.rayAt - d.time + 1);
	d.downHero(hero(d, 2), 'boss');
	run(d, 0.5, null, true);
	assert.equal(fxOf(d, 'ray').length, 0, 'pair: no ray at the middle');
	d.hurtEnemy(l5, l5.maxHp * 0.6, hero(d, 1));
	run(d, 0.2, null, true);
	assert.ok(fxOf(d, 'ray').length === 1 && hero(d, 2).st === 0, 'pair: the ray at rage');
	console.log('7 rage and the ray: OK');
}

// --- 8. the Lord is slain: dawn at once, grade 2 ---
{
	const r = room(2);
	const lord = toFight(r);
	run(r, 10);
	const a = hero(r, 1), b = hero(r, 2);
	r.hurtEnemy(lord, lord.maxHp * 0.3, b);
	r.hurtEnemy(lord, lord.maxHp, a);
	assert.equal(r.state, 'play', 'the run ends at the end of the tick');
	run(r, dt);
	const o = over(r);
	assert.ok(r.state === 'over' && o, 'over');
	assert.ok(o.win === true && o.grade === 2);
	assert.ok(o.time < o.len - 30, `ends early: ${o.time}`);
	const iDawn = r.msgs.findIndex((m) => m.t === 's' && m.fx.some((f) => f[0] === 'dawn')), iOver = r.msgs.indexOf(o);
	assert.ok(iDawn >= 0 && iDawn < iOver, 'dawn fx before over');
	const last = r.msgs[iDawn].fx;
	assert.ok(last.findIndex((f) => f[0] === 'lorddie') >= 0 && last.findIndex((f) => f[0] === 'lorddie') < last.findIndex((f) => f[0] === 'dawn'), 'lorddie, then dawn');
	assert.equal(last.find((f) => f[0] === 'lorddie')[1], 1, 'last hit pid');
	assert.equal(fxOf(r, 'chest').length, 0, 'no chest');
	assert.ok(!r.msgs.some((m) => m.t === 'lvl' && m.spin), 'no boss chest offer');
	assert.ok(o.stats.every((s) => s.ach.lords === 1 && s.ach.wins === 1));
	assert.ok(o.fin && o.fin.killedAt !== null && o.fin.hpLeft === 0 && o.fin.lastHit === 'P1' && o.fin.sec > 9);
	const shares = Object.fromEntries(o.fin.by.map((x) => [x.pid, x.share]));
	assert.ok(close(shares[1], 0.7, 0.02) && close(shares[2], 0.3, 0.02), `shares ${JSON.stringify(shares)}`);
	assert.ok(o.log.grade === 2 && o.log.win && o.log.finale.grade === 2 && o.log.finale.lastHit === 'P1' && o.log.finale.lordHp === Math.round(lord.maxHp));
	assert.ok(o.log.summary.some((l) => l.startsWith('Финал') && l.includes('Владыка повержен')), 'summary line');
	assert.ok(o.log.summary[0].includes('Владыка повержен'));
	assert.equal(mergeAchStats({ lords: 2 }, o.stats[0].ach).lords, 3, 'the crown counter adds up');
	console.log('8 kill: OK');
}

// --- 9. lived to the dawn: grade 1 ---
{
	const r = room(1, 'lunch');
	const lord = toFight(r);
	run(r, 5);
	r.hurtEnemy(lord, lord.maxHp * 0.25, hero(r, 1));
	run(r, 70);
	const o = over(r);
	assert.ok(o && o.win === true && o.grade === 1 && o.time >= o.len - 0.1);
	assert.ok(o.fin.hpLeft > 0 && o.fin.hpLeft <= 1 && close(o.fin.hpLeft, 0.75, 0.01) && o.fin.killedAt === null && o.fin.lastHit === null);
	assert.ok(o.stats[0].ach.lords === 0 && o.stats[0].ach.wins === 1);
	assert.ok(fxOf(r, 'dawn').length === 1 && fxOf(r, 'lorddie').length === 0);
	assert.ok(fxOf(r, 'fin').some((f) => f[2] === 4), '«Светает» phase');
	assert.ok(fxOf(r, 'peak').length >= 1);
	assert.ok(o.log.finale.grade === 1 && o.log.summary.some((l) => l.startsWith('Финал') && l.includes('дожили')));
	// «Светает»: the Lord's cooldown is shorter.
	const q = room(1);
	const l2 = toFight(q);
	q.time = q.runLength - 14;
	run(q, 0.2);
	assert.ok(q.fin.last && q.peak?.id === 'dawn');
	l2.bcd = 0; l2.bs = 0; l2.immuneT = 0;
	hero(q, 1).x = l2.x + 200; hero(q, 1).y = l2.y;
	run(q, dt);
	assert.ok(close(l2.bcd, ENEMIES.boss.cd * FINALE.lastCd, 0.05), `cooldown in «Светает»: ${l2.bcd}`);
	console.log('9 survive: OK');
}

// --- 10. the group falls in the finale: grade 0, the finale is in the log ---
{
	const r = room(1);
	const lord = toFight(r);
	run(r, FINALE.lordSpawnWarn + 0.5);
	const h = hero(r, 1);
	h.x = lord.x; h.y = lord.y;
	h.hp = 1; h.iframes = 0;
	run(r, 1, null, true);
	const o = over(r);
	assert.ok(o && o.win === false && o.grade === 0);
	assert.ok(o.fin && o.fin.hpLeft === 1 && o.fin.killedAt === null);
	assert.ok(o.log.finale && o.log.finale.at !== null && o.log.finale.grade === 0 && o.log.finale.downs.P1 === 1);
	assert.equal(o.log.finale.downsBy.contact, 1);
	assert.equal(o.stats[0].ach.lords, 0);
	// Falling in the prelude: the section says the Lord never came.
	const q = room(1);
	toPrelude(q);
	run(q, 2);
	q.downHero(hero(q, 1), 'bat');
	run(q, dt, null, true);
	assert.ok(q.lastLog.finale && q.lastLog.finale.at === null && over(q).fin === null);
	assert.ok(q.lastLog.summary.some((l) => l.startsWith('Финал: кольцо сомкнулось')));
	console.log('10 loss: OK');
}

// --- 11. solo pause and a reconnect in the finale ---
{
	const r = room(1);
	toFight(r);
	run(r, 5);
	const before = r.snapshot().fin;
	r.setPaused(true);
	assert.ok(r.frozen);
	const t = r.time;
	for (let i = 0; i < 30; i++) r.tick(dt);
	assert.equal(r.time, t, 'the fight waits');
	r.setPaused(false);
	run(r, dt);
	const after = r.snapshot().fin;
	assert.deepEqual(after.slice(2), before.slice(2), 'the same ring');
	assert.equal(after[0], before[0]);
	// Reconnect: `start`, then a key snapshot that carries `fin`.
	const n0 = r.msgs.length;
	r.resync(1);
	run(r, 0.5);
	const fresh = r.msgs.slice(n0);
	assert.equal(fresh[0].t, 'start');
	assert.ok(fresh.some((m) => m.t === 's' && Array.isArray(m.fin) && m.fin[0] === 2 && m.fin[5] === finaleRingR(1)));
	// A pair: the dropped hero is dragged along and the run goes on.
	const p = room(2);
	toFight(p);
	p.setOffline(2, true);
	run(p, 1);
	assert.ok(p.state === 'play' && hero(p, 2).st === 1 && !p.frozen);
	p.setOffline(2, false);
	console.log('11 pause / resync: OK');
}

// --- 12. load: eight armed heroes, the whole fight ---
{
	const r = room(8, 'night', true);
	toPrelude(r, 8);
	// Reference: the tick of the regular horde right before the prelude, on this machine under its current load.
	run(r, 7.5);
	const tRef = performance.now();
	const n0 = r.tickNo;
	run(r, 0.4);
	const refAvg = (performance.now() - tRef) / Math.max(1, r.tickNo - n0);
	run(r, FINALE.prelude + 1, () => r.fin?.lord);
	let maxAdds = 0, maxAll = 0;
	run(r, MODES.night.seconds, () => {
		let adds = 0, all = 0;
		for (const e of r.enemies) if (!e.dead) { all++; if (e.add) adds++; }
		maxAdds = Math.max(maxAdds, adds);
		maxAll = Math.max(maxAll, all);
	});
	const L = r.lastLog.finale.load;
	assert.ok(maxAdds <= FINALE.adds.cap, `packs on the field ${maxAdds}`);
	assert.ok(maxAll <= FINALE.adds.cap + 1 + 60, `enemies on the field ${maxAll}`);
	// The fight is not heavier than the horde before it (the 3 ms budget holds on an idle machine; a busy one scales both).
	assert.ok(L.tickAvg < Math.max(3, refAvg * 1.5), `tick avg ${L.tickAvg} ms vs ${refAvg.toFixed(2)} ms before the finale`);
	console.log(`12 load: OK (8 players: enemies max ${maxAll}, packs max ${maxAdds}, tick avg ${L.tickAvg} ms, max ${L.tickMs} ms; before the finale ${refAvg.toFixed(2)} ms)`);
}
console.log('finale-test: OK');
