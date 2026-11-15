import { PLAYER_RADIUS } from '../public/shared/content.js';
import { HORDE_COMBAT, HORDE_WEAPONS, HORDE_UPGRADE, hordeSynergies } from '../public/shared/horde-content.js';

const FAMILY_RADIUS = 220;
const HEAL_RADIUS = 240;
const POISON_SECONDS = 3;
const POISON_TICK = 1;
const CHILL_SECONDS = 2.5;
const CHAIN_RADIUS = 160;
const q = (n) => Math.round(n * 1000) / 1000;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const manual = (e) => !e.dead && !e.boss && e.hordeSource === 'manual' && !!e.hordeBuild;
const artifact = (build, id) => build.artifacts[id] ?? 0;
const segmentDistance = (h, x, y, x2, y2) => {
	const dx = x2 - x, dy = y2 - y, length = dx * dx + dy * dy;
	const t = length ? Math.max(0, Math.min(1, ((h.x - x) * dx + (h.y - y) * dy) / length)) : 0;
	return Math.hypot(h.x - x - t * dx, h.y - y - t * dy);
};

// All clocks and secondary budgets belong to the army, never to an individual carrier.
export class HordeCombat {
	constructor(mode) {
		this.mode = mode;
		this.room = mode.room;
		this.cooldowns = new Map();
		this.conductorAt = 0;
		this.healAt = 4;
		this.statusAt = 0;
		this.procTick = -1;
		this.procs = 0;
		this.shots = [];
		this.events = [];
		this.status = new Map();
		this.fxTick = -1;
		this.fxCount = 0;
	}

	spendProc() {
		if (this.procTick !== this.room.tickNo) { this.procTick = this.room.tickNo; this.procs = 0; }
		if (this.procs >= HORDE_COMBAT.maxProcsPerTick) return false;
		this.procs++;
		return true;
	}

	units() { return this.room.enemies.filter(manual); }
	alive() { return [...this.room.heroes.values()].filter((h) => h.st === 0); }

	families(e, units = this.units()) {
		return new Set(units.filter((o) => o !== e && o.hordePack !== e.hordePack && distance(e, o) <= FAMILY_RADIUS).map((o) => o.hordePack));
	}

	unitSpeedMul(e) {
		if (!manual(e)) return 1;
		const level = artifact(e.hordeBuild, 'march');
		return level && this.families(e).size ? 1 + 0.06 * level : 1;
	}

	barrier(e, damage) {
		if (!manual(e) || !(e.hordeBarrier > 0)) return damage;
		const absorbed = Math.min(damage, e.hordeBarrier);
		e.hordeBarrier -= absorbed;
		this.fx('barrier', e.x, e.y, e.r + 8, 0.25);
		return damage - absorbed;
	}

	fx(kind, x, y, r = 0, duration = 0.4, end = null) {
		if (this.fxTick !== this.room.tickNo) { this.fxTick = this.room.tickNo; this.fxCount = 0; }
		if (this.fxCount++ >= 32) return;
		this.room.broadcast({ t: 'horde-fx', kind, x: q(x), y: q(y), r: q(r), duration,
			...(end ? { x2: q(end.x), y2: q(end.y) } : {}) });
	}

	schedule(point, r, fn, carrier = null) {
		const warning = { x: point.x, y: point.y, r };
		this.room.fx.push(['warn', Math.round(point.x), Math.round(point.y), Math.round(r), HORDE_COMBAT.warning]);
		this.events.push({ at: this.room.time + HORDE_COMBAT.warning, warning, carrier, fn });
	}

	resyncState() {
		const warnings = this.events.filter((e) => e.at > this.room.time && !e.carrier?.dead)
			.map((e) => ({ ...e.warning, remaining: e.at - this.room.time }));
		const shots = this.shots.filter((s) => s.life > 0).map((s) => ({
			id: s.id, x: s.x, y: s.y, vx: s.vx, vy: s.vy, remaining: s.life, r: s.r,
		}));
		return { warnings, shots };
	}

	attack(e, id) {
		const build = e.hordeBuild, level = build.weapons[id], def = HORDE_WEAPONS[id];
		const synergies = new Set(hordeSynergies(build).map((s) => s.id));
		let damage = def.damage * (1 + HORDE_UPGRADE.weaponDamagePerLevel * (level - 1));
		damage *= 1 + 0.05 * artifact(build, 'conductor');
		damage *= 1 + 0.06 * artifact(build, 'tether') * Math.min(3, this.families(e).size);
		if (e.hp < e.maxHp * 0.5) damage *= 1 + 0.15 * artifact(build, 'idol');
		return { id, build, level, damage, synergies,
			range: (def.range + (id === 'reaper' && synergies.has('pursuit') ? 60 : 0)) * (1 + 0.12 * artifact(build, 'lens')),
			area: 1 + 0.15 * artifact(build, 'powder'), speed: 1 + 0.08 * artifact(build, 'lens'),
			duration: 1 + 0.20 * artifact(build, 'hourglass'),
			poisonDuration: 1 + 0.20 * artifact(build, 'hourglass') + 0.10 * artifact(build, 'censer'),
			origin: { x: e.x, y: e.y } };
	}

	pruneStatus(h) {
		const state = this.status.get(h.pid);
		if (!state) return null;
		if (h.st !== 0) { this.status.delete(h.pid); return null; }
		state.poison = state.poison.filter((p) => p.until > this.room.time);
		if (state.chillUntil <= this.room.time) { state.chillUntil = 0; state.slow = 0; }
		if (!state.poison.length && !state.chillUntil) { this.status.delete(h.pid); return null; }
		return state;
	}

	stateFor(h) {
		let state = this.pruneStatus(h);
		if (!state) { state = { poison: [], chillUntil: 0, slow: 0 }; this.status.set(h.pid, state); }
		return state;
	}

	clearHero(h) { this.status.delete(h.pid); }
	heroSpeedMul(h) { return 1 - (this.pruneStatus(h)?.slow ?? 0); }
	debuffed(h) { const s = this.pruneStatus(h); return !!s && (s.poison.length > 0 || s.chillUntil > this.room.time); }

	hurt(h, damage, from) {
		if (h.st !== 0 || h.iframes > 0) return false;
		const hp = h.hp;
		this.room.hurtPlayer(h, damage, from);
		return h.hp < hp;
	}

	hit(h, attack, factor = 1) {
		let damage = attack.damage * factor;
		if (this.debuffed(h)) damage *= 1 + 0.15 * artifact(attack.build, 'hunter');
		if (attack.id === 'reaper' && this.debuffed(h)) damage *= 1.25;
		return this.hurt(h, damage, 'horde:' + attack.id);
	}

	poison(h, attack, dose = 1) {
		if (h.st !== 0) return;
		const state = this.stateFor(h);
		const poison = { until: this.room.time + POISON_SECONDS * attack.poisonDuration,
			next: this.room.time + POISON_TICK, damage: attack.damage * dose, fever: attack.synergies.has('fever'), hunter: artifact(attack.build, 'hunter') };
		if (state.poison.length < HORDE_COMBAT.poisonStacks) state.poison.push(poison);
		else {
			// Refresh the weakest stack rather than multiplying or extending every existing dose.
			const weakest = state.poison.reduce((best, p, i, list) => p.damage < list[best].damage ? i : best, 0);
			if (poison.damage >= state.poison[weakest].damage) state.poison[weakest] = poison;
			else state.poison[weakest].until = Math.max(state.poison[weakest].until, poison.until);
		}
	}

	chill(h, attack) {
		if (h.st !== 0) return;
		const state = this.stateFor(h);
		state.chillUntil = Math.max(state.chillUntil, this.room.time + CHILL_SECONDS * attack.duration);
		state.slow = Math.min(HORDE_COMBAT.slowCap, Math.max(state.slow, 0.18));
	}

	statusMsg() {
		const effects = [];
		for (const h of this.room.heroes.values()) {
			const s = this.pruneStatus(h);
			if (!s) continue;
			effects.push({ pid: h.pid, poisonUntil: Math.max(0, ...s.poison.map((p) => p.until)), chillUntil: s.chillUntil, slow: s.slow });
		}
		return { t: 'horde-status', time: this.room.time, effects };
	}

	sendStatus(pid = null) {
		const msg = this.statusMsg();
		if (pid === null) { this.room.broadcast(msg); this.statusAt = this.room.time + 0.5; }
		else this.room.send(pid, msg);
	}

	tickPoison() {
		for (const h of this.room.heroes.values()) {
			if (h.st !== 0) { this.clearHero(h); continue; }
			const state = this.status.get(h.pid);
			if (!state) continue;
			let damage = 0;
			for (const p of state.poison) if (p.next <= this.room.time && p.next <= p.until) {
				p.next += POISON_TICK;
				damage += p.damage * (1 + 0.15 * p.hunter) * (p.fever && state.chillUntil > this.room.time ? 1.35 : 1);
			}
			// One combined hit respects the ordinary armor, ward and iframe window for all three stacks.
			if (damage > 0) this.hurt(h, damage, 'horde:poison');
			this.pruneStatus(h);
		}
	}

	projectile(e, target, attack, angleOffset = 0, factor = 1) {
		if (this.shots.length >= HORDE_COMBAT.maxHostile) return false;
		const angle = Math.atan2(target.y - e.y, target.x - e.x) + angleOffset;
		const speed = (attack.id === 'arbalest' ? 300 : 230) * attack.speed;
		const shot = { id: this.room.nextId++, x: e.x, y: e.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
			life: Math.min(4, attack.range / speed + 0.25), r: 7, attack, factor };
		this.shots.push(shot);
		this.room.fx.push(['eshot', shot.id, Math.round(shot.x), Math.round(shot.y), Math.round(shot.vx), Math.round(shot.vy), q(shot.life), q(this.room.time)]);
		return true;
	}

	projectileHit(h, shot) {
		const attack = shot.attack;
		if (!this.hit(h, attack, shot.factor)) return;
		this.fx(attack.id, h.x, h.y, 22, 0.35);
		if (attack.id === 'venom') {
			this.poison(h, attack);
			this.censer(h, attack);
		} else if (attack.id === 'frost') this.chill(h, attack);
		this.conductor(h, attack, shot.factor);
	}

	tickProjectiles(dt) {
		const kept = [];
		for (const shot of this.shots) {
			const x = shot.x, y = shot.y;
			shot.life -= dt; shot.x += shot.vx * dt; shot.y += shot.vy * dt;
			let done = shot.life <= 0 || !this.mode.inside(shot.x, shot.y);
			if (!done) for (const h of this.alive()) {
				if (segmentDistance(h, x, y, shot.x, shot.y) > PLAYER_RADIUS + shot.r) continue;
				this.projectileHit(h, shot); done = true; break;
			}
			if (done) this.room.fx.push(['epend', shot.id, q(this.room.time)]);
			else kept.push(shot);
		}
		this.shots = kept;
	}

	censer(primary, attack) {
		const level = artifact(attack.build, 'censer');
		if (!level) return;
		const target = this.alive().find((h) => h !== primary && distance(h, primary) <= (CHAIN_RADIUS + 20 * (level - 1)) * attack.area);
		if (!target || !this.spendProc()) return;
		const point = { x: target.x, y: target.y }, origin = { x: primary.x, y: primary.y };
		this.schedule(point, 42, () => {
			if (distance(target, point) > 42 + PLAYER_RADIUS || !this.hit(target, attack, 0.25)) return;
			this.poison(target, attack, 0.5); // Direct dose only: never calls censer or conductor again.
			this.fx('venom', origin.x, origin.y, 42, 0.45, point);
		});
	}

	conductor(primary, attack, factor) {
		const level = artifact(attack.build, 'conductor');
		if (!level || this.room.time < this.conductorAt || Math.random() >= 0.1 + level * 0.15) return;
		const target = this.alive().find((h) => h !== primary && distance(h, primary) <= CHAIN_RADIUS * attack.area);
		if (!target || !this.spendProc()) return;
		this.conductorAt = this.room.time + 3;
		const point = { x: target.x, y: target.y }, origin = { x: primary.x, y: primary.y };
		this.schedule(point, 42, () => {
			if (distance(target, point) > 42 + PLAYER_RADIUS) return;
			// A plain secondary hit has no projectile-hit callback, poison or further secondary.
			this.hit(target, { ...attack, id: 'conductor' }, factor * 0.5);
			this.fx('conductor', origin.x, origin.y, 42, 0.45, point);
		});
	}

	storm(target, attack) {
		const seen = new Set(), limit = attack.synergies.has('conduit') ? 3 : 2;
		const firstRadius = attack.synergies.has('conduit') && this.alive().length === 1 ? 60 : 48;
		const hop = (h, origin) => {
			const radius = (seen.size === 0 ? firstRadius : 48) * attack.area;
			seen.add(h.pid);
			const point = { x: h.x, y: h.y };
			this.schedule(point, radius, () => {
				this.fx('storm', origin.x, origin.y, radius, 0.45, point);
				if (distance(h, point) > radius + PLAYER_RADIUS || !this.hit(h, attack)) return;
				if (seen.size >= limit) return;
				const next = this.alive().find((o) => !seen.has(o.pid) && distance(o, h) <= CHAIN_RADIUS * attack.area);
				if (next && this.spendProc()) hop(next, { x: h.x, y: h.y });
			});
		};
		hop(target, attack.origin);
	}

	area(attack, center, radius, factor = 1, carrier = null) {
		this.schedule(center, radius, () => {
			if (carrier?.dead) return; // A slain reaper carrier cannot finish its windup.
			this.fx(attack.id, center.x, center.y, radius, 0.55);
			for (const h of this.alive()) if (distance(h, center) <= radius + PLAYER_RADIUS) this.hit(h, attack, factor);
			if (attack.id === 'ember' && factor === 1 && attack.synergies.has('cremation') && this.spendProc()) {
				this.area(attack, center, radius, 0.45);
			}
		}, carrier);
	}

	onKilled(e, h, src) {
		// Called exactly once by killEnemy; retirement and administration never enter this hook.
		if (e.boss || e.hordeSource !== 'manual' || !e.hordeBuild?.weapons.ember || (!h && src?.weapon === 'other')) return;
		if ((this.cooldowns.get('ember') ?? 0) > this.room.time) return;
		const attack = this.attack(e, 'ember'), radius = attack.range * attack.area;
		if (!this.alive().some((hero) => distance(hero, e) <= radius + PLAYER_RADIUS) || !this.spendProc()) return;
		this.cooldowns.set('ember', this.room.time + HORDE_WEAPONS.ember.cooldown);
		this.area(attack, { x: e.x, y: e.y }, radius);
	}

	heal(units) {
		if (this.room.time < this.healAt) return;
		this.healAt = this.room.time + 4;
		const cultists = units.filter((e) => e.hordePack === 'cultists' && e.frozenT <= this.room.time);
		for (const e of units) {
			let pct = 0;
			for (const c of cultists) if (distance(c, e) <= HEAL_RADIUS) pct = Math.max(pct, 0.03 + 0.01 * (c.hordeLevel - 1));
			if (!pct || e.hp >= e.maxHp) continue;
			e.hp = Math.min(e.maxHp, e.hp + e.maxHp * pct);
			this.fx('heal', e.x, e.y, e.r + 5, 0.45);
		}
	}

	cast(id, units) {
		if ((this.cooldowns.get(id) ?? 0) > this.room.time) return;
		let caster = null, target = null, chosen = null, nearest = Infinity;
		for (const e of units) {
			if (!e.hordeBuild.weapons[id] || e.frozenT > this.room.time) continue;
			const attack = this.attack(e, id);
			for (const h of this.alive()) {
				const d = distance(e, h);
				if (d > attack.range || d >= nearest) continue;
				caster = e; target = h; chosen = attack; nearest = d;
			}
		}
		if (!caster) return;
		const projectile = ['venom', 'frost', 'arbalest'].includes(id);
		const arrows = id === 'arbalest' ? (chosen.synergies.has('volley') ? 3 : 2) : 1;
		if (projectile && this.shots.length + arrows > HORDE_COMBAT.maxHostile) return;
		if (!this.spendProc()) return;
		let cooldown = HORDE_WEAPONS[id].cooldown;
		if (id === 'reaper' && chosen.synergies.has('pursuit')) cooldown *= 0.8;
		this.cooldowns.set(id, this.room.time + cooldown);
		if (id === 'storm') this.storm(target, chosen);
		else if (id === 'reaper') this.area(chosen, { x: caster.x, y: caster.y }, chosen.range * chosen.area, 1, caster);
		else for (let i = 0; i < arrows; i++) {
			this.projectile(caster, target, chosen, (i - (arrows - 1) / 2) * 0.14, chosen.synergies.has('volley') && id === 'arbalest' ? 0.8 : 1);
		}
	}

	tick(dt) {
		this.tickPoison();
		const due = this.events.filter((e) => e.at <= this.room.time);
		this.events = this.events.filter((e) => e.at > this.room.time);
		for (const e of due) e.fn();
		this.tickProjectiles(dt);
		const units = this.units();
		this.heal(units);
		// Rotate priority so a three-proc cap cannot permanently starve the fourth weapon.
		const ids = Object.keys(HORDE_WEAPONS).filter((id) => id !== 'ember');
		const offset = this.room.tickNo % ids.length;
		for (let i = 0; i < ids.length; i++) this.cast(ids[(i + offset) % ids.length], units);
		if (this.room.time >= this.statusAt) this.sendStatus();
	}
}
