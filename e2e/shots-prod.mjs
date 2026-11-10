import { createRequire } from 'node:module';
import fs from 'node:fs';
const WebSocket = createRequire(process.argv[2] + '/')('ws');
const tok = JSON.parse(fs.readFileSync('token.json')).data.token;
const base = 'https://app-0fdbcfb656d3.vibecode.bitrix24.tech', H = { Authorization: 'Bearer ' + tok };
const js = await (await fetch(base + '/js/render.js', { headers: H })).text();
console.log('new render.js:', js.includes('drawProjectiles(ctx, game)'));
const sess = await (await fetch(base + '/api/session', { headers: H })).json();
const kinds = {}; let started = false;
await new Promise((res) => {
	const ws = new WebSocket(base.replace('https', 'wss') + '/ws?sid=' + sess.sid, { headers: H });
	ws.on('open', () => ws.send(JSON.stringify({ t: 'create', hero: 'ranger' })));
	ws.on('message', (m) => {
		const msg = JSON.parse(m);
		if (msg.t === 'lobby' && !started) { started = true; ws.send(JSON.stringify({ t: 'start' })); }
		if (msg.t === 's') for (const f of msg.fx) kinds[f[0]] = (kinds[f[0]] || 0) + 1;
	});
	setTimeout(() => { ws.send(JSON.stringify({ t: 'leave' })); setTimeout(() => { ws.close(); res(); }, 300); }, 6000);
});
console.log('fx in 6s:', JSON.stringify(kinds));
