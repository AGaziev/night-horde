// Storage probe (v22 prerequisites). Reads VIBE_KEY from ../../.env, never prints it.
// node pm/storage-probe/probe.mjs
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const KEY = env.VIBE_KEY;
const BASE = 'https://vibecode.bitrix24.tech/v1';
const H = { 'X-Api-Key': KEY };
const key = 'probe/v22-test.json';
const ms = (t) => Math.round(performance.now() - t);
const enc = encodeURIComponent;

async function up(body, k = key) {
	const form = new FormData();
	form.append('key', k);
	form.append('visibility', 'PRIVATE');
	form.append('file', new Blob([body], { type: 'application/json' }), 'x.json');
	const t = performance.now();
	const r = await fetch(`${BASE}/storage/objects/upload`, { method: 'POST', headers: H, body: form });
	const txt = await r.text();
	return { status: r.status, ms: ms(t), body: txt.slice(0, 300) };
}
async function get(k = key) {
	const t = performance.now();
	const r = await fetch(`${BASE}/storage/objects/${enc(k)}`, { headers: H, redirect: 'manual' });
	const loc = r.headers.get('location');
	const t1 = ms(t);
	if (!loc) return { status: r.status, ms: t1, body: (await r.text()).slice(0, 300) };
	const r2 = await fetch(loc);
	const body = await r2.text();
	return { status: r.status, s3: r2.status, msRedirect: t1, msTotal: ms(t), body: body.slice(0, 200), host: new URL(loc).host };
}
async function del(k = key) {
	const t = performance.now();
	const r = await fetch(`${BASE}/storage/objects/${enc(k)}`, { method: 'DELETE', headers: H });
	return { status: r.status, ms: ms(t), body: (await r.text()).slice(0, 300) };
}
async function list(prefix) {
	const r = await fetch(`${BASE}/storage/objects?prefix=${enc(prefix)}&withTotal=true`, { headers: H });
	return { status: r.status, body: await r.text() };
}

const step = process.argv[2] || 'all';
const out = {};
if (step === 'all') {
	out.missing = await get('probe/does-not-exist.json');
	out.write1 = await up(JSON.stringify({ v: 1, a: 1 }));
	out.read1 = await get();
	out.replace = await up(JSON.stringify({ v: 1, a: 2 }));
	out.read2 = await get();
	// latency series
	const w = [], rd = [];
	for (let i = 0; i < 5; i++) { w.push((await up(JSON.stringify({ v: 1, i }))).ms); rd.push((await get()).msTotal); }
	out.latency = { writes: w, reads: rd };
	// concurrent writes to the same key
	const conc = await Promise.all([1, 2, 3, 4, 5].map((i) => up(JSON.stringify({ v: 1, c: i }))));
	out.concurrent = conc.map((c) => ({ status: c.status, ms: c.ms, body: c.status !== 200 && c.status !== 201 ? c.body : undefined }));
	out.afterConcurrent = await get();
	out.list = await list('probe/');
	out.del = await del();
	out.readDeleted = await get();
	out.reupload = await up(JSON.stringify({ v: 1, revived: true }));
	out.readRevived = await get();
	out.del2 = await del();
	out.listAfter = await list('probe/');
}
console.log(JSON.stringify(out, null, 1));
if (step === 'list' || step === 'clean') {
	const prefix = process.argv[3];
	if (!prefix || !prefix.startsWith('selftest-')) throw new Error('only selftest-* prefixes');
	const l = JSON.parse((await list(prefix)).body);
	for (const o of l.data) {
		const g = await get(o.key);
		console.log(o.key, g.body);
		if (step === 'clean') console.log('  delete', (await del(o.key)).status);
	}
	if (step === 'clean') console.log('after:', (await list(prefix)).body);
}
