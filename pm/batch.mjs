// Parallel run-sim: node pm/batch.mjs <players> <runs> <pick> <out.json> [chunks=8]; env APP / MODE pass through.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [n, runs, pick, out, chunksS = '8'] = process.argv.slice(2);
const chunks = Math.min(+chunksS, +runs), per = Math.ceil(+runs / chunks);
const sim = new URL('./run-sim.mjs', import.meta.url).pathname;
const parts = await Promise.all(Array.from({ length: chunks }, (_, c) => new Promise((ok, fail) => {
	const k = Math.min(per, +runs - c * per);
	if (k <= 0) return ok(null);
	const p = spawn(process.execPath, [sim, n, String(k), pick], { env: { ...process.env, K0: String(c * per) } });
	let buf = '';
	p.stdout.on('data', (d) => { buf += d; });
	p.stderr.pipe(process.stderr);
	p.on('close', (code) => (code ? fail(new Error(`chunk ${c} exit ${code}`)) : ok(JSON.parse(buf))));
})));
const ok = parts.filter(Boolean);
fs.writeFileSync(out, JSON.stringify({ N: +n, pick, logs: ok.flatMap((p) => p.logs) }));
