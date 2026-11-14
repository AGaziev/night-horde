import { DASH, clipDash, segmentDistance2 } from '../public/shared/mobility.js';
import { PLAYER_RADIUS } from '../public/shared/content.js';
import { contactInterval } from '../public/shared/contact-time.js';

export function requestDash(room, pid, msg) {
	const h = room.heroes.get(pid);
	if (!h) return;
	const identity = { run: msg.run, request: msg.request };
	const fresh = msg.run === room.runLog?.id && Number.isSafeInteger(msg.request) && msg.request > (h.dashRequest ?? 0)
		&& Number.isFinite(msg.expiresAt) && msg.expiresAt >= Date.now() && msg.expiresAt <= Date.now() + 2000;
	const ok = room.state === 'play' && !room.frozen && !room.paused && !h.offer && !h.offline && h.st === 0
		&& fresh && !h.dash && room.time >= (h.dashReadyAt ?? 0);
	if (!ok) {
		room.send(pid, { t: 'dash', ...identity, ok: false, epoch: h.moveEpoch ?? 0 });
		return;
	}
	h.dashRequest = msg.request;
	const valid = Number.isFinite(msg.x) && Number.isFinite(msg.y) && Math.hypot(msg.x, msg.y) > 0.01;
	const x = valid ? msg.x : h.mvx ?? h.fx, y = valid ? msg.y : h.mvy ?? h.fy;
	const len = Math.hypot(x, y) || 1;
	h.moveEpoch = (h.moveEpoch ?? 0) + 1;
	h.dash = { x: x / len, y: y / len, left: DASH.duration };
	h.dashReadyAt = room.time + DASH.cooldown;
	h.fx = h.mvx = h.dash.x;
	h.fy = h.mvy = h.dash.y;
	h.movedT = room.time;
	room.send(pid, { t: 'dash', ...identity, ok: true, serverNow: Date.now(), epoch: h.moveEpoch, x: h.x, y: h.y, dx: h.dash.x, dy: h.dash.y, readyAt: h.dashReadyAt });
}

export function stepMobility(room, dt) {
	for (const h of room.heroes.values()) {
		h.dashPath = null;
		if (!h.dash) continue;
		if (h.st !== 0 || h.offline) { h.dash = null; continue; }
		const d = h.dash, time = Math.min(dt, d.left);
		const ring = room.fin ? { cx: room.fin.cx, cy: room.fin.cy, r: Math.max(0, room.fin.r - PLAYER_RADIUS) } : null;
		const travel = clipDash(h.x, h.y, d.x, d.y, time, ring);
		h.dashPath = { x: travel.startX, y: travel.startY, duration: travel.duration };
		h.x = travel.x; h.y = travel.y;
		h.movedT = h.lastPosT = room.time;
		d.left -= time;
		if (d.left < 1e-8) h.dash = null;
	}
}

// Follow a moving enemy body or shot against the hero. In the last dash tick the hero can arrive early,
// so split travel and the stationary remainder rather than stretching travel.
export function dashShotDistance2(h, sx, sy, ex, ey, dt) {
	const from = h.dashPath;
	const fraction = Math.min(1, from.duration / dt);
	const mx = sx + (ex - sx) * fraction, my = sy + (ey - sy) * fraction;
	return Math.min(
		segmentDistance2(0, 0, sx - from.x, sy - from.y, mx - h.x, my - h.y),
		segmentDistance2(h.x, h.y, mx, my, ex, ey),
	);
}

// Contact time in seconds from this tick's start. The object exists only in [from,to].
// Split at the actual dash stop; the hero stays at its endpoint for the rest of the tick.
export function dashContactTime(h, sx, sy, ex, ey, dt, radius, from = 0, to = dt) {
	const path = h.dashPath;
	const stop = path ? Math.min(dt, path.duration) : 0;
	const heroAt = t => !path || t >= stop || stop <= 0 ? [h.x, h.y]
		: [path.x + (h.x - path.x) * t / stop, path.y + (h.y - path.y) * t / stop];
	if (to === from) {
		const [hx, hy] = heroAt(from);
		return (sx - hx) ** 2 + (sy - hy) ** 2 < radius ** 2 ? from : null;
	}
	const cuts = stop > from && stop < to ? [from, stop, to] : [from, to];
	for (let i = 0; i < cuts.length - 1; i++) {
		const a = cuts[i], b = cuts[i + 1], u = (a - from) / (to - from), v = (b - from) / (to - from);
		const [hx, hy] = heroAt(a), [kx, ky] = heroAt(b);
		const hit = contactInterval(sx + (ex - sx) * u - hx, sy + (ey - sy) * u - hy,
			sx + (ex - sx) * v - kx, sy + (ey - sy) * v - ky, radius);
		if (hit) return a + (b - a) * hit[0];
	}
	return null;
}

export const mobilitySnapshot = room => [...room.heroes.values()].map(h => [h.pid, h.moveEpoch ?? 0, h.dashReadyAt ?? 0, h.dash?.left ?? 0]);
