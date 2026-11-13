export const DASH = Object.freeze({ distance: 180, duration: 0.15, cooldown: 12 });

export function segmentDistance2(x, y, ax, ay, bx, by) {
	const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
	const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
	return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
}
