import assert from 'node:assert/strict';
import { Room } from './game.js';
import { ENEMIES, enemyHpScale } from '../public/shared/content.js';

// Issue #23: every Трубач volley is preceded by five fresh lanes and the full windup, even after a freeze
// (or a root) interrupted the previous windup and the old lanes have already faded on the client.
const dt = 1 / 30, W = ENEMIES.sniper.windup, eps = 1e-6;
function arena(kind, mode) {
	const r = new Room('THAW', () => {}); r.setMode(mode); r.addPlayer(1, 'One', 'knight'); r.start();
	r.enemies.length = 0; r.time = r.runLength * 2 / 3;
	const h = r.heroes.get(1); h.weapons.clear(); h.perk.readyAt = Infinity; h.hp = h.maxHp = 1e9;
	let e, center = { x: h.x, y: h.y };
	if (kind === 'guard') {
		r.updateOutposts([h]); center = r.outposts.posts[0]; h.x = center.x; h.y = center.y; r.updateOutposts([h]);
		e = r.enemies.find(e => e.outpost === center && e.ai === 'sniper'); assert.ok(e);
		for (const other of r.enemies) if (other !== e) r.killEnemy(other, h);
		r.compactEnemies(); r.time = Math.max(r.time, e.guardReadyAt ?? 0);
		e.x = center.x + 210; e.y = center.y;
	} else {
		e = r.spawnEnemy('sniper', [h], enemyHpScale(r.nt, 1));
		e.x = h.x + 500; e.y = h.y;
	}
	e.shotT = 0; e.windT = 0; e.hp = e.maxHp = 1e9;
	r.fx.length = 0;
	return { r, h, e };
}

// Ticks the room and checks every volley against the lanes last shown for this sniper.
function run(fixture, seconds, onTick = () => {}) {
	const { r, h, e } = fixture;
	const volleys = [];
	for (let t = 0; t < seconds; t += dt) {
		onTick(t);
		r.time += dt; r.fx.length = 0; r.moveEnemies(dt, [h]);
		const lanes = r.fx.filter(fx => fx[0] === 'bline');
		if (lanes.length) {
			assert.equal(lanes.length, ENEMIES.sniper.fan, 'a telegraph always shows the whole fan');
			assert.ok(lanes.every(l => l[6] === W), 'lanes last exactly the windup');
			fixture.shown = { at: r.time, lanes };
		}
		const orbs = r.fx.filter(fx => fx[0] === 'eorb');
		if (!orbs.length) continue;
		const shown = fixture.shown;
		assert.ok(shown, 'a volley never comes without lanes');
		assert.ok(r.time - shown.at >= W - dt / 2 - eps, `volley ${(r.time - shown.at).toFixed(3)} s after its lanes, expected ≥ ${W}`);
		assert.ok(r.time - shown.at <= W + dt + eps, 'the lanes are still on screen when the volley leaves');
		assert.equal(orbs.length, ENEMIES.sniper.fan);
		for (const [i, o] of orbs.entries()) {
			const s = r.hostile.find(s => s.id === o[1]), lane = shown.lanes[i];
			assert.equal(lane[1], Math.round(s.x)); assert.equal(lane[2], Math.round(s.y));
			const endX = s.x + s.vx * s.life, endY = s.y + s.vy * s.life;
			assert.ok(Math.abs(lane[3] - endX) <= 1 && Math.abs(lane[4] - endY) <= 1, `orb ${i} flies along its lane`);
		}
		fixture.shown = null;
		volleys.push(r.time);
		r.hostile.length = 0;
	}
	return volleys;
}

for (const mode of ['lunch', 'night']) for (const kind of ['guard', 'ordinary']) for (const ctrl of ['freeze', 'root', 'none']) for (const shove of [false, true]) {
	const f = arena(kind, mode), { r, h, e } = f;
	const label = `${mode} ${kind} ${ctrl}${shove ? ' + knock' : ''}`;
	// Start a windup, then lock the sniper mid-windup for longer than the lanes stay on screen.
	run(f, dt);
	assert.ok(e.windT > 0 && f.shown, `${label}: windup started`);
	run(f, 0.3);
	if (ctrl === 'freeze') assert.ok(r.freeze(e, 1.5)); else if (ctrl === 'root') e.rootT = r.time + 1.5;
	if (shove) r.knock(e, h.x, h.y, 30);
	const volleys = run(f, 1.5 + W + 0.5);
	if (ctrl === 'none') assert.ok(volleys.length >= 1, `${label}: the sniper keeps firing`);
	else assert.equal(volleys.length, 1, `${label}: one volley after thaw`);
	console.log(`${label}: every volley follows its own 5 lanes after the full ${W} s windup: OK`);
}
