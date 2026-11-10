// Throwaway mock server for client visual testing (SSE + POST only; WS upgrade refused so the client falls back).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/a.gaziev/src/modules/.tmp/vibe-survivors/app/public';
const PORT = +process.env.PORT || 3917;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const sessions = new Map();
let nextPid = 1;

function send(sess, msg) { if (sess.res) sess.res.write(`data: ${JSON.stringify(msg)}\n\n`); }

function lobbyMsg(s) {
	return { t: 'lobby', code: 'ABCD', host: s.pid, players: [
		{ pid: s.pid, name: s.name, hero: s.hero, ready: s.ready, color: '#4fc3f7' },
		{ pid: 99, name: 'Бот Вася', hero: 'witch', ready: true, color: '#ff8a65' },
	] };
}

function startGame(s) {
	s.inGame = true; s.x = 0; s.y = 0; s.tm = 0; s.k = 0;
	send(s, { t: 'start', players: [
		{ pid: s.pid, name: s.name, hero: s.hero, color: '#4fc3f7', x: 0, y: 0 },
		{ pid: 99, name: 'Бот Вася', hero: 'witch', color: '#ff8a65', x: 900, y: -300 },
		{ pid: 98, name: 'Петя', hero: 'ranger', color: '#aed581', x: 80, y: 60 },
	] });
	let tick = 0;
	s.timer = setInterval(() => {
		tick++; s.tm = +(tick * 0.1).toFixed(2);
		const e = [];
		for (let i = 0; i < 300; i++) {
			const a = i * 0.37 + s.tm * 0.2 * (i % 2 ? 1 : -1);
			const r = 120 + (i % 25) * 22;
			e.push(i + 1, i === 0 ? 5 : i % 5, Math.round(s.x + Math.cos(a) * r), Math.round(s.y + Math.sin(a) * r), 100 - (i % 3) * 30);
		}
		const b = [];
		for (let i = 0; i < 6; i++) {
			const a = i + s.tm; const d = (s.tm * 300 + i * 40) % 300;
			b.push(1000 + i, i % 2, Math.round(s.x + Math.cos(a) * d), Math.round(s.y + Math.sin(a) * d), Math.round(a * 100));
		}
		const g = [];
		for (let i = 0; i < 30; i++) g.push(2000 + i, Math.round(s.x - 200 + (i % 6) * 30), Math.round(s.y + 120 + Math.floor(i / 6) * 25), i % 3);
		const fx = [['hit', s.x + 100, s.y, 7 + tick % 30], ['die', s.x + 140, s.y - 40, tick % 5]];
		if (tick % 10 === 0) fx.push(['zap', s.x + 150, s.y - 400, s.x + 150, s.y - 50]);
		if (tick % 13 === 0) fx.push(['slash', s.pid, tick % 2 ? 1 : -1, 110, 40]);
		if (tick % 25 === 0) fx.push(['hurt', s.pid]);
		if (tick === 20) fx.push(['boss', 'Владыка ночи']);
		s.k += 2;
		send(s, { t: 's', tm: s.tm, k: s.k,
			p: [
				[s.pid, Math.round(s.x), Math.round(s.y), 90, 140, 3, 7, 21, 0, 0, 1, 0, [['whip', 2], ['orbit', 3], ['aura', 1]]],
				[99, 900, -300, 0, 100, 2, 1, 13, 1, (tick * 3) % 100, 1, 0, [['bolt', 1]]],
				[98, 80 + Math.round(Math.sin(s.tm) * 40), 60, 60, 110, 2, 1, 13, 0, 0, 0.71, 0.71, [['knives', 1], ['orbit', 1]]],
			],
			e, b, g, z: [3000, Math.round(s.x - 120), Math.round(s.y - 80), 55], fx, boss: tick > 20 ? [1700, 2500] : null });
		if (tick === 15) send(s, { t: 'lvl', pending: 1, choices: [
			{ id: 'lightning', kind: 'weapon', name: 'Гроза', icon: 'ϟ', desc: 'Молния бьёт случайных врагов на экране', level: 1 },
			{ id: 'whip', kind: 'weapon', name: 'Клинок', icon: '⚔', desc: 'урон 18→22, оба направления', level: 3 },
			{ id: 'swift', kind: 'passive', name: 'Лёгкость', icon: '👟', desc: '+8% скорости', level: 1 },
		] });
	}, 100);
}

function handle(s, m) {
	if (Array.isArray(m)) return m.forEach((x) => handle(s, x));
	switch (m.t) {
		case 'ping': send(s, { t: 'pong', c: m.c }); break;
		case 'list': send(s, { t: 'rooms', rooms: [{ code: 'QWER', host: 'Маша', players: 2, state: 'lobby' }, { code: 'ZXCV', host: 'Очень длинное имя хоста', players: 7, state: 'lobby' }] }); break;
		case 'name': s.name = m.name; break;
		case 'create': case 'join': s.hero = m.hero || 'knight'; send(s, lobbyMsg(s)); break;
		case 'hero': s.hero = m.hero; send(s, lobbyMsg(s)); break;
		case 'ready': s.ready = !!m.v; send(s, lobbyMsg(s)); break;
		case 'start': startGame(s); break;
		case 'pos': s.x = m.x; s.y = m.y; break;
		case 'pick': if (m.i === 0) send(s, { t: 'err', msg: 'Тестовая ошибка: выбор принят' }); break;
		case 'leave': clearInterval(s.timer); break;
		case 'again': send(s, lobbyMsg(s)); break;
	}
}

http.createServer((req, res) => {
	const u = new URL(req.url, 'http://x');
	if (u.pathname === '/api/session') {
		let sid = u.searchParams.get('sid');
		if (!sid || !sessions.has(sid)) { sid = Math.random().toString(36).slice(2); sessions.set(sid, { sid, pid: nextPid++, name: 'Игрок ' + nextPid, hero: 'knight', ready: false }); }
		res.writeHead(200, { 'Content-Type': 'application/json' });
		return res.end(JSON.stringify({ sid, name: sessions.get(sid).name }));
	}
	if (u.pathname === '/api/events') {
		const s = sessions.get(u.searchParams.get('sid'));
		if (!s) { res.writeHead(404); return res.end(); }
		res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
		s.res = res;
		send(s, { t: 'welcome', pid: s.pid, name: s.name, room: null });
		req.on('close', () => { if (s.res === res) s.res = null; clearInterval(s.timer); });
		return;
	}
	if (u.pathname === '/api/send') {
		const s = sessions.get(u.searchParams.get('sid'));
		let body = '';
		req.on('data', (c) => body += c);
		req.on('end', () => { res.writeHead(s ? 204 : 404); res.end(); if (s) try { handle(s, JSON.parse(body)); } catch {} });
		return;
	}
	if (u.pathname === '/_gw/icon') { res.writeHead(204); return res.end(); }
	const file = path.join(ROOT, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname));
	if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
	fs.readFile(file, (err, data) => {
		if (err) { res.writeHead(404); return res.end('nf'); }
		res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
		res.end(data);
	});
}).listen(PORT, () => console.log('mock on', PORT));
