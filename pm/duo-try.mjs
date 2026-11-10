// Bench one duo level with overridden fields: NO_MAIN=1 node pm/duo-try.mjs <id> <lvl> '<json overrides>' → crowd/boss ratio vs parts.
const [id, lvS, js = '{}'] = process.argv.slice(2);
process.argv.splice(2);
const { avg, DUOS } = await import('./duo-bench.mjs');
const lv = +lvS, pl = lv + 2, D = DUOS[id];
Object.assign(D.levels[lv - 1], JSON.parse(js));
const parts = (l) => avg([[D.parts[0], pl], [D.parts[1], pl]], l);
const c = avg([[id, lv]], 'crowd') / parts('crowd'), b = avg([[id, lv]], 'boss') / parts('boss');
console.log(`${id} ${lv} ${js} crowd ×${c.toFixed(2)} boss ×${b.toFixed(2)}`);
