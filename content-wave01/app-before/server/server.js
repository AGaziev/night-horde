import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Hub, sanitizeName } from './game.js';
import { TICK_HZ } from '../public/shared/content.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const MAX_BODY = 64 * 1024;
const DISCONNECT_GRACE_MS = 20_000;
const UNUSED_SESSION_MS = 60_000;
const SSE_HEARTBEAT_MS = 10_000;
const WS_PING_MS = 20_000;
const MAX_BUFFERED = 1 << 20;
const MSG_RATE_PER_SEC = 120;
const SID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
};

// --- sessions ---

const sessions = new Map(); // sid -> session
const byPid = new Map(); // pid -> session
let nextPid = 1;
let guestNo = 0;

const hub = new Hub((pid, msg, json) => {
	const s = byPid.get(pid);
	if (s?.conn) s.conn.send(json ?? JSON.stringify(msg), msg.t === 's');
});

function headerName(req) {
	const raw = req.headers['x-vibe-user-name-encoded'];
	if (typeof raw !== 'string' || !raw) return '';
	try {
		return sanitizeName(decodeURIComponent(raw));
	} catch {
		return '';
	}
}

function createSession(req) {
	const sid = crypto.randomBytes(16).toString('base64url');
	const pid = nextPid++;
	const name = headerName(req) || `Игрок ${++guestNo}`;
	const s = { sid, pid, conn: null, timer: null, tokens: MSG_RATE_PER_SEC, tokensAt: Date.now() };
	sessions.set(sid, s);
	byPid.set(pid, s);
	hub.addPlayer(pid, name);
	scheduleRemoval(s, UNUSED_SESSION_MS);
	return s;
}

function scheduleRemoval(s, ms) {
	clearTimeout(s.timer);
	s.timer = setTimeout(() => {
		if (s.conn) return;
		sessions.delete(s.sid);
		byPid.delete(s.pid);
		hub.removePlayer(s.pid);
	}, ms);
}

function attach(s, conn) {
	const old = s.conn;
	s.conn = conn;
	clearTimeout(s.timer);
	s.timer = null;
	if (old) old.close();
	hub.welcome(s.pid);
}

function detach(s, conn) {
	if (s.conn !== conn) return;
	s.conn = null;
	if (sessions.get(s.sid) === s) scheduleRemoval(s, DISCONNECT_GRACE_MS);
}

function allowMessage(s) {
	const now = Date.now();
	s.tokens = Math.min(MSG_RATE_PER_SEC, s.tokens + ((now - s.tokensAt) / 1000) * MSG_RATE_PER_SEC);
	s.tokensAt = now;
	if (s.tokens < 1) return false;
	s.tokens--;
	return true;
}

function dispatch(s, msg) {
	if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
	if (!allowMessage(s)) return;
	try {
		hub.handle(s.pid, msg);
	} catch (e) {
		console.error('handle error', e);
	}
}

function parseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function getSession(sid) {
	return typeof sid === 'string' && SID_RE.test(sid) ? sessions.get(sid) ?? null : null;
}

// --- HTTP ---

function sendText(res, code, text, type = 'text/plain; charset=utf-8') {
	res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
	res.end(text);
}

function sendJson(res, code, obj) {
	sendText(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');
}

function serveStatic(req, res, pathname) {
	if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'method not allowed');
	let rel;
	try {
		rel = decodeURIComponent(pathname);
	} catch {
		return sendText(res, 400, 'bad request');
	}
	if (rel.includes('\0')) return sendText(res, 400, 'bad request');
	if (rel.endsWith('/')) rel += 'index.html';
	const file = path.resolve(PUBLIC_DIR, '.' + path.posix.normalize('/' + rel));
	if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, 'forbidden');
	fs.stat(file, (err, st) => {
		if (err || !st.isFile()) return sendText(res, 404, 'not found');
		const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
		res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
		if (req.method === 'HEAD') return res.end();
		fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
	});
}

function handleSession(req, res, url) {
	const existing = getSession(url.searchParams.get('sid'));
	const s = existing ?? createSession(req);
	sendJson(res, 200, { sid: s.sid, name: hub.players.get(s.pid)?.name ?? '' });
}

function handleEvents(req, res, url) {
	const s = getSession(url.searchParams.get('sid'));
	if (!s) return sendJson(res, 404, { err: 'unknown sid' });
	req.socket.setNoDelay(true);
	req.socket.setTimeout(0);
	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		'Connection': 'keep-alive',
		'X-Accel-Buffering': 'no',
	});
	// Padding pushes the first bytes through proxies that buffer small responses.
	res.write(`: ${' '.repeat(2048)}\n\n`);
	const hb = setInterval(() => res.write(': hb\n\n'), SSE_HEARTBEAT_MS);
	let closed = false;
	const conn = {
		send(json, droppable) {
			if (closed || (droppable && res.writableLength > MAX_BUFFERED)) return;
			res.write(`data: ${json}\n\n`);
		},
		close() {
			if (closed) return;
			closed = true;
			clearInterval(hb);
			res.end();
		},
	};
	res.on('close', () => {
		closed = true;
		clearInterval(hb);
		detach(s, conn);
	});
	attach(s, conn);
}

function handleSend(req, res, url) {
	if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');
	const s = getSession(url.searchParams.get('sid'));
	if (!s) {
		req.resume();
		return sendJson(res, 404, { err: 'unknown sid' });
	}
	const chunks = [];
	let size = 0;
	let tooBig = false;
	req.on('data', (c) => {
		if (tooBig) return;
		size += c.length;
		if (size > MAX_BODY) {
			tooBig = true;
			sendText(res, 413, 'too large');
			req.destroy();
			return;
		}
		chunks.push(c);
	});
	req.on('end', () => {
		if (tooBig) return;
		res.writeHead(204, { 'Cache-Control': 'no-store' });
		res.end();
		const data = parseJson(Buffer.concat(chunks).toString('utf8'));
		if (Array.isArray(data)) for (const m of data.slice(0, 64)) dispatch(s, m);
		else dispatch(s, data);
	});
}

const server = http.createServer((req, res) => {
	let url;
	try {
		url = new URL(req.url, 'http://localhost');
	} catch {
		return sendText(res, 400, 'bad request');
	}
	const p = url.pathname;
	if (p === '/health') return sendText(res, 200, 'ok');
	if (p === '/api/session') return handleSession(req, res, url);
	if (p === '/api/events') return handleEvents(req, res, url);
	if (p === '/api/send') return handleSend(req, res, url);
	if (p.startsWith('/api/')) return sendText(res, 404, 'not found');
	serveStatic(req, res, p);
});

// --- WebSocket ---

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
	let url;
	try {
		url = new URL(req.url, 'http://localhost');
	} catch {
		return socket.destroy();
	}
	if (url.pathname !== '/ws') return socket.destroy();
	const s = getSession(url.searchParams.get('sid'));
	wss.handleUpgrade(req, socket, head, (ws) => {
		if (!s) return ws.close(4001, 'unknown sid');
		socket.setNoDelay(true);
		let alive = true;
		const conn = {
			send(json, droppable) {
				if (ws.readyState !== ws.OPEN || (droppable && ws.bufferedAmount > MAX_BUFFERED)) return;
				ws.send(json);
			},
			close() {
				ws.close(4000, 'replaced');
			},
		};
		ws.on('pong', () => {
			alive = true;
		});
		const ping = setInterval(() => {
			if (!alive) return ws.terminate();
			alive = false;
			ws.ping();
		}, WS_PING_MS);
		ws.on('message', (data, isBinary) => {
			if (isBinary) return;
			dispatch(s, parseJson(data.toString('utf8')));
		});
		ws.on('close', () => {
			clearInterval(ping);
			detach(s, conn);
		});
		ws.on('error', () => {});
		attach(s, conn);
	});
});

// --- game loop: one interval for all rooms ---

// Fixed steps with catch-up, so game time (snapshot tm) keeps pace with the wall clock after short
// event-loop stalls; clients derive their render clock from it. Longer stalls are dropped.
const TICK_DT = 1 / TICK_HZ;
const MAX_CATCH_UP = 0.25;
let last = performance.now();
let acc = 0;
setInterval(() => {
	const now = performance.now();
	acc = Math.min(MAX_CATCH_UP, acc + Math.max(0, (now - last) / 1000));
	last = now;
	try {
		while (acc >= TICK_DT) {
			acc -= TICK_DT;
			hub.tick(TICK_DT);
		}
	} catch (e) {
		acc = 0;
		console.error('tick error', e);
	}
}, 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`Ночная орда: http://localhost:${PORT}`));
