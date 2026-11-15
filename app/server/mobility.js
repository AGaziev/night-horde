import { DASH, clipDash, dashBounds, hasDashMovement, segmentDistance2 } from '../public/shared/mobility.js';
import { PLAYER_RADIUS } from '../public/shared/content.js';
import { HORDE_ARENA } from '../public/shared/horde-content.js';
import { contactInterval } from '../public/shared/contact-time.js';

// The ring/world may reject the whole ray. Its later ordinary projection is not dash travel.
export const hasActualDash = h => !!h.dashPath && hasDashMovement(
 h.dashPath.moveX ?? 0, h.dashPath.moveY ?? 0,
 Math.max(Math.abs(h.dashPath.x ?? 0), Math.abs(h.dashPath.y ?? 0)),
);

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
		const travel = clipDash(h.x, h.y, d.x, d.y, time, ring, dashBounds(room.isHorde ? HORDE_ARENA : null, PLAYER_RADIUS));
		const moveX = travel.x-travel.startX, moveY = travel.y-travel.startY, stationary = moveX===0 && moveY===0;
		h.dashPath = { x: travel.startX, y: travel.startY, duration: travel.duration, moveX, moveY,
			fromX: stationary ? h.hostilePos?.x ?? travel.startX : travel.startX,
			fromY: stationary ? h.hostilePos?.y ?? travel.startY : travel.startY };
		h.x = travel.x; h.y = travel.y;
		h.movedT = h.lastPosT = room.time;
		if (room.isHorde) { h.hordeMoveAt = room.time; h.hordeMoveCredit = 0; }
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
// Split at the actual dash stop. A later wall projection retains its ordinary full-tick motion.
export function dashContactTime(h, sx, sy, ex, ey, dt, radius, from = 0, to = dt) {
	const path = h.dashPath;
	const stop = path ? Math.min(dt, path.duration) : 0;
	const heroAt = t => {
		if (!path) return [h.x,h.y];
		const x = path.fromX ?? path.x, y = path.fromY ?? path.y;
		const dx = path.moveX ?? (stop>0 ? h.x-path.x : 0), dy = path.moveY ?? (stop>0 ? h.y-path.y : 0);
		const ordinary = dt>0 ? t/dt : 1, dash = stop>0 ? Math.min(1,t/stop) : 0;
		// Keep the actual dash ray; a later wall projection is its own ordinary movement component.
		return [x+(h.x-x-dx)*ordinary+dx*dash,y+(h.y-y-dy)*ordinary+dy*dash];
	};
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
