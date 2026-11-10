import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(process.argv[2] + '/');
const WebSocket = require('ws');
const tok = JSON.parse(fs.readFileSync('token.json')).data.token;
const base = 'https://app-0fdbcfb656d3.vibecode.bitrix24.tech';
const H = { Authorization: 'Bearer ' + tok };
const r = await fetch(base + '/health', { headers: H }); console.log('health', r.status, (await r.text()).slice(0, 40));
const r2 = await fetch(base + '/', { headers: H }); const html = await r2.text(); console.log('root', r2.status, html.includes('/_gw/icon'), html.length);
const sess = await (await fetch(base + '/api/session', { headers: H })).json(); console.log('session', sess.name);
// WebSocket
const wsRes = await new Promise((res) => {
	const t0 = Date.now(); const got = [];
	const ws = new WebSocket(base.replace('https', 'wss') + '/ws?sid=' + sess.sid, { headers: H });
	const done = (v) => { try { ws.close(); } catch {} res(v); };
	const to = setTimeout(() => done({ ok: false, why: 'timeout', got }), 8000);
	ws.on('open', () => { got.push('open ' + (Date.now() - t0) + 'ms'); ws.send(JSON.stringify({ t: 'create', hero: 'witch' })); ws.send(JSON.stringify({ t: 'ping', c: Date.now() })); });
	ws.on('message', (m) => { const msg = JSON.parse(m); got.push(msg.t); if (msg.t === 'pong') { got.push('rtt ' + (Date.now() - msg.c) + 'ms'); clearTimeout(to); ws.send(JSON.stringify({ t: 'leave' })); setTimeout(() => done({ ok: true, got }), 300); } });
	ws.on('unexpected-response', (_q, resp) => { clearTimeout(to); done({ ok: false, why: 'http ' + resp.statusCode, got }); });
	ws.on('error', (e) => { clearTimeout(to); done({ ok: false, why: e.message, got }); });
});
console.log('WS', JSON.stringify(wsRes));
// SSE + POST
const s2 = await (await fetch(base + '/api/session', { headers: H })).json();
const ctl = new AbortController(); const t0 = Date.now(); const seen = [];
const ev = await fetch(base + '/api/events?sid=' + s2.sid, { headers: H, signal: ctl.signal });
console.log('sse status', ev.status, ev.headers.get('content-type'));
const reader = ev.body.getReader(); const dec = new TextDecoder(); let buf = '';
setTimeout(async () => { const p = await fetch(base + '/api/send?sid=' + s2.sid, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify([{ t: 'create', hero: 'knight' }, { t: 'start' }, { t: 'ping', c: Date.now() }]) }); seen.push('post ' + p.status); }, 500);
const stop = setTimeout(() => ctl.abort(), 6000);
let snaps = 0;
try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const line = chunk.split('\n').find((l) => l.startsWith('data: ')); if (!line) continue; const m = JSON.parse(line.slice(6)); if (m.t === 's') snaps++; else seen.push(m.t + '@' + (Date.now() - t0)); if (m.t === 'pong') seen.push('rtt ' + (Date.now() - m.c) + 'ms'); } } } catch {}
clearTimeout(stop);
console.log('SSE', seen.join(', '), '| snapshots in ~5s:', snaps);
await fetch(base + '/api/send?sid=' + s2.sid, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ t: 'leave' }) });
