// Fit a duo level under a crowd ceiling while holding the boss ratio: aoe keys scale by a, single-target keys by z.
// NO_MAIN=1 node pm/duo-cap.mjs <id> <lvl> <crowd target> <boss min> <aoe keys csv> [single keys csv]
const [id, lvS, tcS, tbS, aoeS, stS = ''] = process.argv.slice(2);
process.argv.splice(2);
const { avg, DUOS } = await import('./duo-bench.mjs');
const lv = +lvS, pl = lv + 2, D = DUOS[id], tc = +tcS, tb = +tbS;
const aoe = aoeS.split(','), st = stS ? stS.split(',') : [];
const base = { ...D.levels[lv - 1] };
const parts = { crowd: avg([[D.parts[0], pl], [D.parts[1], pl]], 'crowd'), boss: avg([[D.parts[0], pl], [D.parts[1], pl]], 'boss') };
const set = (a, z) => {
	const L = { ...base };
	for (const k of aoe) L[k] = Math.round(base[k] * a * 10) / 10;
	for (const k of st) L[k] = Math.round(base[k] * z * 10) / 10;
	D.levels[lv - 1] = L;
	return L;
};
const score = (a, z) => { set(a, z); return { c: avg([[id, lv]], 'crowd') / parts.crowd, b: avg([[id, lv]], 'boss') / parts.boss }; };
let best = null;
for (let a = 1; a >= 0.2; a -= 0.05) {
	let z = 1, s = score(a, z);
	if (st.length) while (s.b < tb && z < 6) { z += 0.1; s = score(a, z); }
	if (s.c <= tc && (s.b >= tb || !st.length)) { best = { a, z, ...s, L: set(a, z) }; break; }
}
if (!best) { console.log('no fit'); process.exit(1); }
const pick = Object.fromEntries([...aoe, ...st].map((k) => [k, best.L[k]]));
console.log(`${id} ${lv}: a=${best.a.toFixed(2)} z=${best.z.toFixed(1)} crowd ×${best.c.toFixed(2)} boss ×${best.b.toFixed(2)} ${JSON.stringify(pick)}`);
