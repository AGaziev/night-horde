// node pm/deaths.mjs <run-sim json>: what killed players (last 10 s by source), crowd at the down, peak, declined weapons.
import fs from 'node:fs';
const { logs } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const by = {}, crowd = [], peaks = {};
let declined = 0, lonely = 0, players = 0, oneW = 0;
for (const l of logs) for (const p of l.team) {
	players++;
	declined += p.declinedNewWeapon ?? 0;
	lonely += p.declinedNewWeaponLonely ?? 0;
	for (const d of p.deaths ?? []) {
		crowd.push(d.crowd);
		peaks[d.peak ?? '-'] = (peaks[d.peak ?? '-'] ?? 0) + 1;
		if (d.weapons.length < 2) oneW++;
		const tot = Object.values(d.last10).reduce((a, b) => a + b, 0) || 1;
		for (const [k, v] of Object.entries(d.last10)) by[k.split(':')[0] + (k.includes(':') ? ':' + k.split(':')[1] : '')] = (by[k] ?? 0) + v / tot;
	}
}
const med = (v) => (v.length ? v.sort((a, b) => a - b)[v.length >> 1] : '—');
console.log(`downs ${crowd.length}; crowd@300 median ${med(crowd)}; one weapon at down ${oneW}; peaks ${JSON.stringify(peaks)}`);
console.log('last-10s share: ' + Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / Math.max(1, crowd.length) * 100).toFixed(0)}%`).join(', '));
console.log(`declined new weapon: ${(declined / players).toFixed(1)} per player (${(lonely / players).toFixed(1)} with one weapon)`);
