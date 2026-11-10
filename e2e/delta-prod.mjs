import { createRequire } from 'node:module';
import fs from 'node:fs';
const app = process.argv[2];
const WebSocket = createRequire(app + '/')('ws');
const { PROTO, SnapshotDecoder } = await import(app + '/public/js/snapshot-codec.js');
const tok = JSON.parse(fs.readFileSync('token.json')).data.token;
const base = 'https://app-0fdbcfb656d3.vibecode.bitrix24.tech', H = { Authorization: 'Bearer ' + tok };
const sess = await (await fetch(base + '/api/session', { headers: H })).json();
const dec = new SnapshotDecoder();
let started = false, snaps = 0, ok = 0, miss = 0, bytes = 0, maxE = 0, keys = 0, t0 = 0;
await new Promise((res) => {
	const ws = new WebSocket(base.replace('https', 'wss') + `/ws?sid=${sess.sid}&v=${PROTO}`, { headers: H });
	ws.on('open', () => ws.send(JSON.stringify({ t: 'create', hero: 'knight' })));
	ws.on('message', (m) => {
		const msg = JSON.parse(m);
		if (msg.t === 'welcome') console.log('welcome v', msg.v, 'client', PROTO);
		if (msg.t === 'lobby' && !started) { started = true; ws.send(JSON.stringify({ t: 'start' })); }
		if (msg.t === 's') {
			if (!t0) t0 = Date.now();
			snaps++; bytes += m.length; if (msg.K === 1) keys++;
			const s = dec.decode(msg);
			if (s) { ok++; maxE = Math.max(maxE, (s.e || []).length); } else miss++;
		}
	});
	setTimeout(() => { ws.send(JSON.stringify({ t: 'leave' })); setTimeout(() => { ws.close(); res(); }, 300); }, 20000);
});
const sec = (Date.now() - t0) / 1000;
console.log(JSON.stringify({ snaps, decoded: ok, gaps: miss, keys, maxEnemies: maxE, kbps: +(bytes / 1024 / sec).toFixed(1) }));
