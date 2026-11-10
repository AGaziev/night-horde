// Finds the smallest damage multiplier per duo level that meets the duo targets on the bench (see duo-bench.mjs).
// NO_MAIN=1 node pm/duo-tune.mjs [ids csv]  → JSON {id: [m1, m2, m3]} and the bench numbers after the multiplier.
const { avg, DUOS } = await import('./duo-bench.mjs');
const DMG_KEYS = ['dmg', 'boom', 'zap', 'poolDmg', 'trapDmg', 'wireDmg', 'spikeDmg', 'fanDmg', 'strikeDmg', 'knifeDmg', 'burstDmg', 'patchDmg', 'burn'];
// [duo level, part level, crowd ≥, boss ≥]
const TARGET = [[1, 3, 1.1, 0.9], [2, 4, 1.15, 0.95], [3, 5, 1.25, 1.0]];
const ids = process.argv[2] ? process.argv[2].split(',') : Object.keys(DUOS);
const out = {};
for (const id of ids) {
	const D = DUOS[id];
	const base = D.levels.map((L) => ({ ...L }));
	out[id] = [];
	for (const [lv, pl, tc, tb] of TARGET) {
		const parts = { crowd: avg([[D.parts[0], pl], [D.parts[1], pl]], 'crowd'), boss: avg([[D.parts[0], pl], [D.parts[1], pl]], 'boss') };
		const score = (m) => {
			for (const k of DMG_KEYS) if (base[lv - 1][k] !== undefined) D.levels[lv - 1][k] = base[lv - 1][k] * m;
			const c = avg([[id, lv]], 'crowd') / parts.crowd, b = avg([[id, lv]], 'boss') / parts.boss;
			return { c, b, ok: c >= tc && b >= tb };
		};
		let s = score(1), m = 1;
		if (!s.ok) {
			let lo = 1, hi = 1.5;
			while (!score(hi).ok && hi < 6) hi *= 1.5;
			for (let i = 0; i < 7; i++) {
				const mid = (lo + hi) / 2;
				if (score(mid).ok) hi = mid; else lo = mid;
			}
			m = Math.ceil(hi * 20) / 20;
			s = score(m);
		}
		D.levels[lv - 1] = { ...base[lv - 1] };
		out[id].push({ m, crowd: Math.round(s.c * 100) / 100, boss: Math.round(s.b * 100) / 100 });
		process.stderr.write(`${id}${lv}:${m} `);
	}
}
process.stderr.write('\n');
console.log(JSON.stringify(out));
