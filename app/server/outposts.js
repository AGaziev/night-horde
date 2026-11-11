import { enemyHpScale, enemyDmgScale, xpForNext } from '../public/shared/content.js';

export const OUTPOST = Object.freeze({
	guards: 40, aliveCap: 288, perPostCap: 40, rangedCap: 4, hp: 1.5, damage: 1.15,
	activation: 900, pursuit: 650, leash: 520,
	minDistance: 1800, spacing: 900, world: 100000, safeSpawn: 200,
	preparation: 0.9, shotLife: 2.4, shotRange: 650,
	sniperKeep: Object.freeze([180, 240]),
});
// Strong archetypes appear in the first 32 slots even when all nine posts share the live budget.
// The final eight are finite reserves, not repetitions of a shorter type table.
const ROSTER = Object.freeze([
	'skel', 'skel', 'skel', 'skel', 'skel', 'skel', 'skel', 'brute',
	'skel', 'skel', 'skel', 'skel', 'skel', 'skel', 'skel', 'shield',
	'skel', 'skel', 'skel', 'skel', 'skel', 'skel', 'skel', 'brute',
	'skel', 'skel', 'skel', 'skel', 'skel', 'skel', 'skel', 'sniper',
	'skel', 'brute', 'skel', 'shield', 'skel', 'brute', 'skel', 'sniper',
]);
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const garrison = net => ({ total: net.guardsPerPost, pending: [...ROSTER],
	spawned: 0, killed: 0, chest: 0, activated: false });
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
		};
		if (valid(p, heroes, net.posts)) net.posts.push(Object.assign(p, garrison(net)));
	}
	// A coarse deterministic scan finds corner pockets random retries can miss.
	// Only a crowded edge fallback extends to 6000; never move an existing camp.
	const margin = OUTPOST.world - OUTPOST.leash;
	for (const range of [4000, 6000]) {
		for (const h of heroes) {
			for (let dx = Math.max(-range, -margin - h.x); dx <= Math.min(range, margin - h.x) && net.posts.length < net.target; dx += 100) {
				for (let dy = Math.max(-range, -margin - h.y); dy <= Math.min(range, margin - h.y) && net.posts.length < net.target; dy += 100) {
					const distance2 = dx * dx + dy * dy;
					if (distance2 < (range === 4000 ? 2800 : 4000) ** 2 || distance2 > range ** 2) continue;
					const p = { id: net.posts.length + 1, x: Math.round(h.x + dx), y: Math.round(h.y + dy) };
					if (valid(p, heroes, net.posts)) net.posts.push(Object.assign(p, garrison(net)));
				}
			}
			if (net.posts.length === net.target) break;
		}
		if (net.posts.length === net.target) break;
	}

	net.nextPlacement = room.time + 2;
}

function safePosition(post, alive) {
	// Preserve the preferred ring first; try all existing rings within a fixed 128-candidate bound.
	for (let ring = 0; ring < 4; ring++) {
		const radius = 240 + ((post.spawned + ring) % 4) * 55;
		for (let i = 0; i < 32; i++) {
			const angle = (i / 32) * Math.PI * 2 + post.spawned * 2.39996;
			const p = { x: post.x + Math.cos(angle) * radius, y: post.y + Math.sin(angle) * radius };
			if (alive.every(h => d2(p, h) >= OUTPOST.safeSpawn ** 2)) return p;
		}
	}
	return null;
}

export function updateOutposts(room, alive) {
	if (room.fin || room.time < room.runLength * 2 / 3) return;
	if (!room.outposts) {
		const target = room.heroes.size + 1;
		room.outposts = { status: 'active', target, creationNt: room.nt, guardsPerPost: OUTPOST.guards,
			liveLimit: Math.min(OUTPOST.perPostCap, Math.floor(OUTPOST.aliveCap / target)), posts: [], nextPlacement: 0, spawnCursor: 0 };
		room.fx.push(['outposts', 'arrive', room.outposts.target]);
	}
	const net = room.outposts;
	if (net.status === 'closed') return;
	for (const p of net.posts) if (p.chest === 1 && alive.some(h => d2(h, p) < 70 ** 2)) openOutpostChest(room, p);
	if (net.status !== 'active') return;
	if (net.posts.length < net.target && room.time >= net.nextPlacement) place(room);
	const active = net.posts.filter(p => p.killed < p.total && alive.some(h => d2(p, h) <= OUTPOST.activation ** 2));
	for (const p of active) p.activated = true;
	let guards = 0;
	const live = new Map(net.posts.map(p => [p, { total: 0, ranged: 0 }]));
	for (const e of room.enemies) if (!e.dead && e.outpost) {
		guards++;
		const count = live.get(e.outpost);
		if (count) { count.total++; if (e.ai === 'sniper') count.ranged++; }
	}
	const blocked = new Set();
	// Each camp owns its slots even while inactive: visiting old camps cannot starve the last one.
	while (guards < OUTPOST.aliveCap) {
		const eligible = active.filter(p => p.pending.length && live.get(p).total < net.liveLimit && !blocked.has(p));
		if (!eligible.length) break;
		eligible.sort((a, b) => a.spawned - b.spawned
			|| ((a.id - net.spawnCursor + net.target) % net.target) - ((b.id - net.spawnCursor + net.target) % net.target));
		const post = eligible[0], count = live.get(post);
		// Melee reserves may pass a blocked sniper; no reserve is discarded or regenerated.
		const next = post.pending.findIndex(type => type !== 'sniper' || count.ranged < OUTPOST.rangedCap);
		if (next < 0) { blocked.add(post); continue; }
		const pos = safePosition(post, alive);
		if (!pos) { blocked.add(post); continue; }
		const e = room.spawnEnemy(post.pending[next], alive, enemyHpScale(net.creationNt, room.heroes.size) * OUTPOST.hp);
		Object.assign(e, pos, { outpost: post, guardReadyAt: room.time + OUTPOST.preparation });
		// Reserves belong to the original cohort, including after a late first approach or player leave.
		const damage = OUTPOST.damage * enemyDmgScale(net.creationNt, room.heroes.size) / enemyDmgScale(room.nt, room.heroes.size);
		e.dmg *= damage;
		e.dmgMul *= damage;
		room.fx.push(['warn', Math.round(e.x), Math.round(e.y), e.r + 14, OUTPOST.preparation]);
		post.spawned++;
		post.pending.splice(next, 1);
		net.spawnCursor = post.id + 1;
		count.total++;
		if (e.ai === 'sniper') count.ranged++;
		guards++;
	}
}

export function guardKilled(room, e) {
	const net = room.outposts, p = e?.outpost;
	if (!net || net.status !== 'active' || !p || e.guardCounted || !net.posts.includes(p)) return;
	e.guardCounted = true;
	p.killed++;
	if (p.killed === p.total) { p.chest = 1; room.fx.push(['outposts', 'clear', p.id]); }
	if (net.posts.length !== net.target || !net.posts.every(p => p.killed === p.total)) return;
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
	if (!net || net.status === 'closed') return;
	const won = net.status === 'won';
	if (!won) net.status = 'closed';
	for (const p of net.posts) if (p.chest !== 2) p.chest = 3;
	for (const e of room.enemies) if (e.outpost) e.dead = true;
	room.hostile = room.hostile.filter(s => !s.outpost);
	if (!won) room.fx.push(['outposts', 'closed']);
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
		status: net.status, total: net.target, guards: net.target * net.guardsPerPost,
		cleared: net.posts.filter(p => p.killed === p.total).length,
		posts: net.posts.map(p => [p.id, p.x, p.y, p.killed, p.spawned, p.chest, p.total]),
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
