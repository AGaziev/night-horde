// node pm/ovr-ratio.mjs <kite.txt> <stand.txt>: combined ratio variant / plain over both ovr-bench scenarios.
import fs from 'node:fs';
const read = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/));
const [a, b] = process.argv.slice(2).map(read);
let base = 0;
console.log('weapon     variant       kite  stand  combined');
a.forEach((r, i) => {
	const s = b[i];
	const sum = +r[2] + +s[2];
	if (r[1] === 'plain') base = sum;
	console.log(r[0].padEnd(10), r[1].padEnd(12), r[3].padStart(5), s[3].padStart(6), (sum / base).toFixed(2).padStart(8));
});
