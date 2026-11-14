import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Hub, sanitizeName } from './game.js';
import { runStore, logText } from './runlog.js';
import { readFeedback, saveFeedback } from './feedback.js';
import { createLobbyInvites, inviteCapacity, inviteDelivery } from './lobby-invites.js';
import { PROTO, clientProto } from './snapshot-codec.js';
import { TICK_HZ, GAME_VERSION, MAX_PLAYERS } from '../public/shared/content.js';
import { ProgressStore, vibeBackend, bitrixUid, progressMsg, unlockedOf, isoWeek } from './storage.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const MAX_BODY = 64 * 1024;
const DISCONNECT_GRACE_MS = 20_000;
// v19: during a run a dropped player is kept this long (the hero lies down at once, allies can lift it).
const PLAY_GRACE_MS = 120_000;
const UNUSED_SESSION_MS = 60_000;
const SSE_HEARTBEAT_MS = 10_000;
const WS_PING_MS = 20_000;
const MAX_BUFFERED = 1 << 20;
const MSG_RATE_PER_SEC = 120;
const SID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const TEMP_RUNS_DIR = '/tmp/horde-runs';
const persistentRuns = process.env.NODE_ENV === 'production' && !process.env.HORDE_RUNS_DIR;
const RUNS_DIR = process.env.HORDE_RUNS_DIR || (persistentRuns ? '/opt/data/runs' : TEMP_RUNS_DIR);

runStore.persist(RUNS_DIR, persistentRuns ? TEMP_RUNS_DIR : null);

const FEEDBACK_FILE = path.join(RUNS_DIR, 'feedback.json');
const MAX_FORM_BYTES = 8 * 1024;
const FEEDBACK_MAX_COMMENT = 1000;
const FEEDBACK_INTERVAL_MS = 10_000;
const FEEDBACK_RATINGS = new Set(['easy', 'right', 'hard']);

// v22: player progress in the Vibecode app storage; without the key everything stays in the browser.
const STORAGE_TICK_MS = 2_000;
const APP_KEY = process.env.VIBE_APP_KEY || '';
const lobbyInvites = createLobbyInvites({
	key: APP_KEY, serverId: process.env.HORDE_VIBE_SERVER_ID, origin: process.env.HORDE_APP_ORIGIN,
});
const inviteTimes = new Map();
const INVITE_COOLDOWN = 15_000;
const START_DELAYS = new Set([1, 3, 5, 10, 15, 30]);
// Only for local test runs: a key prefix such as «selftest/» (letters, digits, - _ /), empty on production.
const STORAGE_PREFIX = /^[A-Za-z0-9_-]+\/$/.test(process.env.HORDE_STORAGE_PREFIX ?? '') ? process.env.HORDE_STORAGE_PREFIX : '';
const store = new ProgressStore({
	backend: APP_KEY ? vibeBackend(APP_KEY, { prefix: STORAGE_PREFIX }) : null,
	onLoaded: (uid) => sendProgress(uid),
});
console.log(`storage: ${store.enabled ? `on${STORAGE_PREFIX ? `, prefix ${STORAGE_PREFIX}` : ''}` : 'off (no VIBE_APP_KEY)'}`);

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
hub.isConnected = (pid) => !!byPid.get(pid)?.conn;

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
	const portalName = headerName(req);
	const name = portalName || `Игрок ${++guestNo}`;
	// Only a numeric X-Vibe-User-Id is a portal user; guests and prefixed ids keep progress in the browser.
	const uid = bitrixUid(req.headers['x-vibe-user-id']);
	const s = { sid, pid, uid, portalName, migSent: false, conn: null, timer: null, tokens: MSG_RATE_PER_SEC, tokensAt: Date.now() };
	sessions.set(sid, s);
	byPid.set(pid, s);
	hub.addPlayer(pid, name, uid);
	scheduleRemoval(s, UNUSED_SESSION_MS);
	if (uid && store.enabled) {
		store.retain(uid).then((rec) => rec && sendProgress(uid));
	}
	return s;
}

function sendProgress(uid) {
	const rec = store.record(uid);
	const json = JSON.stringify(progressMsg(store, rec));
	for (const s of sessions.values()) {
		if (s.uid !== uid) continue;
		s.conn?.send(json, false);
		syncUnlocked(s);
	}
}

// Totals and weekly records at the end of a run (called by the room, synchronously, before `over`).
hub.onRunEnd = (info) => {
	const tot = new Map();
	if (!store.enabled) return tot;
	for (const st of info.stats) {
		const s = byPid.get(st.pid);
		if (!s?.uid) continue;
		const t = store.addRun(s.uid, { ach: st.ach, duos: info.duos.get(st.pid) });
		if (t) tot.set(st.pid, t);
		store.addResult(s.uid, {
			name: s.portalName || st.name, hero: st.hero, win: info.win, lord: info.grade === 2, time: info.time, kills: st.kills,
			mode: info.mode, players: info.players, at: Date.now(),
		});
	}
	return tot;
};

function scheduleRemoval(s, ms) {
	clearTimeout(s.timer);
	s.timer = setTimeout(() => {
		if (s.conn) return;
		sessions.delete(s.sid);
		byPid.delete(s.pid);
		if (s.uid) store.release(s.uid);
		clientProto.delete(s.pid);
		hub.removePlayer(s.pid);
	}, ms);
}

// Clients announce their protocol as ?v=; a tab opened before an update has none and keeps getting plain snapshots.
function protoOf(url) {
	const v = Number(url.searchParams.get('v'));
	return Number.isInteger(v) && v > 0 ? v : 10;
}

function attach(s, conn, proto) {
	const old = s.conn;
	s.conn = conn;
	clearTimeout(s.timer);
	s.timer = null;
	if (old) old.close();
	clientProto.set(s.pid, proto);
	hub.setOffline(s.pid, false);
	hub.welcome(s.pid);
	conn.send(JSON.stringify(progressMsg(store, s.uid ? store.record(s.uid) : null)), false);
	if (proto < PROTO) conn.send(JSON.stringify({ t: 'err', msg: 'Игра обновилась — обновите страницу (F5), чтобы играть дальше' }), false);
}

function detach(s, conn) {
	if (s.conn !== conn) return;
	s.conn = null;
	if (sessions.get(s.sid) !== s) return;
	const inRun = hub.inRun(s.pid);
	scheduleRemoval(s, inRun ? PLAY_GRACE_MS : DISCONNECT_GRACE_MS);
	if (inRun) hub.setOffline(s.pid, true);
}

function allowMessage(s) {
	const now = Date.now();
	s.tokens = Math.min(MSG_RATE_PER_SEC, s.tokens + ((now - s.tokensAt) / 1000) * MSG_RATE_PER_SEC);
	s.tokensAt = now;
	if (s.tokens < 1) return false;
	s.tokens--;
	return true;
}

// v22 messages that need the session's portal user: the browser's progress handed over once, the weekly top.
function handleProgress(s, msg) {
	if (msg.t === 'mig') {
		const rec = s.uid && store.record(s.uid);
		if (!rec || s.migSent) return true;
		s.migSent = true;
		store.migrate(s.uid, msg);
		sendProgress(s.uid);
		return true;
	}
	if (msg.t === 'top') {
		const week = isoWeek();
		const rows = store.enabled ? store.top(week, s.uid) : null;
		s.conn?.send(JSON.stringify({ t: 'top', week, rows, off: !store.enabled }), false);
		// Not read yet: the answer follows the read; a failed read says «unavailable» instead of loading forever.
		if (store.enabled && !rows) store.loadBoard(week).then((r) => s.conn?.send(JSON.stringify({ t: 'top', week, rows: r ? store.top(week, s.uid) : null, off: !r }), false));
		return true;
	}
	return false;
}

// For a portal user with a read object the server, not the browser, says which heroes are open.
function serverUnlocked(s) {
	const rec = s.uid && store.record(s.uid);
	return rec ? unlockedOf(rec) : null;
}
function syncUnlocked(s) {
	const list = serverUnlocked(s);
	if (list && hub.players.get(s.pid)?.room) hub.handle(s.pid, { t: 'heroes', heroes: list });
}

function dispatch(s, msg) {
	if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
	if (!allowMessage(s)) return;
	try {
		if (handleProgress(s, msg)) return;
		if (msg.t === 'heroes' || msg.t === 'create' || msg.t === 'join') {
			const list = serverUnlocked(s);
			if (list) msg = { ...msg, heroes: list };
		}
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
	sendJson(res, 200, { sid: s.sid, name: hub.players.get(s.pid)?.name ?? '', invites: !!lobbyInvites });
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
	attach(s, conn, protoOf(url));
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

async function readSmallJson(req, res) {
	if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
		req.resume();
		return sendJson(res, 415, { err: 'expected JSON' });
	}
	let size = 0;
	const chunks = [];
	for await (const chunk of req.iterator({ destroyOnReturn: false })) {
		size += chunk.length;
		if (size > MAX_FORM_BYTES) {
			req.resume();
			return sendJson(res, 413, { err: 'body too large' });
		}
		chunks.push(chunk);
	}
	return parseJson(Buffer.concat(chunks).toString('utf8'));
}

async function handleFeedback(req, res) {
	try {
		if (req.method === 'GET') {
			const portalSession = /^Bearer vibe_session_[A-Za-z0-9_-]+$/.test(req.headers['x-vibe-authorization'] ?? '');
			if (!portalSession || req.headers['x-vibe-user-role'] !== 'ADMIN' || !bitrixUid(req.headers['x-vibe-user-id'])) {
				return sendJson(res, 403, { err: 'forbidden' });
			}
			return sendJson(res, 200, { feedback: readFeedback(FEEDBACK_FILE).reverse() });
		}
		if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');
		const data = await readSmallJson(req, res);
		if (res.writableEnded) return;
		if (!data || typeof data !== 'object' || Array.isArray(data)) return sendJson(res, 400, { err: 'invalid feedback' });
		const session = getSession(data.sid);
		if (!session) return sendJson(res, 401, { err: 'unknown sid' });
		const rating = data.rating ?? null;
		const rawComment = data.comment ?? '';
		if (typeof rawComment !== 'string' || rawComment.length > FEEDBACK_MAX_COMMENT || (rating !== null && !FEEDBACK_RATINGS.has(rating))) {
			return sendJson(res, 400, { err: 'invalid feedback' });
		}
		const comment = rawComment.trim();
		if (!rating && !comment) return sendJson(res, 400, { err: 'empty feedback' });
		const now = Date.now();
		if (now - (session.feedbackAt ?? 0) < FEEDBACK_INTERVAL_MS) {
			res.setHeader('Retry-After', String(Math.ceil((FEEDBACK_INTERVAL_MS - (now - session.feedbackAt)) / 1000)));
			return sendJson(res, 429, { err: 'too many requests' });
		}
		const runId = typeof data.runId === 'string' ? runStore.get(data.runId)?.id ?? null : null;
		saveFeedback(FEEDBACK_FILE, { at: new Date(now).toISOString(), v: GAME_VERSION, runId, rating, comment });
		session.feedbackAt = now;
		return sendJson(res, 201, { ok: true });
	} catch (e) {
		if (res.destroyed) return;
		console.error('feedback:', e.code ?? e.name);
		return sendJson(res, 503, { err: 'feedback unavailable' });
	}
}

async function handleLobbyInvites(req, res, url) {
	if (req.method !== 'GET' && req.method !== 'POST') return sendText(res, 405, 'method not allowed');
	const reject = (status, error) => { req.resume(); return sendJson(res, status, { error }); };
	if (!lobbyInvites) return reject(503, 'Приглашения недоступны.');
	const session = getSession(url.searchParams.get('sid'));
	const uid = bitrixUid(req.headers['x-vibe-user-id']);
	const authorization = req.headers['x-vibe-authorization'] ?? '';
	if (!session?.conn || !uid || uid !== session.uid || !/^Bearer vibe_session_[A-Za-z0-9_-]+$/.test(authorization)) {
		return reject(401, 'Откройте игру из Битрикс24, чтобы приглашать сотрудников.');
	}
	const code = url.searchParams.get('room');
	const room = hub.hostLobby(session.pid, code);
	if (!room) return reject(403, 'Приглашать сотрудников может только хост комнаты.');

	try {
		if (req.method === 'GET') {
			const employees = await lobbyInvites.list();
			if (hub.hostLobby(session.pid, code) !== room) return reject(409, 'Комната изменилась. Откройте форму ещё раз.');
			const members = new Set([...room.members.values()].map((member) => member.uid));
			const batch = room.inviteBatch?.startsAt === room.startsAt ? room.inviteBatch : null;
			return sendJson(res, 200, { employees: employees.filter(({ id }) => !members.has(id)), slots: inviteCapacity(room, MAX_PLAYERS),
				warning: lobbyInvites.warning, delivery: batch?.result ?? null, startsAt: room.startsAt,
				batchId: room.inviteBatch?.id ?? null, revision: room.inviteRevision, serverNow: Date.now() });
		}
		const input = await readSmallJson(req, res);
		if (res.writableEnded) return;
		if (!START_DELAYS.has(input?.minutes) || !Array.isArray(input?.ids) || input.ids.length > (room.maxMembers ?? MAX_PLAYERS) - 1
			|| input.ids.some((id) => !bitrixUid(id))) {
			return reject(400, 'Проверьте время старта и список сотрудников.');
		}
		const ids = [...new Set(input.ids)];
		const batch = room.inviteBatch;
		const requestedRetry = input.startsAt != null || input.batchId != null;
		if (requestedRetry && (typeof input.batchId !== 'string' || !input.batchId)) {
			return reject(409, 'Обновите страницу игры, чтобы повторить недоставленные приглашения.');
		}
		const retry = requestedRetry && room.startsAt !== null && batch?.startsAt === room.startsAt
			&& typeof input.batchId === 'string' && input.batchId === batch.id && input.startsAt === batch.startsAt;
		if (requestedRetry && !retry) return reject(409, 'Эта рассылка уже отменена или изменена. Откройте форму ещё раз.');
		if (room.startsAt !== null && !retry) return reject(409, 'Отсчёт уже идёт.');
		if (retry && (batch.sending || ids.some((id) => !batch.ids.includes(id)))) return reject(409, 'Дождитесь результата текущей отправки.');
		const employees = await lobbyInvites.list(true);
		// Access lookup can outlive a WS cancel/restart, host change, or room start.
		// A retry belongs only to the exact batch/deadline captured before the await.
		if (!session.conn || hub.hostLobby(session.pid, code) !== room
			|| (retry && (room.inviteBatch !== batch || input.batchId !== batch.id || room.startsAt !== batch.startsAt))) {
			return reject(409, 'Отсчёт или комната изменились. Откройте форму ещё раз.');
		}
		const allowed = new Set(employees.map(({ id }) => id));
		if (ids.some((id) => !allowed.has(id))) return reject(409, 'Список доступа изменился. Откройте форму ещё раз.');
		const members = new Set([...room.members.values()].map((member) => member.uid));
		if (ids.includes(uid) || ids.filter((id) => !members.has(id)).length > inviteCapacity(room, MAX_PLAYERS)) {
			return reject(409, 'В комнате изменилось число свободных мест. Откройте форму ещё раз.');
		}
		const now = Date.now();
		if (!retry && ids.length && (inviteTimes.get(uid) ?? 0) > now) return reject(429, 'Подождите несколько секунд перед новой отправкой.');
		const startsAt = retry ? batch.startsAt : now + input.minutes * 60_000;
		const delivery = retry ? batch : { id: crypto.randomUUID(), startsAt, minutes: input.minutes, ids, result: null };
		if (!session.conn || (retry ? hub.hostLobby(session.pid, code) !== room : !hub.scheduleStart(room, session.pid, startsAt, delivery))) {
			return reject(409, 'Комната изменилась или отсчёт уже идёт.');
		}
		// Set synchronously before awaiting the platform: concurrent retries cannot send duplicates.
		if (delivery.sending) return reject(409, 'Дождитесь результата текущей отправки.');
		delivery.sending = true;
		room.inviteBatch = delivery;
		if (ids.length && !retry) {
			for (const [id, until] of inviteTimes) if (until <= now) inviteTimes.delete(id);
			inviteTimes.set(uid, now + INVITE_COOLDOWN);
		}
		try {
			const membersNow = new Set([...room.members.values()].map((member) => member.uid));
			const recipients = (retry ? ids : delivery.ids).filter((id) => !membersNow.has(id));
			const result = await lobbyInvites.send(recipients, authorization, {
				code, startsAt, batchId: delivery.id, minutes: delivery.minutes, host: session.portalName || 'Хост',
			}, delivery.result?.recipients);
			const outcomes = new Map((delivery.result?.recipients ?? []).map((r) => [r.id, r]));
			for (const recipient of result.recipients) outcomes.set(recipient.id, recipient);
			delivery.result = inviteDelivery([...outcomes.values()]);
		} finally { delivery.sending = false; }
		// A complete, confirmed rejection should not leave a scheduled empty lobby behind.
		if (delivery.result.failed > 0 && delivery.result.sent === 0 && delivery.result.unknown === 0) {
			if (room.inviteBatch === delivery && room.cancelStart(startsAt) && room.size === 0) hub.rooms.delete(room.code);
		}
		return sendJson(res, 200, { active: room.inviteBatch === delivery && room.startsAt === startsAt, startsAt,
			batchId: delivery.id, revision: room.inviteBatch === delivery ? room.inviteRevision : delivery.revision, serverNow: Date.now(), ...delivery.result });
	} catch {
		if (!res.destroyed) return reject(503, 'Не удалось получить доступ к Битрикс24. Попробуйте ещё раз.');
	}
}

// GET /api/runs — recent runs; /api/runs/:id — full log (JSON), /api/runs/:id.txt — summary + JSON.
function handleRuns(req, res, p) {
	if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');
	if (p === '/api/runs' || p === '/api/runs/') return sendJson(res, 200, { runs: runStore.list() });
	if (p === '/api/runs/history') return sendJson(res, 200, runStore.history(bitrixUid(req.headers['x-vibe-user-id'])));
	const m = /^\/api\/runs\/([A-Za-z0-9]{6})(\.txt|\.json|\.summary|\.card)?$/.exec(p);
	if (!m) return sendText(res, 404, 'not found');
	const id = m[1].toUpperCase();
	if (m[2] === '.card') {
		const card = runStore.getCard(id);
		return card ? sendJson(res, 200, card) : sendText(res, 404, 'not found');
	}
	const log = runStore.get(id);
	if (!log) return sendText(res, 404, 'not found');
	if (m[2] === '.summary') return sendText(res, 200, log.summary.join('\n'));
	if (m[2] === '.txt') return sendText(res, 200, logText(log));
	sendJson(res, 200, log);
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
	if (p === '/api/feedback') return handleFeedback(req, res);
	if (p === '/api/lobby/invites') return handleLobbyInvites(req, res, url);
	if (p === '/api/runs' || p.startsWith('/api/runs/')) return handleRuns(req, res, p);
	if (p === '/api/busy') return sendJson(res, 200, { ...hub.busy(), v: GAME_VERSION, storage: store.enabled });
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
		attach(s, conn, protoOf(url));
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

if (store.enabled) {
	setInterval(() => store.tick(), STORAGE_TICK_MS).unref();
	store.loadBoard(isoWeek());
}

// A deploy stops the process: what is still in the cache goes to the storage first (up to 5 s).
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
	process.on(sig, async () => {
		if (stopping) return;
		stopping = true;
		await store.flush(5_000);
		process.exit(0);
	});
}

server.listen(PORT, () => console.log(`Ночная орда: http://localhost:${PORT}`));
