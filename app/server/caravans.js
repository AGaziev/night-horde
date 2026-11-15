import { enemyHpScale, xpForNext } from '../public/shared/content.js';

export const CARAVAN = Object.freeze({
	from: .35, until: .55, speed: 45, route: 900, pursuit: 720, leash: 520, preparation: 1.2,
	spawnMin: 2600, spawnMax: 3200, minDistance: 2200, routeDistance: 1800, world: 99000,
	hp: 1.6, damage: 1.25, shotLife: 2.4, shotRange: 720,
});
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function create(room, alive) {
	const heroes = [...room.heroes.values()];
	const candidate = (h, a, distance) => {
		const x = h.x + Math.cos(a) * distance, y = h.y + Math.sin(a) * distance;
		const ex = x - Math.sin(a) * CARAVAN.route, ey = y + Math.cos(a) * CARAVAN.route;
		if (Math.max(Math.abs(x), Math.abs(y), Math.abs(ex), Math.abs(ey)) > CARAVAN.world) return null;
		// The closest point on the entire route must be safe for split and downed participants too.
		for (const p of heroes) {
			const t = Math.max(0, Math.min(1, ((p.x - x) * (ex - x) + (p.y - y) * (ey - y)) / CARAVAN.route ** 2));
			if (d2(p, { x, y }) < CARAVAN.minDistance ** 2
				|| d2(p, { x: x + (ex - x) * t, y: y + (ey - y) * t }) < CARAVAN.routeDistance ** 2) return null;
		}
		return { status: 'guarded', x, y, ax: x, ay: y, bx: ex, by: ey, direction: 1, progress: 0,
			total: 32 + 4 * (room.heroes.size - 1), killed: 0, creationNt: room.nt, expires: room.runLength * CARAVAN.until };
	};
	for (let i = 0; i < 64; i++) {
		const c = candidate(alive[i % alive.length], Math.random() * Math.PI * 2,
			CARAVAN.spawnMin + Math.random() * (CARAVAN.spawnMax - CARAVAN.spawnMin));
		if (c) return c;
	}
	// Fixed, bounded fallback finds edge pockets without relaxing distance or extending the event.
	for (const h of alive) for (const distance of [CARAVAN.spawnMin, (CARAVAN.spawnMin + CARAVAN.spawnMax) / 2, CARAVAN.spawnMax]) {
		for (let i = 0; i < 32; i++) {
			const c = candidate(h, i * Math.PI / 16, distance);
			if (c) return c;
		}
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
		const n = room.heroes.size, brutes = n + 3, shields = 2, ranged = Math.min(4, n + 1);
		for (let i = 0; i < c.total; i++) {
			const a = i * Math.PI * 2 / c.total, r = 230 + (i % 3) * 35;
			const type = i < brutes ? 'brute' : i < brutes + shields ? 'shield' : i < brutes + shields + ranged ? 'spitter' : 'skel';
			const e = room.spawnEnemy(type, alive, enemyHpScale(c.creationNt, n) * CARAVAN.hp,
				[c.x + Math.cos(a) * r, c.y + Math.sin(a) * r]);
			Object.assign(e, { caravan: c, guardReadyAt: room.time + CARAVAN.preparation });
			e.dmg *= CARAVAN.damage; e.dmgMul *= CARAVAN.damage;
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
	clearShots(room, c);
	for (const h of room.heroes.values()) {
		room.legendaryReforge(h, 'caravan');
		room.addXp(h, xpForNext(h.level, room.heroes.size) * .25);
		if (h.st === 0) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * .2);
	}
	return true;
}

export function closeCaravan(room) {
	const c = room.caravan;
	if (!c || c.status === 'claimed' || c.status === 'expired') return;
	c.status = 'expired';
	for (const e of room.enemies) if (e.caravan === c) e.dead = true;
	clearShots(room, c);
}

function clearShots(room, c) {
	room.hostile = room.hostile.filter(s => {
		if (s.caravan !== c) return true;
		room.fx.push(['epend', s.id, room.time, s.x, s.y, 0]);
		return false;
	});
}

export function boundCaravanShot(e, s) {
	if (!e.caravan) return s;
	s.caravan = e.caravan;
	s.from = 'caravan:shot';
	// Fix the circle at launch: the moving wagon never extends a shot's path or lifetime.
	const dx = s.x - e.caravan.x, dy = s.y - e.caravan.y;
	const v2 = s.vx ** 2 + s.vy ** 2, dot = dx * s.vx + dy * s.vy;
	const edge = v2 ? (-dot + Math.sqrt(Math.max(0, dot ** 2 + v2 * (CARAVAN.shotRange ** 2 - dx ** 2 - dy ** 2)))) / v2 : 0;
	s.life = Math.max(0, Math.min(s.life, CARAVAN.shotLife, edge));
	return s;
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
