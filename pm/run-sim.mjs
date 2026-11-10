// Bot runs that produce the same run logs players get.
// node pm/run-sim.mjs <players> <runs> [pick=rand|smart|human] [seconds=900] [heroes csv] > out.json
// human: picks by rarity, loves artifacts, reacts 0.25 s late to a smaller circle and misses a quarter of the shots (the lower bound;
// smart is the upper one). v18: both bots react to Wave 4 events (see the loop).
// v20: both bots take overclocks and banish cards (chooseBan).
// APP=<dir> selects a code variant (default ../app); MODE=lunch|night sets the run mode (seconds default to it); K0=<n> offsets the hero rotation (parallel chunks). Prints {N, pick, logs:[...]}.
const APP = process.env.APP ?? new URL('../app/', import.meta.url).pathname;
const { Room } = await import(APP + '/server/game.js');
const { TICK_HZ, MODES, EVOS, EVO_BY_WEAPON, FINALE } = await import(APP + '/public/shared/content.js');
const MODE = process.env.MODE ?? 'night';
// v21 finale knobs for calibration (the shared FINALE object is patched in this process only):
// FIN_HP="1.4,0.6,0.6,0.6" (this MODE's hpMul), FIN_DMG="1,1,1,1", FIN_RATE=0.4 (adds.rate), FIN_REVIVE=0.
// FLEE=1: the «беглец» manner — in the fight with the Lord the bot only runs from him and from the nearest enemy.
if (FINALE) {
	if (process.env.FIN_HP) FINALE.hpMul[MODE] = process.env.FIN_HP.split(',').map(Number);
	if (process.env.FIN_DMG) FINALE.dmgMul = process.env.FIN_DMG.split(',').map(Number);
	if (process.env.FIN_RATE) FINALE.adds.rate = +process.env.FIN_RATE;
	if (process.env.FIN_REVIVE === '0') FINALE.rageRevive = false;
}
const FLEE = !!process.env.FLEE;
// v23 group knobs: MODE_DMG / MODE_HP="1,0.85,0.8,1" (this MODE's dmgMul / hpMul by players), LATE_DMG / LATE_HP="0,0,0.07,0.1"
// (GROUP_LATE per minute) — patched in this process only.
{
	const C = await import(APP + '/public/shared/content.js');
	const arr = (v) => v.split(',').map(Number);
	if (process.env.MODE_DMG) C.MODES[MODE].dmgMul = arr(process.env.MODE_DMG);
	if (process.env.MODE_HP) C.MODES[MODE].hpMul = arr(process.env.MODE_HP);
	if (process.env.LATE_DMG) C.GROUP_LATE.dmgPerMin = arr(process.env.LATE_DMG);
	if (process.env.LATE_HP) C.GROUP_LATE.hpPerMin = arr(process.env.LATE_HP);
}

const [nS = '2', runsS = '4', pick = 'smart', secS = String(MODES?.[MODE]?.seconds ?? 900), heroesCsv = 'knight,witch,ranger,herald,smith,stormcaller,alchemist,spearmaiden'] = process.argv.slice(2);
const N = +nS, RUNS = +runsS, SECS = +secS;
const heroes = heroesCsv.split(',');
const dt = 1 / TICK_HZ;
const PICK_W = [0.5, 0.3, 0.2];

// Smart: evolution > duo > upgrade of a strong weapon > new weapon > passive > ember > heal (heal first when low).
// Human (as in the live logs): levels owned weapons, likes artifacts and shiny (rare) cards, often declines new weapons
// (a «recommended» one gets some respect), lots of noise.
function chooseHuman(h, choices) {
	const score = (c) => {
		if (c.kind === 'heal') return h.hp < h.maxHp * 0.35 ? 100 : 0;
		if (c.kind === 'evo' || c.kind === 'duo') return 45;
		if (c.kind === 'rare') return 40;
		// v20: an overclock is a shiny one-off card — taken about as readily as a level of an owned weapon.
		if (c.kind === 'ovr') return +(process.env.H_OVR ?? 36); // H_OVR: experiment knob
		if (c.kind === 'ember') return 5;
		const rar = (c.rar ?? 0) * 12;
		const owned = (c.from ?? c.level - 1) > 0;
		// Live logs: owned weapons get levels, artifacts come next, new weapons are often declined.
		if (c.kind === 'passive') return (owned ? 34 : 31) + rar;
		if (c.kind === 'weapon') return (owned ? 37 : 20 + (c.rec ? 12 : 0)) + rar;
		return 10;
	};
	let bi = 0, bs = -1;
	choices.forEach((c, i) => { const v = score(c) + Math.random() * 16; if (v > bs) { bs = v; bi = i; } });
	return bi;
}

function choose(h, choices) {
	if (pick === 'human') return chooseHuman(h, choices);
	if (pick !== 'smart') {
		let r = Math.random() * PICK_W.slice(0, choices.length).reduce((a, b) => a + b, 0);
		for (let i = 0; i < choices.length; i++) if ((r -= PICK_W[i]) <= 0) return i;
		return choices.length - 1;
	}
	const score = (c) => {
		if (c.kind === 'heal') return h.hp < h.maxHp * 0.4 ? 100 : 1;
		if (c.kind === 'evo') return 90;
		if (c.kind === 'duo') return 80;
		if (c.kind === 'rare') return 70;
		if (c.kind === 'ovr') return 45; // v20: after upgrades of owned weapons, before new artifacts
		// Card rarity (v13): a player grabs rarer cards, 5 points per step.
		const rar = (c.rar ?? 0) * 5;
		const owned = (c.from ?? c.level - 1) > 0;
		if (c.kind === 'weapon') return (owned ? 50 + c.level + (c.duoHint ? 3 : 0) : 40 + (c.duoHint ? 8 : 0)) + rar;
		if (c.kind === 'passive') return (owned ? 35 + c.level : 30) + rar;
		return 10;
	};
	let bi = 0;
	choices.forEach((c, i) => { if (score(c) + Math.random() * 4 > score(choices[bi]) + Math.random() * 4) bi = i; });
	return bi;
}

// v20 «Изгнать»: which card of the offer to banish, or -1. Both bots throw out the new artifacts that live logs call
// «empty slots» (#4DHEHF, #7PXEF3): «Подкова», «Клевер», «Уголёк» without a fire weapon. The human does it half of the
// time; the smart one always and also drops «Магнит» and «Песочные часы». (A first version let the human drop «Магнит»
// too: its solo night wins fell 32% → 22%, see pm/balance-v20.md.)
const BAN_HUMAN = new Set(['luck', 'clover', 'ember']);
const BAN_SMART = new Set(['luck', 'clover', 'ember', 'magnet', 'hourglass']);
function chooseBan(h, choices) {
	if (!(h.bans > 0) || pick === 'rand' || process.env.NOBAN) return -1; // NOBAN=1: bots never banish (to isolate its effect)
	const set = pick === 'human' ? BAN_HUMAN : BAN_SMART;
	const i = choices.findIndex((c) => c.kind === 'passive' && (c.level ?? 1) === 1 && set.has(c.id) && !h.passives.has(c.id)
		&& (c.id !== 'ember' || !h.fireW)
		// The card shows «⚡ эволюция: …»: nobody throws out the artifact their own weapon evolves with.
		&& ![...h.weapons.keys()].some((id) => EVOS[EVO_BY_WEAPON[id]]?.requires === c.id));
	if (i < 0 || (pick === 'human' && Math.random() < 0.5)) return -1;
	return i;
}

// TICKS=1: wall time of Room.tick over the last 40% of the run (ms), printed as {tick: {avg, p99, max}}.
const TICKS = process.env.TICKS ? [] : null;

function runOnce(k) {
	const pending = [];
	const r = new Room('SIM', (pid, msg) => {
		if (msg.t === 'lvl' && msg.choices.length) pending.push([pid, msg.choices]);
	});
	r.setMode?.(MODE);
	for (let pid = 1; pid <= N; pid++) r.addPlayer(pid, 'B' + pid, heroes[(k * N + pid - 1) % heroes.length]);
	r.start();
	const human = pick === 'human';
	// Human: reacts every REACT s to what it saw then, sees a smaller circle, half of the shots, gems pull harder.
	const REACT = human ? Math.round(+(process.env.H_REACT ?? 0.25) * TICK_HZ) : 1;
	const SEE = human ? +(process.env.H_SEE ?? 190) : 260, SHOT_SEE = human ? 90 : 120, GREED = human ? 1.2 : 0.6;
	const plan = new Map();
	for (let i = 0; i < SECS * TICK_HZ + 2 && r.state === 'play'; i++) {
		for (const h of r.heroes.values()) {
			if (h.st !== 0) continue;
			if (human && i % REACT !== h.pid % REACT && plan.has(h.pid)) {
				const [vx, vy] = plan.get(h.pid);
				const sp = h.speed * h.mods.speedMul * dt;
				r.handle(h.pid, { t: 'pos', x: h.x + vx * sp, y: h.y + vy * sp, fx: vx || 1, fy: vy });
				continue;
			}
			let vx = 0, vy = 0;
			if (FLEE && r.fin?.lord && !r.fin.lord.dead) {
				const f = r.fin, L = f.lord;
				const ld = Math.hypot(h.x - L.x, h.y - L.y) || 1;
				vx = (h.x - L.x) / ld * 3; vy = (h.y - L.y) / ld * 3;
				let ne = null, nd = 300 * 300;
				for (const e of r.enemies) { if (e === L || e.dead) continue; const d2 = (e.x - h.x) ** 2 + (e.y - h.y) ** 2; if (d2 < nd) { nd = d2; ne = e; } }
				if (ne) { const d = Math.sqrt(nd) || 1; vx += (h.x - ne.x) / d * 2; vy += (h.y - ne.y) / d * 2; }
				// At the wall a runner slides along it instead of pushing into it.
				const cx = h.x - f.cx, cy = h.y - f.cy, cd = Math.hypot(cx, cy) || 1;
				if (cd > f.r - 70) {
					const out = (vx * cx + vy * cy) / cd;
					if (out > 0) { vx -= cx / cd * out; vy -= cy / cd * out; }
					const side = (-cy * (h.x - L.x) + cx * (h.y - L.y)) >= 0 ? 1 : -1;
					vx += -cy / cd * 2.5 * side; vy += cx / cd * 2.5 * side;
				}
				const l = Math.hypot(vx, vy) || 1;
				vx /= l; vy /= l;
				plan.set(h.pid, [vx, vy]);
				const sp = h.speed * h.mods.speedMul * dt;
				r.handle(h.pid, { t: 'pos', x: h.x + vx * sp, y: h.y + vy * sp, fx: vx || 1, fy: vy });
				continue;
			}
			for (const e of r.enemies) {
				const dx = h.x - e.x, dy = h.y - e.y; const d2 = dx * dx + dy * dy;
				if (d2 < SEE * SEE && d2 > 1) { const w = (e.r / 12) * 4000 / d2; vx += dx / Math.sqrt(d2) * w; vy += dy / Math.sqrt(d2) * w; }
			}
			for (const s of r.hostile) {
				if (human && (s.id ?? 0) % 4 === 0) continue;
				const dx = h.x - s.x, dy = h.y - s.y; const d2 = dx * dx + dy * dy;
				if (d2 < SHOT_SEE * SHOT_SEE && d2 > 1) { const w = 3000 / d2; vx += dx / Math.sqrt(d2) * w; vy += dy / Math.sqrt(d2) * w; }
			}
			let best = null, bd = 350 * 350;
			for (const g of r.gems) { const d2 = (g.x - h.x) ** 2 + (g.y - h.y) ** 2; if (d2 < bd) { bd = d2; best = g; } }
			for (const it of r.items ?? []) { const d2 = (it.x - h.x) ** 2 + (it.y - h.y) ** 2; if (d2 < bd) { bd = d2; best = it; } }
			if (best) { const d = Math.sqrt(bd) || 1; vx += (best.x - h.x) / d * GREED; vy += (best.y - h.y) / d * GREED; }
			// v18 events: step out of the star circle, go for the cursed chest, the star shard, the golden shade and
			// (smart: with hp to spare; human: every other altar) the altar.
			const ev = r.events?.active;
			if (ev) {
				const dx = ev.x - h.x, dy = ev.y - h.y, d = Math.hypot(dx, dy) || 1;
				if (ev.id === 'star' && ev.phase === 0) {
					if (d < ev.r + 30) { vx -= dx / d * 4; vy -= dy / d * 4; }
				} else {
					const altar = ev.id === 'altar' && !ev.took.has(h.pid) && (human ? Math.floor(ev.at) % 2 === 0 : h.hp > h.maxHp * 0.6);
					const go = altar || (ev.id === 'cursed' && ev.phase === 0) || (ev.id === 'star' && ev.phase === 1) || ev.id === 'gold';
					if (go && d < 900) { vx += dx / d * GREED * 1.5; vy += dy / d * GREED * 1.5; }
				}
			}
			for (const o of r.heroes.values()) {
				if (o === h) continue;
				const dx = o.x - h.x, dy = o.y - h.y, d = Math.hypot(dx, dy) || 1;
				if (o.st === 1) { vx += dx / d * 2.5; vy += dy / d * 2.5; }
				else if (d > 250) { vx += dx / d * 0.5; vy += dy / d * 0.5; }
			}
			// v21: the arena wall. A player sees it: next to it the bot does not push outwards, and if that leaves it
			// standing (pinned by what it runs from), it slides along the wall away from the nearest threat.
			if (r.fin) {
				const f = r.fin, cx = h.x - f.cx, cy = h.y - f.cy, cd = Math.hypot(cx, cy) || 1;
				if (cd > f.r - 60) {
					const l0 = Math.hypot(vx, vy);
					const out = (vx * cx + vy * cy) / cd;
					if (out > 0) { vx -= cx / cd * out; vy -= cy / cd * out; }
					if (l0 > 0.01 && Math.hypot(vx, vy) < l0 * 0.5) {
						let th = null, td = Infinity;
						for (const e of r.enemies) { if (e.dead) continue; const d2 = (e.x - h.x) ** 2 + (e.y - h.y) ** 2 - (e.boss ? 1e4 : 0); if (d2 < td) { td = d2; th = e; } }
						const side = th ? ((-cy * (h.x - th.x) + cx * (h.y - th.y)) >= 0 ? 1 : -1) : 1;
						vx += -cy / cd * l0 * side; vy += cx / cd * l0 * side;
					}
				}
			}
			const l = Math.hypot(vx, vy);
			if (l > 0.01) { vx /= l; vy /= l; }
			plan.set(h.pid, [vx, vy]);
			const sp = h.speed * h.mods.speedMul * dt;
			r.handle(h.pid, { t: 'pos', x: h.x + vx * sp, y: h.y + vy * sp, fx: vx || 1, fy: vy });
		}
		if (TICKS) {
			const t0 = performance.now();
			r.tick(dt);
			if (r.time > SECS * 0.6) TICKS.push(performance.now() - t0);
		} else r.tick(dt);
		while (pending.length) {
			const [pid, choices] = pending.shift();
			const h = r.heroes.get(pid);
			if (!h?.offer) continue;
			for (let b = chooseBan(h, h.offer); b >= 0 && h.offer; b = chooseBan(h, h.offer)) r.handle(pid, { t: 'ban', i: b });
			if (h.offer) r.handle(pid, { t: 'pick', i: choose(h, h.offer) });
		}
	}
	return r.lastLog ?? r.runLog.build(r, false);
}

const logs = [];
const K0 = +(process.env.K0 ?? 0);
for (let k = K0; k < K0 + RUNS; k++) logs.push(runOnce(k));
const tick = TICKS?.length ? (() => {
	const v = TICKS.slice().sort((a, b) => a - b);
	return { avg: v.reduce((a, b) => a + b, 0) / v.length, p99: v[Math.floor(v.length * 0.99)], max: v.at(-1) };
})() : undefined;
console.log(JSON.stringify({ N, pick, logs, tick }));
