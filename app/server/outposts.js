import { MAX_ENEMIES, enemyHpScale, xpForNext } from '../public/shared/content.js';

export const OUTPOST = Object.freeze({
	guards: 20, aliveCap: 72, activation: 900, pursuit: 650, leash: 520,
	minDistance: 1800, spacing: 900, world: 100000, safeSpawn: 200,
	preparation: 0.9, shotLife: 2.4, shotRange: 650,
});
const TYPES = ['skel', 'skel', 'brute', 'skel', 'shield', 'brute', 'skel', 'sniper', 'skel', 'brute',
	'skel', 'skel', 'brute', 'shield', 'skel', 'sniper', 'brute', 'skel', 'brute', 'skel'];
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const valid = (p, heroes, posts) => Math.abs(p.x) <= OUTPOST.world - OUTPOST.leash
	&& Math.abs(p.y) <= OUTPOST.world - OUTPOST.leash
	&& heroes.every(h => d2(p, h) >= OUTPOST.minDistance ** 2)
	&& posts.every(q => d2(p, q) >= OUTPOST.spacing ** 2);

function place(room) {
	const net = room.outposts, heroes = [...room.heroes.values()];
	if (!heroes.length) return;
	// Bounded attempts near different heroes handle split parties and world edges.
	for (let attempt = 0; attempt < 192 && net.posts.length < net.target; attempt++) {
		const h = heroes[attempt % heroes.length], angle = Math.random() * Math.PI * 2;
		const distance = attempt < 128 ? 1800 + Math.random() * 600 : 2800 + Math.random() * 1200;
		const p = {
			id: net.posts.length + 1, x: Math.round(h.x + Math.cos(angle) * distance), y: Math.round(h.y + Math.sin(angle) * distance),
			spawned: 0, killed: 0, chest: 0, activated: false,
		};
		if (valid(p, heroes, net.posts)) net.posts.push(p);
	}
	// Random retries can miss a narrow corner pocket forever. Scan a finite grid in
	// the allowed fallback annulus, retaining every camp already shown to players.
	for (const h of heroes) {
		for (let dx = -4000; dx <= 4000 && net.posts.length < net.target; dx += 100) {
			for (let dy = -4000; dy <= 4000 && net.posts.length < net.target; dy += 100) {
				const distance2 = dx * dx + dy * dy;
				if (distance2 < 2800 ** 2 || distance2 > 4000 ** 2) continue;
				const p = { id: net.posts.length + 1, x: Math.round(h.x + dx), y: Math.round(h.y + dy),
					spawned: 0, killed: 0, chest: 0, activated: false };
				if (valid(p, heroes, net.posts)) net.posts.push(p);
			}
		}
		if (net.posts.length === net.target) break;
	}

	net.nextPlacement = room.time + 2;
}

function safePosition(post, alive) {
	for (let i = 0; i < 32; i++) {
		const angle = (i / 32) * Math.PI * 2 + post.spawned * 2.39996;
		const radius = 240 + (post.spawned % 4) * 55;
		const p = { x: post.x + Math.cos(angle) * radius, y: post.y + Math.sin(angle) * radius };
		if (alive.every(h => d2(p, h) >= OUTPOST.safeSpawn ** 2)) return p;
	}
	return null;
}

export function updateOutposts(room, alive) {
	if (room.fin || room.time < room.runLength * 2 / 3) return;
	if (!room.outposts) {
		room.outposts = { status: 'active', target: room.heroes.size + 1, posts: [], nextPlacement: 0, spawnCursor: 0 };
		room.fx.push(['outposts', 'arrive', room.outposts.target]);
	}
	const net = room.outposts;
	if (net.status === 'closed') return;
	for (const p of net.posts) if (p.chest === 1 && alive.some(h => d2(h, p) < 70 ** 2)) openOutpostChest(room, p);
	if (net.status !== 'active') return;
	if (net.posts.length < net.target && room.time >= net.nextPlacement) place(room);
	const active = net.posts.filter(p => p.killed < OUTPOST.guards && alive.some(h => d2(p, h) <= OUTPOST.activation ** 2));
	for (const p of active) p.activated = true;
	let live = 0, guards = 0;
	for (const e of room.enemies) if (!e.dead) { live++; if (e.outpost) guards++; }
	const blocked = new Set();
	// Lowest dispatched count first: every active camp gets eight before one gets a ninth.
	while (live < MAX_ENEMIES && guards < OUTPOST.aliveCap) {
		const eligible = active.filter(p => p.spawned < OUTPOST.guards && !blocked.has(p));
		if (!eligible.length) break;
		eligible.sort((a, b) => a.spawned - b.spawned
			|| ((a.id - net.spawnCursor + net.target) % net.target) - ((b.id - net.spawnCursor + net.target) % net.target));
		const post = eligible[0], pos = safePosition(post, alive);
		if (!pos) { blocked.add(post); continue; }
		const e = room.spawnEnemy(TYPES[post.spawned], alive, enemyHpScale(room.nt, room.heroes.size) * 1.4);
		Object.assign(e, pos, { outpost: post, guardReadyAt: room.time + OUTPOST.preparation });
		e.dmg *= 1.15;
		e.dmgMul *= 1.15;
		room.fx.push(['warn', Math.round(e.x), Math.round(e.y), e.r + 14, OUTPOST.preparation]);
		post.spawned++;
		net.spawnCursor = post.id + 1;
		live++;
		guards++;
	}
}

export function guardKilled(room, e) {
	const net = room.outposts, p = e?.outpost;
	if (!net || net.status !== 'active' || !p || e.guardCounted || !net.posts.includes(p)) return;
	e.guardCounted = true;
	p.killed++;
	if (p.killed === OUTPOST.guards) { p.chest = 1; room.fx.push(['outposts', 'clear', p.id]); }
	if (net.posts.length !== net.target || !net.posts.every(p => p.killed === OUTPOST.guards)) return;
	net.status = 'won';
	for (const h of room.heroes.values()) {
		h.victoryBanner = true;
		room.recalcMods(h);
		room.legendaryReforge(h, 'outposts');
	}
	room.fx.push(['outposts', 'won']);
}

export function openOutpostChest(room, p) {
	if (!room.outposts?.posts.includes(p) || p.chest !== 1) return false;
	p.chest = 2;
	for (const h of room.heroes.values()) {
		room.addXp(h, xpForNext(h.level, room.heroes.size) * 0.2);
		if (h.st === 0) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.2);
	}
	room.fx.push(['outposts', 'chest', p.id]);
	return true;
}

export function closeOutposts(room) {
	const net = room.outposts;
	if (!net || net.status !== 'active') return;
	net.status = 'closed';
	for (const p of net.posts) p.chest = 3;
	for (const e of room.enemies) if (e.outpost) e.dead = true;
	room.hostile = room.hostile.filter(s => !s.outpost);
	room.fx.push(['outposts', 'closed']);
}

export function confineGuard(e) {
	if (!e.outpost) return;
	const p = e.outpost, dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
	if (d > OUTPOST.leash) {
		e.x = p.x + dx / d * OUTPOST.leash;
		e.y = p.y + dy / d * OUTPOST.leash;
	}
}

export function outpostSnapshot(room) {
	const net = room.outposts;
	return net ? {
		status: net.status, total: net.target, cleared: net.posts.filter(p => p.killed === OUTPOST.guards).length,
		posts: net.posts.map(p => [p.id, p.x, p.y, p.killed, p.spawned, p.chest]),
	} : null;
}

export function boundGuardShot(e, s) {
	if (!e.outpost) return s;
	s.outpost = e.outpost;
	const dx = s.x - e.outpost.x, dy = s.y - e.outpost.y, v2 = s.vx ** 2 + s.vy ** 2, dot = dx * s.vx + dy * s.vy;
	const edge = v2 ? (-dot + Math.sqrt(Math.max(0, dot ** 2 + v2 * (OUTPOST.shotRange ** 2 - dx ** 2 - dy ** 2)))) / v2 : 0;
	s.life = Math.min(s.life, OUTPOST.shotLife, edge);
	s.from = 'outpost:shot';
	return s;
}
