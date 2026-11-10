// Drives the local v22 server as a portal user and as a guest. node pm/storage-probe/v22-drive.mjs <port> <phase>
// phase «first»: migration + one run; phase «again»: a fresh session must get the stored totals back.
import WebSocket from '../../app/node_modules/ws/index.js';
const [port = '3622', phase = 'first'] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const UID = '999999999';

async function connect(headers) {
	const { sid } = await (await fetch(`${base}/api/session`, { headers })).json();
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?sid=${sid}&v=19`);
	const inbox = [];
	const waiters = [];
	ws.on('message', (d) => {
		const m = JSON.parse(d.toString());
		if (m.t === 's') return;
		inbox.push(m);
		for (const w of [...waiters]) if (w.f(m)) { waiters.splice(waiters.indexOf(w), 1); w.ok(m); }
	});
	await new Promise((ok) => ws.on('open', ok));
	const wait = (f, ms = 15000) => {
		const hit = inbox.find(f);
		if (hit) { inbox.splice(inbox.indexOf(hit), 1); return Promise.resolve(hit); }
		return new Promise((ok, no) => { waiters.push({ f: (m) => { if (f(m)) { inbox.splice(inbox.indexOf(m), 1); return true; } return false; }, ok }); setTimeout(() => no(new Error('timeout')), ms); });
	};
	return { ws, send: (m) => ws.send(JSON.stringify(m)), wait };
}

const out = {};
const me = await connect({ 'x-vibe-user-id': UID, 'x-vibe-user-name-encoded': encodeURIComponent('Тест v22') });
const t0 = performance.now();
let prog = await me.wait((m) => m.t === 'prog' && m.srv);
out.firstProgMs = Math.round(performance.now() - t0);
out.firstProg = prog;
if (phase === 'first') {
	me.send({ t: 'mig', ach: { wins: 1, bosses: 5, revives: 3, knifeKills: 10, lords: 7, knightBest: 99999 }, duos: ['orb', 'hack'] });
	prog = await me.wait((m) => m.t === 'prog' && m.mig);
	out.afterMig = prog;
	me.send({ t: 'create', hero: 'spearmaiden', mode: 'lunch', heroes: ['knight', 'spearmaiden', 'ranger'] });
	const lobby = await me.wait((m) => m.t === 'lobby');
	out.lobbyHero = lobby.players[0].hero;
	me.send({ t: 'start' });
	const over = await me.wait((m) => m.t === 'over', 20000);
	out.overTot = over.stats[0].tot;
	out.overAch = over.stats[0].ach;
	me.send({ t: 'top' });
	out.top = await me.wait((m) => m.t === 'top' && Array.isArray(m.rows));
} else {
	me.send({ t: 'top' });
	out.top = await me.wait((m) => m.t === 'top' && Array.isArray(m.rows));
}
const guest = await connect({ 'x-vibe-user-id': 'share:abc' });
out.guestProg = await guest.wait((m) => m.t === 'prog');
out.busy = await (await fetch(`${base}/api/busy`)).json();
console.log(JSON.stringify(out, null, 1));
me.ws.close();
guest.ws.close();
