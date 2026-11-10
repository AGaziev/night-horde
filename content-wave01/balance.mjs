// node balance.mjs kite 4 knight,witch,ranger,herald 3 [900]   |   node balance.mjs idle 1 knight 3
// APP=<dir with server/ and public/> selects a code variant (default ../app).
const APP = process.env.APP ?? new URL('../app/', import.meta.url).pathname;
const { Room } = await import(APP + '/server/game.js');
const { TICK_HZ } = await import(APP + '/public/shared/content.js');
// Bots pick by weight: slot 1 more often, but any card can win.
const PICK_W = [0.5, 0.3, 0.2];
const weightedPick = (n) => {
	const w = PICK_W.slice(0, n);
	let r = Math.random() * w.reduce((a, b) => a + b, 0);
	for (let i = 0; i < n; i++) if ((r -= w[i]) <= 0) return i;
	return n - 1;
};

const [mode = 'kite', nPl = '4', heroesCsv = 'knight,witch,ranger,herald', runsS = '3', secS = '900'] = process.argv.slice(2);
const N = +nPl, RUNS = +runsS, SECS = +secS;
const heroes = heroesCsv.split(',');
const dt = 1 / TICK_HZ;

// Damage actually taken by players, per minute (wraps hurtPlayer so it also works on older code).
let dmgSink = null;
const origHurt = Room.prototype.hurtPlayer;
Room.prototype.hurtPlayer = function (h, dmg) {
	const before = h.hp;
	origHurt.call(this, h, dmg);
	if (dmgSink) dmgSink(this, Math.max(0, before - h.hp));
};
const NEAR = 300;

function runOnce(runIdx) {
	const M = Math.ceil(SECS / 60);
	const pm = { dmg: new Array(M).fill(0), aliveT: new Array(M).fill(0), lowT: new Array(M).fill(0), nearSum: new Array(M).fill(0), nearN: new Array(M).fill(0), lifeSum: new Array(M).fill(0), lifeN: new Array(M).fill(0), alive: new Array(M).fill(0) };
	const minute = (t) => Math.min(M - 1, Math.floor(t / 60));
	dmgSink = (room, d) => { pm.dmg[minute(room.time)] += d; };
	const engaged = new Map(); // enemy id -> time it first came within NEAR of a player
	const pending = [];
	let snapBytes = 0, snaps = 0, offersLate = 0, emptyLate = 0, evoOffers = 0;
	const start3 = {};
	const r = new Room('SIM', (pid, msg) => {
		if (msg.t === 'lvl' && msg.choices.length) {
			pending.push([pid, weightedPick(msg.choices.length)]);
			// Late offers (10:00+): how many had nothing but healing / embers to pick.
			if (r.time >= 600) {
				offersLate++;
				if (msg.choices.every((c) => c.kind === 'heal' || c.kind === 'ember')) emptyLate++;
				if (msg.choices.some((c) => c.kind === 'evo')) evoOffers++;
			}
		}
		if (msg.t === 's' && pid === 1) { snapBytes += JSON.stringify(msg).length; snaps++; }
	});
	for (let pid = 1; pid <= N; pid++) r.addPlayer(pid, 'B' + pid, heroes[(runIdx * N + pid - 1) % heroes.length]);
	r.start();
	const res = { downs: 0, firstDown: null, revives: 0, lvlMs: {}, elites: 0, items: 0, brk: 0 };
	const prevSt = {};
	const milestones = [60, 180, 300, 600, 900];
	let tickMs = 0;
	for (let i = 0; i < SECS * TICK_HZ && r.state === 'play'; i++) {
		for (const h of r.heroes.values()) {
			if (h.st !== 0) continue;
			if (mode === 'idle') { r.handle(h.pid, { t: 'pos', x: h.x, y: h.y, fx: 1, fy: 0 }); continue; }
			let vx = 0, vy = 0;
			for (const e of r.enemies) {
				const dx = h.x - e.x, dy = h.y - e.y; const d2 = dx * dx + dy * dy;
				if (d2 < 260 * 260 && d2 > 1) { const w = (e.r / 12) * 4000 / d2; vx += dx / Math.sqrt(d2) * w; vy += dy / Math.sqrt(d2) * w; }
			}
			let best = null, bd = 350 * 350;
			for (const g of r.gems) { const d2 = (g.x - h.x) ** 2 + (g.y - h.y) ** 2; if (d2 < bd) { bd = d2; best = g; } }
			for (const it of r.items ?? []) { const d2 = (it.x - h.x) ** 2 + (it.y - h.y) ** 2; if (d2 < bd) { bd = d2; best = it; } }
			if (best) { const d = Math.sqrt(bd) || 1; vx += (best.x - h.x) / d * 0.6; vy += (best.y - h.y) / d * 0.6; }
			for (const o of r.heroes.values()) {
				if (o === h) continue;
				const dx = o.x - h.x, dy = o.y - h.y, d = Math.hypot(dx, dy) || 1;
				if (o.st === 1) { vx += dx / d * 2.5; vy += dy / d * 2.5; }
				else if (d > 250) { vx += dx / d * 0.5; vy += dy / d * 0.5; }
			}
			const l = Math.hypot(vx, vy);
			if (l > 0.01) { vx /= l; vy /= l; }
			const sp = h.speed * h.mods.speedMul * dt;
			r.handle(h.pid, { t: 'pos', x: h.x + vx * sp, y: h.y + vy * sp, fx: vx || 1, fy: vy });
		}
		const t0 = performance.now();
		r.tick(dt);
		tickMs += performance.now() - t0;
		const mi = minute(r.time - 1e-9);
		for (const h of r.heroes.values()) {
			if (h.st !== 0) continue;
			pm.aliveT[mi] += dt;
			if (h.hp < h.maxHp * 0.5) pm.lowT[mi] += dt;
		}
		if (i % 15 === 0) {
			const alive = [...r.heroes.values()].filter((h) => h.st === 0);
			const ids = new Set();
			for (const e of r.enemies) {
				ids.add(e.id);
				let near = false;
				for (const h of alive) {
					const d2 = (e.x - h.x) ** 2 + (e.y - h.y) ** 2;
					if (d2 < NEAR * NEAR) { near = true; pm.nearSum[mi]++; }
				}
				if (near && !engaged.has(e.id)) engaged.set(e.id, r.time);
			}
			pm.nearN[mi] += alive.length;
			for (const [id, t] of engaged) {
				if (ids.has(id)) continue;
				engaged.delete(id);
				pm.lifeSum[mi] += r.time - t;
				pm.lifeN[mi]++;
			}
		}
		if (Math.abs(r.time % 60) < dt / 2 + 1e-9 || r.state !== 'play') pm.alive[mi] = [...r.heroes.values()].filter((h) => h.st === 0).length;
		for (const f of r.fx) {
			if (f[0] === 'elite') res.elites++;
			if (f[0] === 'item') res.items++;
			if (f[0] === 'brk') res.brk++;
		}
		while (pending.length) { const [pid, k] = pending.shift(); r.handle(pid, { t: 'pick', i: k }); }
		for (const h of r.heroes.values()) {
			if (prevSt[h.pid] === 0 && h.st === 1) { res.downs++; if (res.firstDown === null) res.firstDown = Math.round(r.time * 10) / 10; }
			if (prevSt[h.pid] === 1 && h.st === 0) res.revives++;
			prevSt[h.pid] = h.st;
		}
		if (r.time >= 180 && !start3.done) {
			start3.done = true;
			for (const h of r.heroes.values()) start3[h.pid] = [...h.weapons.keys()].sort().join('+');
		}
		for (const m of milestones) if (r.time >= m - 1e-6 && !(m in res.lvlMs)) {
			res.lvlMs[m] = +([...r.heroes.values()].reduce((s, h) => s + h.level, 0) / r.heroes.size).toFixed(1);
		}
	}
	res.end = Math.round(r.time);
	res.heroes = [...r.heroes.values()].map((h) => h.hero);
	res.pm = {
		dmgPerBotMin: pm.dmg.map((d, m) => +(pm.aliveT[m] > 0 ? d / (pm.aliveT[m] / 60) : 0).toFixed(1)),
		lowHpPct: pm.lowT.map((v, m) => +(pm.aliveT[m] > 0 ? (v / pm.aliveT[m]) * 100 : 0).toFixed(1)),
		nearAvg: pm.nearSum.map((v, m) => +(pm.nearN[m] > 0 ? v / pm.nearN[m] : 0).toFixed(1)),
		lifeAvg: pm.lifeSum.map((v, m) => +(pm.lifeN[m] > 0 ? v / pm.lifeN[m] : 0).toFixed(2)),
		aliveT: pm.aliveT.map((v) => Math.round(v)),
	};
	res.win = r.time >= SECS - 1;
	res.kills = r.kills;
	res.tickMs = +(tickMs / (r.time * TICK_HZ)).toFixed(3);
	res.snapAvg = Math.round(snapBytes / Math.max(1, snaps));
	res.dmgBy = {};
	for (const h of r.heroes.values()) for (const [k, v] of Object.entries(h.dmgBy ?? {})) res.dmgBy[k] = (res.dmgBy[k] ?? 0) + v;
	res.start3 = Object.entries(start3).filter(([k]) => k !== 'done').map(([, v]) => v);
	res.offersLate = offersLate;
	res.emptyLate = emptyLate;
	res.evoOffers = evoOffers;
	res.evos = [...r.heroes.values()].flatMap((h) => [...h.weapons.keys()].filter((id) => ['swarm', 'crescent', 'bladestorm', 'millstones', 'tocsin', 'tempest', 'moonblade', 'fireworks', 'blizzard', 'pitfall', 'bastion'].includes(id)));
	res.wsets = [...r.heroes.values()].map((h) => [...h.weapons.keys()].sort().join('+'));
	res.psets = [...r.heroes.values()].map((h) => [...h.passives.keys()].sort().join('+'));
	res.build = [...r.heroes.values()].map((h) => h.hero + ':' + [...h.weapons].map(([id, w]) => id + w.lvl).join('/') + '|' + [...h.passives].map(([id, l]) => id + l).join('/')).join(' ');
	return res;
}

const out = [];
for (let k = 0; k < RUNS; k++) out.push(runOnce(k));
console.log(JSON.stringify({ mode, N, heroes, runs: out }));
