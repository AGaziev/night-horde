// Headless balance probe: node pm/balance-sim.js <mode> <players> <heroes,csv> <runs> [seconds]
// mode: idle | kite
import { Room } from '../app/server/game.js';
import { TICK_HZ, xpForNext, WEAPONS, MAX_GEMS } from '../app/public/shared/content.js';
if (process.env.GEMFIX) {
	// Prototype: at the cap, fold the gem farthest from all heroes into the new drop instead of feeding a distant gem.
	Room.prototype.dropGem = function (x, y, xp) {
		if (this.gems.length >= MAX_GEMS) {
			let wi = 0, wd = -1;
			const hs = [...this.heroes.values()];
			this.gems.forEach((g, i) => { const d = Math.min(...hs.map((h) => (h.x - g.x) ** 2 + (h.y - g.y) ** 2)); if (d > wd) { wd = d; wi = i; } });
			xp += this.gems[wi].xp;
			this.gems.splice(wi, 1);
		}
		this.gems.push({ id: this.nextId++, x, y, xp });
	};
}
if (process.env.KNIGHTBOTH) WEAPONS.whip.levels[0].both = true;

const [mode = 'kite', nPl = '1', heroesCsv = 'knight', runsS = '3', secS = '900'] = process.argv.slice(2);
const N = +nPl, RUNS = +runsS, SECS = +secS;
const heroes = heroesCsv.split(',');
const dt = 1 / TICK_HZ;

function runOnce() {
	const lvlAt = {}; // pid -> [time of each level]
	const pending = [];
	const r = new Room('SIM', (pid, msg) => {
		if (msg.t === 'lvl') {
			const i = Math.floor(Math.random() * msg.choices.length);
			pending.push([pid, i]);
		}
	});
	for (let pid = 1; pid <= N; pid++) r.addPlayer(pid, 'B' + pid, heroes[(pid - 1) % heroes.length]);
	r.start();
	const res = { downs: 0, firstDown: null, end: null, win: false, lvl: {}, revives: 0, bossKill: [] };
	const prevSt = {};
	const milestones = [60, 180, 300, 600, 900];
	const lvlMs = {};
	let downTime = {};
	for (let i = 0; i < SECS * TICK_HZ && r.state === 'play'; i++) {
		for (const h of r.heroes.values()) {
			if (h.st !== 0) continue;
			if (mode === 'idle') { r.handle(h.pid, { t: 'pos', x: h.x, y: h.y, fx: 1, fy: 0 }); continue; }
			// kite: flee nearby enemies, drift to gems, stay near allies, help downed allies
			let vx = 0, vy = 0;
			for (const e of r.enemies) {
				const dx = h.x - e.x, dy = h.y - e.y; const d2 = dx * dx + dy * dy;
				if (d2 < 260 * 260 && d2 > 1) { const w = (e.r / 12) * 4000 / d2; vx += dx / Math.sqrt(d2) * w; vy += dy / Math.sqrt(d2) * w; }
			}
			let best = null, bd = 350 * 350;
			for (const g of r.gems) { const d2 = (g.x - h.x) ** 2 + (g.y - h.y) ** 2; if (d2 < bd) { bd = d2; best = g; } }
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
		r.tick(dt);
		while (pending.length) { const [pid, i] = pending.shift(); r.handle(pid, { t: 'pick', i }); }
		for (const h of r.heroes.values()) {
			if (prevSt[h.pid] === 0 && h.st === 1) { res.downs++; if (res.firstDown === null) res.firstDown = r.time; }
			if (prevSt[h.pid] === 1 && h.st === 0) res.revives++;
			prevSt[h.pid] = h.st;
			(lvlAt[h.pid] ??= []);
			if (lvlAt[h.pid].length < h.level - 1) lvlAt[h.pid].push(r.time);
		}
		for (const m of milestones) if (Math.abs(r.time - m) < dt / 2 + 1e-9 || (r.time >= m && !(m in lvlMs))) {
			if (!(m in lvlMs)) lvlMs[m] = Math.round([...r.heroes.values()].reduce((s, h) => s + h.level, 0) / r.heroes.size);
		}
	}
	res.end = Math.round(r.time); res.gems = r.gems.length; res.groundXp = Math.round(r.gems.reduce((s, g) => s + g.xp, 0)); res.near = Math.round(Math.min(...r.gems.map(g => Math.min(...[...r.heroes.values()].map(h => Math.hypot(g.x - h.x, g.y - h.y))))));
	res.win = r.time >= 899;
	res.lvlMs = lvlMs;
	res.firstLvl = Math.min(...Object.values(lvlAt).map((a) => a[0] ?? 999));
	res.kills = r.kills;
	res.weapons = [...r.heroes.values()].map((h) => h.hero + ':' + [...h.weapons].map(([id, w]) => id + w.lvl).join('/')).join(' ');
	return res;
}

const out = [];
for (let k = 0; k < RUNS; k++) out.push(runOnce());
console.log(JSON.stringify({ mode, N, heroes, runs: out }));
