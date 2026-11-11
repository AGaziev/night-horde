// Fit a duo level to a crowd ratio by scaling its damage keys up or down (duo-cap only scales area damage down).
// node pm/duo-fit.mjs <id> <keys csv> <crowd target> [levels csv=1,2,3] [seconds=20]   HIT=2 for shield duos.
// Prints the factor per level, the crowd and boss ratios and the rounded numbers to put into content.js.
process.env.NO_MAIN = '1';
const [id, keysS, tS, lvS = '1,2,3', secS = '20'] = process.argv.slice(2);
process.argv.splice(2, 99, secS);
const { avg, DUOS } = await import('./duo-bench.mjs');
const D = DUOS[id], keys = keysS.split(','), target = +tS;
for (const lv of lvS.split(',').map(Number)) {
	const pl = lv + 2, base = { ...D.levels[lv - 1] };
	const parts = { crowd: avg([[D.parts[0], pl], [D.parts[1], pl]], 'crowd'), boss: avg([[D.parts[0], pl], [D.parts[1], pl]], 'boss') };
	const set = (k) => {
		const L = { ...base };
		for (const key of keys) L[key] = Math.round(base[key] * k * 10) / 10;
		D.levels[lv - 1] = L;
		return L;
	};
	const crowd = (k) => { set(k); return avg([[id, lv]], 'crowd') / parts.crowd; };
	let lo = 0.2, hi = 5;
	for (let i = 0; i < 9; i++) {
		const mid = Math.sqrt(lo * hi);
		if (crowd(mid) < target) lo = mid; else hi = mid;
	}
	const k = Math.sqrt(lo * hi), L = set(k);
	const c = avg([[id, lv]], 'crowd') / parts.crowd, b = avg([[id, lv]], 'boss') / parts.boss;
	console.log(`${id} ${lv}: k=${k.toFixed(2)} crowd ×${c.toFixed(2)} boss ×${b.toFixed(2)} ${JSON.stringify(Object.fromEntries(keys.map((x) => [x, L[x]])))}`);
}
