import { DASH, segmentDistance2 } from '../public/shared/mobility.js';
import { PLAYER_RADIUS, clampToRing } from '../public/shared/content.js';

export function requestDash(room, pid, msg) {
	const h = room.heroes.get(pid);
	if (!h) return;
	const ok = room.state === 'play' && !room.frozen && !room.paused && !h.offer && !h.offline && h.st === 0
		&& !h.dash && room.time >= (h.dashReadyAt ?? 0);
	if (!ok) {
		room.send(pid, { t: 'dash', ok: false, epoch: h.moveEpoch ?? 0 });
		return;
	}
	const valid = Number.isFinite(msg.x) && Number.isFinite(msg.y) && Math.hypot(msg.x, msg.y) > 0.01;
	const x = valid ? msg.x : h.mvx ?? h.fx, y = valid ? msg.y : h.mvy ?? h.fy;
	const len = Math.hypot(x, y) || 1;
	h.moveEpoch = (h.moveEpoch ?? 0) + 1;
	h.dash = { x: x / len, y: y / len, left: DASH.duration };
	h.dashReadyAt = room.time + DASH.cooldown;
	h.fx = h.mvx = h.dash.x;
	h.fy = h.mvy = h.dash.y;
	h.movedT = room.time;
	room.send(pid, { t: 'dash', ok: true, epoch: h.moveEpoch, x: h.x, y: h.y, dx: h.dash.x, dy: h.dash.y, readyAt: h.dashReadyAt });
}

export function stepMobility(room, dt) {
	for (const h of room.heroes.values()) {
		h.dashPath = null;
		if (!h.dash) continue;
		if (h.st !== 0 || h.offline) { h.dash = null; continue; }
		const d = h.dash, time = Math.min(dt, d.left);
		h.dashPath = { x: h.x, y: h.y, duration: time };
		h.x = Math.max(-100000, Math.min(100000, h.x + d.x * DASH.distance * time / DASH.duration));
		h.y = Math.max(-100000, Math.min(100000, h.y + d.y * DASH.distance * time / DASH.duration));
		if (room.fin) [h.x, h.y] = clampToRing(h.x, h.y, room.fin.cx, room.fin.cy, Math.max(0, room.fin.r - PLAYER_RADIUS));
		h.movedT = h.lastPosT = room.time;
		d.left -= time;
		if (d.left < 1e-8) h.dash = null;
	}
}

// Follow both moving bodies. In the last dash tick the hero can arrive early,
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

export const mobilitySnapshot = room => [...room.heroes.values()].map(h => [h.pid, h.moveEpoch ?? 0, h.dashReadyAt ?? 0]);
