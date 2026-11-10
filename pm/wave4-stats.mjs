// v18: events by outcome and specials per run. node pm/wave4-stats.mjs <batch.json...>
import fs from 'node:fs';
const RES = { star: ['не забран', 'забран'], gold: ['сбежала', 'поймана'], fog: ['прошёл'], altar: ['отказ', 'сделка'], cursed: ['не открыт', 'пережит', 'не пережит'], streak: ['сорвалась', 'выполнена'] };
console.log('| Файл | событий за забег | исходы | трубач: залпов / урон по игрокам за забег | щитоносец: урон / поглощено щитом за забег |');
console.log('|---|---|---|---|---|');
for (const f of process.argv.slice(2)) {
	const { logs } = JSON.parse(fs.readFileSync(f, 'utf8'));
	const c = {};
	let n = 0, sv = 0, sd = 0, hd = 0, hb = 0;
	for (const L of logs) {
		for (const e of L.events) { n++; c[e.id] ??= {}; c[e.id][e.res] = (c[e.id][e.res] ?? 0) + 1; }
		sv += L.specials.sniper.shots; sd += L.specials.sniper.dmgToPlayers; hd += L.specials.shield.dmgToPlayers; hb += L.specials.shield.blocked;
	}
	const out = Object.entries(c).map(([id, r]) => `${id}: ${Object.entries(r).map(([k, v]) => `${RES[id]?.[k] ?? k} ${v}`).join(', ')}`).join('; ');
	const k = logs.length;
	console.log(`| ${f.split('/').pop()} | ${(n / k).toFixed(1)} | ${out} | ${Math.round(sv / k)} / ${Math.round(sd / k)} | ${Math.round(hd / k)} / ${Math.round(hb / k)} |`);
}
