import { enemyHpScale, xpForNext } from '../public/shared/content.js';

export const CARAVAN = Object.freeze({ from: .35, until: .55, speed: 45, route: 900, pursuit: 650, leash: 480, preparation: .8 });
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function create(room, alive) {
	// Far from every participant, including split/downed heroes; never appear on top of a player.
	const heroes = [...room.heroes.values()];
	for (let i = 0; i < 64; i++) {
		const h = alive[i % alive.length], a = Math.random() * Math.PI * 2, distance = 1200 + (i % 8) * 100;
		const x = h.x + Math.cos(a) * distance, y = h.y + Math.sin(a) * distance;
		const ex = x - Math.sin(a) * CARAVAN.route, ey = y + Math.cos(a) * CARAVAN.route;
		if (Math.max(Math.abs(x), Math.abs(y), Math.abs(ex), Math.abs(ey)) > 99000 || heroes.some(p => d2(p, { x, y }) < 1000 ** 2)) continue;
		return { status: 'guarded', x, y, ax: x, ay: y, bx: ex, by: ey, direction: 1, progress: 0,
			total: 12 + 2 * (room.heroes.size - 1), killed: 0, expires: room.runLength * CARAVAN.until };
	}
	return null;
}

export function updateCaravan(room, alive, dt) {
	if (room.isHorde) return;
	if (room.fin || room.time >= room.runLength * CARAVAN.until) { closeCaravan(room); return; }
	if (room.time < room.runLength * CARAVAN.from || !alive.length) return;
	if (!room.caravan) {
		if (room.time < (room.nextCaravanTry ?? 0)) return;
		room.nextCaravanTry = room.time + 2;
		const c = create(room, alive);
		if (!c) return;
		room.caravan = c;
		for (let i = 0; i < c.total; i++) {
			const a = i * Math.PI * 2 / c.total, r = 230 + (i % 3) * 35;
			const e = room.spawnEnemy(i < 2 ? 'brute' : i === 2 ? 'shield' : 'skel', alive, enemyHpScale(room.nt, room.heroes.size) * 1.35);
			Object.assign(e, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, caravan: c, guardReadyAt: room.time + CARAVAN.preparation });
			e.dmg *= 1.1; e.dmgMul *= 1.1;
			room.fx.push(['warn', Math.round(e.x), Math.round(e.y), e.r + 14, CARAVAN.preparation]);
		}
	}
	const c = room.caravan;
	if (c.status === 'claimed' || c.status === 'expired') return;
	// Shuttle on one finite segment; heroes can intercept either end instead of chasing forever.
	c.progress += c.direction * CARAVAN.speed * dt / CARAVAN.route;
	if (c.progress >= 1) { c.progress = 1; c.direction = -1; }
	if (c.progress <= 0) { c.progress = 0; c.direction = 1; }
	c.x = c.ax + (c.bx - c.ax) * c.progress;
	c.y = c.ay + (c.by - c.ay) * c.progress;
	if (c.status === 'open' && alive.some(h => d2(h, c) <= 75 ** 2)) claimCaravan(room);
}

export function caravanGuardKilled(room, e) {
	const c = room.caravan;
	if (!c || e.caravan !== c || e.caravanCounted || c.status !== 'guarded') return;
	e.caravanCounted = true;
	if (++c.killed === c.total) c.status = 'open';
}

export function claimCaravan(room) {
	const c = room.caravan;
	if (!c || c.status !== 'open' || room.fin || room.time >= c.expires) return false;
	c.status = 'claimed';
	for (const h of room.heroes.values()) {
		room.addXp(h, xpForNext(h.level, room.heroes.size) * .15);
		if (h.st === 0) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * .1);
	}
	return true;
}

export function closeCaravan(room) {
	const c = room.caravan;
	if (!c || c.status === 'claimed' || c.status === 'expired') return;
	c.status = 'expired';
	for (const e of room.enemies) if (e.caravan === c) e.dead = true;
	room.hostile = room.hostile.filter(s => s.caravan !== c);
}

export function confineCaravanGuard(e) {
	if (!e.caravan) return;
	const c = e.caravan, dx = e.x - c.x, dy = e.y - c.y, d = Math.hypot(dx, dy);
	if (d > CARAVAN.leash) { e.x = c.x + dx / d * CARAVAN.leash; e.y = c.y + dy / d * CARAVAN.leash; }
}

export const caravanSnapshot = room => {
	const c = room.caravan;
	return c && c.status !== 'expired' && c.status !== 'claimed' ? { status: c.status, x: Math.round(c.x), y: Math.round(c.y), killed: c.killed, total: c.total, expires: c.expires } : null;
};
