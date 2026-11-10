// Feeds recorded snapshot arrivals into the real client Game and measures per-frame enemy jumps at 60 fps.
import fs from 'node:fs';
const [file, who, gameFile] = [process.argv[2], process.argv[3] || 'second', process.argv[4] || '../app/public/js/game.js'];
const { Game } = await import(new URL(gameFile, import.meta.url).href);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
let rec = data[who].rec;
const mode = process.env.MODE || 'rec';
if (mode !== 'rec') {
	// Re-time arrivals from server time: 'ideal' = fixed 40 ms, 'jitter' = proxy-like model (no server slips).
	let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
	const expo = (m) => -Math.log(1 - rnd()) * m;
	let last = 0;
	rec = rec.map((r) => {
		let d = 0.04;
		if (mode === 'jitter') { d += expo(0.025); if (rnd() < 0.03) d += 0.15 + rnd() * 0.25; }
		const arr = Math.max(last, r.tm + d); last = arr;
		return { ...r, arr };
	});
}
const me = data[who].pid;
let NOW = 0;
globalThis.performance = { now: () => NOW * 1000 };
const g = new Game({ send() {} });
g.me = me;
g.running = false; // keep own-hero prediction out of it
const FPS = 60, dtf = 1 / FPS;
const t0 = rec[0].arr, t1 = rec.at(-1).arr;
let k = 0;
const prev = new Map();
const jumps = [];
let frames = 0, starved = 0, behind = [], speeds = [];
const tmp = { x: 0, y: 0 };
for (NOW = t0; NOW <= t1; NOW += dtf) {
	while (k < rec.length && rec[k].arr <= NOW) g.onSnapshot({ t: 's', tm: rec[k].tm, p: rec[k].p, e: rec[k].e, fx: [] }), k++;
	g.updateView(NOW);
	const v = g.view;
	if (!v.b) continue;
	frames++;
	const latest = g.snaps.at(-1).tm;
	if (v.tm >= latest) starved++;
	behind.push(latest - v.tm);
	// own position from the newest snapshot (screen centre)
	const row = g.snaps.at(-1).pMap.get(me);
	const cx = row ? row[1] : 0, cy = row ? row[2] : 0;
	const seen = new Set();
	const e = v.b.e;
	for (let i = 0; i + 5 <= e.length; i += 5) {
		const id = e[i];
		if (!g.enemyPos(id, tmp)) continue;
		seen.add(id);
		const p = prev.get(id);
		const onScreen = Math.abs(tmp.x - cx) < 960 && Math.abs(tmp.y - cy) < 540;
		if (p && onScreen && p.f === frames - 1) {
			const d = Math.hypot(tmp.x - p.x, tmp.y - p.y);
			jumps.push(d);
			if (d > 8 && process.env.DEBUG) {
				const j = v.a.eIdx.get(id), bi = v.b.eIdx.get(id);
				console.log(`jump ${d.toFixed(1)} id=${id} type=${e[i + 1]} et=${v.et?.toFixed(2)} span=${(v.b.tm - v.a.tm).toFixed(2)} ext=${v.tm >= latest} inA=${j !== undefined} ab=${j !== undefined ? Math.hypot(v.b.e[bi + 2] - v.a.e[j + 2], v.b.e[bi + 3] - v.a.e[j + 3]).toFixed(0) : '-'} pairChanged=${p.b !== v.b.tm}`);
			}
		}
		prev.set(id, { x: tmp.x, y: tmp.y, f: frames, b: v.b.tm });
	}
}
jumps.sort((a, b) => a - b);
const pct = (q) => jumps[Math.min(jumps.length - 1, Math.floor(q * jumps.length))];
const arrGap = []; for (let i = 1; i < rec.length; i++) arrGap.push(rec[i].arr - rec[i - 1].arr);
arrGap.sort((a, b) => a - b);
const offs = rec.map((r) => r.arr - r.tm); const mn = Math.min(...offs);
const exc = offs.map((o) => o - mn).sort((a, b) => a - b);
const f = (x) => (x * 1000).toFixed(0);
console.log(`${file} ${who}: snaps=${rec.length} frames=${frames} samples=${jumps.length}`);
console.log(`  arrival excess over min (ms): p50=${f(exc[exc.length >> 1])} p90=${f(exc[Math.floor(exc.length * 0.9)])} p99=${f(exc[Math.floor(exc.length * 0.99)])} max=${f(exc.at(-1))}; gaps p99=${f(arrGap[Math.floor(arrGap.length * 0.99)])} max=${f(arrGap.at(-1))}`);
console.log(`  jump px: p50=${pct(0.5).toFixed(2)} p99=${pct(0.99).toFixed(2)} p99.9=${pct(0.999).toFixed(2)} max=${jumps.at(-1).toFixed(1)}; >8px: ${(100 * jumps.filter((x) => x > 8).length / jumps.length).toFixed(2)}%`);
console.log(`  starved frames (render time past newest snapshot): ${(100 * starved / frames).toFixed(1)}%; mean lag behind newest ${f(behind.reduce((a, b) => a + b, 0) / behind.length)} ms`);
