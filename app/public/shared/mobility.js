export const DASH = Object.freeze({ distance: 180, duration: 0.15, cooldown: 12 });

export const dashBounds = (arena, radius) => arena ? {
 minX: arena.minX + radius, maxX: arena.maxX - radius,
 minY: arena.minY + radius, maxY: arena.maxY - radius,
} : null;

// Several rounded projection/root operations can leave a few coordinate ULPs.
// Such a residual is stationary, not a path that can enter an earlier hit phase.
export const hasDashMovement = (dx, dy, scale = 1) =>
 Math.hypot(dx, dy) > 16 * Number.EPSILON * Math.max(1, scale);

export function segmentDistance2(x, y, ax, ay, bx, by) {
	const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
	const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
	return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
}

// Move on the requested ray at dash speed until the first world/ring boundary, then stand still.
// Ring radius is already reduced by the hero radius. Projection of an invalid start is instantaneous.
export function clipDash(x, y, dx, dy, time, ring = null, bounds = null) {
 const limit = 100000, speed = DASH.distance / DASH.duration;
 const minX = bounds?.minX ?? -limit, maxX = bounds?.maxX ?? limit;
 const minY = bounds?.minY ?? -limit, maxY = bounds?.maxY ?? limit;
 x = Math.max(minX, Math.min(maxX, x)); y = Math.max(minY, Math.min(maxY, y));
 let projectedToRing = false;
 if (ring) {
  const ox = x - ring.cx, oy = y - ring.cy, distance = Math.hypot(ox, oy);
  if (distance > ring.r) { x = ring.cx + ox * ring.r / distance; y = ring.cy + oy * ring.r / distance; projectedToRing = true; }
 }
 const startX = x, startY = y, vx = dx * speed, vy = dy * speed;
 let duration = Math.max(0, time);
 if (vx) duration = Math.min(duration, ((vx > 0 ? maxX : minX) - x) / vx);
 if (vy) duration = Math.min(duration, ((vy > 0 ? maxY : minY) - y) / vy);
 if (ring) {
  const ox = x - ring.cx, oy = y - ring.cy, a = vx * vx + vy * vy, b = ox * vx + oy * vy;
  const distance = Math.hypot(ox, oy);
  // A projected start is on the boundary even if its coordinates round slightly inward.
  // Factor the circle residual so an unprojected boundary does not gain squared-term roundoff.
  const c = projectedToRing ? 0 : (distance - ring.r) * (distance + ring.r);
  if (a) {
   const root = Math.sqrt(Math.max(0, b * b - a * c));
   // The conjugate root avoids cancellation for short outward movement.
   const exit = b >= 0 ? (c === 0 ? 0 : -c / (b + root)) : (-b + root) / a;
   duration = Math.min(duration, exit);
  }
 }
 duration = Math.max(0, duration);
 let endX = x + vx * duration, endY = y + vy * duration;
 const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(endX), Math.abs(endY),
  ring ? Math.max(Math.abs(ring.cx), Math.abs(ring.cy), ring.r) : 0);
 if (!hasDashMovement(endX - x, endY - y, scale)) { endX = x; endY = y; duration = 0; }
 return { x: endX, y: endY, startX, startY, duration };
}
