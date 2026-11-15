import { HERO_PERKS, PLAYER_IFRAMES } from '../public/shared/content.js';

export function perkRing(room, x, y, radius, color) {
	room.fx.push(['buildring', Math.round(x), Math.round(y), radius, color]);
}

export function heroShieldReady(h, time) {
	return h.hero === 'knight' && h.st === 0 && !h.offline && time >= h.perk.readyAt;
}

export function blockHeroHit(room, h) {
	if (!heroShieldReady(h, room.time)) return false;
	h.perk.readyAt = room.time + HERO_PERKS.knight.cooldown;
	h.iframes = PLAYER_IFRAMES;
	perkRing(room, h.x, h.y, 34, 2);
	return true;
}

function healOnHit(room, h) {
	if (room.time < h.perk.readyAt) return;
	const { cooldown, self, ally, range } = HERO_PERKS.herald;
	// v27 review: the most wounded ally in range (largest missing share of hp), not the nearest one.
	let target = null, worst = 0;
	for (const o of room.heroes.values()) {
		if (o === h || o.st !== 0 || o.offline || o.hp >= o.maxHp || room.time < o.perk.receivedBellAt + cooldown) continue;
		if ((o.x - h.x) ** 2 + (o.y - h.y) ** 2 > range ** 2) continue;
		const missing = 1 - o.hp / o.maxHp;
		if (missing > worst) {
			worst = missing;
			target = o;
		}
	}
	if (!target && h.hp >= h.maxHp) return;
	h.perk.readyAt = room.time + cooldown;
	room.healSupport(h, h, self);
	perkRing(room, h.x, h.y, 52, 4);
	if (target) {
		room.healSupport(h, target, ally);
		target.perk.receivedBellAt = room.time;
		perkRing(room, target.x, target.y, 32, 4);
	}
}

const RECAST_WEAPONS = new Set([
	'bolt', 'swarm', 'knives', 'sickle', 'whip', 'aura', 'frost', 'bomb', 'traps', 'lightning',
	'prism', 'tuning', 'anchor', 'spear', 'flask', 'quagmire', 'tempest', 'thunderslash', 'orb',
	'fanback', 'icedisc', 'molotov', 'icebomb', 'minefield', 'volley', 'bladestorm', 'pitfall',
]);

const source = (weapon, tags) => ({ weapon: 'perk_' + weapon, tags, perk: true });
const SCOUT = source('ranger', ['phys', 'proj']);
const HAMMER = source('smith', ['phys', 'aoe']);
const STORM = source('stormcaller', ['shock']);
const PIERCE = source('spearmaiden', ['phys', 'proj']);

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function canRepeatCast(id) {
	return RECAST_WEAPONS.has(id);
}

// Reuse the weapon's actual cast so echoes inherit projectile patterns, zones, and forge imprints.
export function repeatCast(room, h, id, w, dt) {
	const copy = { ...w };
	const beforeId = room.nextId, beforeDamage = h.dmg, beforeTimers = room.timers.length;
	const beforeWaves = room.coldWaves.length, previous = room.repeatingCast;
	room.repeatingCast = true;
	try {
		room.castWeapon(h, id, w, dt);
		if (room.nextId === beforeId && h.dmg === beforeDamage && room.timers.length === beforeTimers && room.coldWaves.length === beforeWaves) return;
		const { cooldown, damage } = HERO_PERKS.witch;
		h.perk.readyAt = room.time + cooldown;
		perkRing(room, h.x, h.y, 46, 0);
		room.castWeapon(h, id, copy, dt, damage);
	} finally { room.repeatingCast = previous; }
}

function repeatPulse(room, h, e, dmg, src) {
	if (room.repeatingCast || canRepeatCast(src.weapon)) return;
	let pulse = h.perk.echoPulse;
	if (!pulse || pulse.time !== room.time) {
		if (room.time < h.perk.readyAt) return;
		const { cooldown, damage } = HERO_PERKS.witch;
		h.perk.readyAt = room.time + cooldown;
		pulse = { time: room.time, weapon: src.weapon, hits: new Map() };
		h.perk.echoPulse = pulse;
		room.after(0, () => {
			h.perk.echoPulse = null;
			if (h.st !== 0 || h.offline || !h.weapons.has(pulse.weapon)) return;
			perkRing(room, h.x, h.y, 46, 0);
			for (const [target, hit] of pulse.hits) room.hurtEnemy(target, hit * damage, h, source('witch', src.tags));
		});
	}
	if (pulse.weapon === src.weapon && pulse.hits.size < 16 && !pulse.hits.has(e)) pulse.hits.set(e, dmg);
}

export function scoutKnife(room, h) {
	if (room.time < h.perk.readyAt || room.time - h.movedT > 0.25) return;
	let closest = null, pursuer = null, distance = 380 ** 2, behindDistance = distance;
	for (const e of room.grid.query(h.x, h.y, 380, [])) {
		if (e.dead || e.immuneT > room.time) continue;
		const d = dist2(h, e);
		if (d < distance) [closest, distance] = [e, d];
		const behind = (e.x - h.x) * h.mvx + (e.y - h.y) * h.mvy < 0;
		if (behind && d < behindDistance) [pursuer, behindDistance] = [e, d];
	}
	const target = pursuer ?? closest;
	if (!target) return;
	h.perk.readyAt = room.time + HERO_PERKS.ranger.cooldown;
	const aim = Math.atan2(target.y - h.y, target.x - h.x);
	room.addProjectile(h, 'knife', aim, 630, (6 + 0.65 * (h.level - 1)) * h.mods.dmgMul, 1, 0.85, target, 0, { src: SCOUT });
}

function hammerHit(room, h, e, dmg, src) {
	if (room.time < h.perk.readyAt) return;
	const strikes = e.hammerStrikes ??= new Map();
	const last = strikes.get(h.pid);
	const weapon = src.component ?? src.weapon;
	if (last?.weapon === weapon && room.time - last.time < 0.18) return;
	const count = last && room.time - last.time < 6 ? last.count + (last.weapon === weapon ? 1 : 2) : 1;
	if (count < 4) {
		strikes.set(h.pid, { time: room.time, count, weapon });
		return;
	}
	strikes.delete(h.pid);
	h.perk.readyAt = room.time + HERO_PERKS.smith.cooldown;
	perkRing(room, e.x, e.y, 58, 1);
	room.splash(e.x, e.y, 58, Math.max(dmg * 0.6, (10 + 0.6 * (h.level - 1)) * h.mods.dmgMul), h, HAMMER, null);
}

function dischargeMarks(room, e) {
	if (!e.stormMarks) return;
	const owners = e.stormMarks;
	e.stormMarks = null;
	for (const h of owners) {
		const mark = h.perk.stormMark;
		if (mark?.target !== e) continue;
		h.perk.stormMark = null;
		if (mark.until <= room.time || h.st !== 0 || h.offline || room.heroes.get(h.pid) !== h) continue;
		let next = null, distance = 145 ** 2;
		for (const o of room.grid.query(e.x, e.y, 145, [])) {
			if (o === e || o.dead || o.immuneT > room.time) continue;
			const d = dist2(e, o);
			if (d < distance) [next, distance] = [o, d];
		}
		const target = next ?? e;
		const originY = target === e ? e.y - 65 : e.y;
		room.fx.push(['zap', Math.round(e.x), Math.round(originY), Math.round(target.x), Math.round(target.y)]);
		room.hurtEnemy(target, mark.damage, h, STORM);
	}
}

function markWithStorm(room, h, e, dmg) {
	if (e.dead || room.time < h.perk.readyAt) return;
	const old = h.perk.stormMark;
	if (old?.until > room.time) return;
	old?.target.stormMarks?.delete(h);
	h.perk.readyAt = room.time + HERO_PERKS.stormcaller.cooldown;
	h.perk.stormMark = {
		target: e, until: room.time + 4,
		damage: Math.max(dmg * 0.55, (9 + 0.55 * (h.level - 1)) * h.mods.dmgMul),
	};
	(e.stormMarks ??= new Set()).add(h);
	perkRing(room, e.x, e.y, 24, 2);
}

function leaveResidue(room, h, e, dmg, src) {
	if (room.time < h.perk.readyAt || h.perk.residue?.life > 0) return;
	h.perk.readyAt = room.time + HERO_PERKS.alchemist.cooldown;
	const hot = src.tags.includes('fire'), cold = !hot && src.tags.includes('cold');
	const pool = {
		id: room.nextId++, owner: h, x: e.x, y: e.y, r: 48, life: 2.4, tick: 0.5, t: 0, wet: true,
		dmg: Math.max(dmg * 0.1, (2 + 0.12 * (h.level - 1)) * h.mods.dmgMul),
		slow: cold ? 0.35 : 0, src: source('alchemist', cold ? ['cold', 'aoe'] : ['aoe']),
	};
	if (hot) {
		pool.burn = pool.dmg;
		pool.burnDur = 1.5;
	}
	h.perk.residue = pool;
	room.puddles.push(pool);
	if (cold) room.fx.push(['slowz', pool.id]);
	perkRing(room, e.x, e.y, pool.r, hot ? 3 : 2);
}

function piercingHit(room, h, target, dmg) {
	if (room.time < h.perk.readyAt) return;
	h.perk.readyAt = room.time + HERO_PERKS.spearmaiden.cooldown;
	const dx = target.x - h.x, dy = target.y - h.y;
	const length = Math.hypot(dx, dy);
	const ux = length > 0 ? dx / length : h.fx, uy = length > 0 ? dy / length : h.fy;
	const back = Math.min(length, 420);
	const x1 = target.x - ux * back, y1 = target.y - uy * back;
	const x2 = target.x + ux * 150, y2 = target.y + uy * 150;
	room.fx.push(['buildbeam', Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]);
	const power = Math.max(dmg * 0.4, (10 + 0.7 * (h.level - 1)) * h.mods.dmgMul);
	const reach = back + 150;
	for (const e of room.grid.query((x1 + x2) / 2, (y1 + y2) / 2, reach / 2 + 75, [])) {
		if (e.dead) continue;
		const x = e.x - x1, y = e.y - y1;
		const along = x * ux + y * uy;
		if (along < 0 || along > reach || Math.abs(x * uy - y * ux) > 18 + e.r) continue;
		room.hurtEnemy(e, power, h, PIERCE);
	}
}

export function stormMarked(e, time) {
	if (!e.stormMarks) return false;
	for (const h of e.stormMarks) {
		if (h.st === 0 && !h.offline && h.perk.stormMark?.until > time) return true;
	}
	return false;
}

export function onWeaponHit(room, h, e, dmg, src) {
	if (e.stormMarks) dischargeMarks(room, e);
	switch (h.hero) {
		case 'herald': healOnHit(room, h); break;
		case 'witch': repeatPulse(room, h, e, dmg, src); break;
		case 'smith': hammerHit(room, h, e, dmg, src); break;
		case 'stormcaller': markWithStorm(room, h, e, dmg); break;
		case 'alchemist': leaveResidue(room, h, e, dmg, src); break;
		case 'spearmaiden': piercingHit(room, h, e, dmg); break;
	}
}
