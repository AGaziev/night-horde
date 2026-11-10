// Two bot players: host direct, second via proxy port; records snapshot arrivals for both.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/Users/a.gaziev/src/modules/.tmp/vibe-survivors/app/package.json');
const WebSocket = require('ws');
const [srvPort, proxyPort, transport, secs, out] = [+process.argv[2], +process.argv[3], process.argv[4], +process.argv[5], process.argv[6]];

async function session(port) {
	const r = await fetch(`http://127.0.0.1:${port}/api/session`);
	return (await r.json()).sid;
}
function client(port, tr, name) {
	return new Promise(async (resolve) => {
		const sid = await session(port);
		const c = { name, rec: [], handlers: [], pid: null, x: 0, y: 0 };
		const onMsg = (raw) => {
			const now = performance.now() / 1000;
			const m = JSON.parse(raw);
			for (const msg of Array.isArray(m) ? m : [m]) {
				if (msg.t === 'welcome') c.pid = msg.pid;
				if (msg.t === 's') c.rec.push({ arr: now, tm: msg.tm, p: msg.p, e: msg.e });
				for (const h of c.handlers) h(msg);
			}
		};
		if (tr === 'ws') {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?sid=${sid}`);
			c.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
			ws.on('message', (d) => onMsg(d.toString()));
			ws.on('open', () => resolve(c));
			c.close = () => ws.close();
		} else {
			const ctl = new AbortController();
			c.send = (m) => fetch(`http://127.0.0.1:${port}/api/send?sid=${sid}`, { method: 'POST', body: JSON.stringify(m), headers: { 'content-type': 'application/json' } }).catch(() => {});
			c.close = () => ctl.abort();
			const res = await fetch(`http://127.0.0.1:${port}/api/events?sid=${sid}`, { signal: ctl.signal });
			resolve(c);
			const dec = new TextDecoder(); let buf = '';
			(async () => {
				try {
					for await (const chunk of res.body) {
						buf += dec.decode(chunk, { stream: true });
						let i;
						while ((i = buf.indexOf('\n\n')) >= 0) {
							const block = buf.slice(0, i); buf = buf.slice(i + 2);
							for (const line of block.split('\n')) if (line.startsWith('data: ')) onMsg(line.slice(6));
						}
					}
				} catch {}
			})();
		}
	});
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const host = await client(srvPort, 'ws', 'host');
const second = await client(proxyPort, transport, 'second');
await wait(300);
let code;
host.handlers.push((m) => { if (m.t === 'lobby') code = m.code; });
host.send({ t: 'create', hero: 'knight' });
await wait(300);
second.send({ t: 'join', code, hero: 'knight' });
await wait(500);
let started = false;
for (const c of [host, second]) c.handlers.push((m) => {
	if (m.t === 'start') { started = true; const me = m.players.find((p) => p.pid === c.pid); c.x = me.x; c.y = me.y; }
	if (m.t === 'lvl') c.send({ t: 'pick', i: 0 });
	if (m.t === 'over') console.log(c.name, 'over', m.win);
});
host.send({ t: 'start' });
await wait(500);
// host circles slowly near origin; second walks away to ~1600 px then circles there.
const t0 = performance.now() / 1000;
const iv = setInterval(() => {
	const t = performance.now() / 1000 - t0;
	host.x = 200 * Math.cos(t * 0.3); host.y = 200 * Math.sin(t * 0.3);
	const r = Math.min(1600, t * 150);
	second.x = r + 150 * Math.cos(t * 0.5); second.y = 150 * Math.sin(t * 0.5);
	for (const c of [host, second]) c.send({ t: 'pos', x: Math.round(c.x), y: Math.round(c.y), fx: 1, fy: 0 });
}, 1000 / 15);
await wait(secs * 1000);
clearInterval(iv);
fs.writeFileSync(out, JSON.stringify({ transport, host: { pid: host.pid, rec: host.rec }, second: { pid: second.pid, rec: second.rec } }));
console.log('saved', out, host.rec.length, second.rec.length, 'enemies last', (host.rec.at(-1)?.e.length || 0) / 5);
host.close(); second.close();
process.exit(0);
