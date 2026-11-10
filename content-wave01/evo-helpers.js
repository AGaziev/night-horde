	// --- wave 3: evolutions, new weapons, embers ---

	evoCard(h, id) {
		const E = EVOS[id];
		return {
			id, kind: 'evo', name: E.name, icon: E.icon, desc: E.desc, level: 1, from: E.from, requires: E.requires,
			fromName: WEAPONS[E.from].name, fromIcon: WEAPONS[E.from].icon, reqName: PASSIVES[E.requires].name, reqIcon: PASSIVES[E.requires].icon,
		};
	}

	// Weapon at level 5 + its artifact (any level) → evolution; null if nothing is ready or it was declined recently.
	readyEvo(h) {
		for (const [id, w] of h.weapons) {
			const evo = EVO_BY_WEAPON[id];
			if (!evo || w.lvl < MAX_LEVEL || !h.passives.has(EVOS[evo].requires)) continue;
			if (h.duoDefer[evo] > h.offerNo) continue;
			return evo;
		}
		return null;
	}

	evolve(h, card) {
		const E = EVOS[card.id];
		if (!E || !h.weapons.has(E.from)) return false;
		const next = new Map();
		for (const [id, w] of h.weapons) next.set(id === E.from ? card.id : id, id === E.from ? { lvl: 1, t: 0.3 } : w);
		h.weapons = next;
		h.evolved.add(E.from);
		this.fx.push(['evo', h.pid, card.id]);
		return true;
	}

	emberCards(h, n) {
		return Object.entries(EMBERS).slice(0, n).map(([id, E]) => ({ id, kind: 'ember', name: E.name, icon: E.icon, desc: E.desc, level: (h.embers[id] ?? 0) + 1 }));
	}

	// The toughest enemy within range: boss > elite > most hp.
	toughest(h, range) {
		let best = null, score = -1;
		for (const e of this.grid.query(h.x, h.y, range + MAX_ENEMY_R, this.q3)) {
			if (e.dead || dist2(e.x, e.y, h.x, h.y) > range * range) continue;
			const s = (e.boss ? 1e9 : 0) + (e.elite ? 1e8 : 0) + e.hp;
			if (s > score) {
				score = s;
				best = e;
			}
		}
		return best;
	}

	// Lantern: a cone of light on the densest group marks enemies (+damage from everyone).
	lanternTick(h, L, src) {
		const range = L.range * h.mods.areaMul;
		const pt = this.densestPoints(h, 1, range)[0];
		if (!pt) return false;
		const dir = Math.atan2(pt.y - h.y, pt.x - h.x);
		const half = (L.angle * Math.PI) / 360;
		for (const e of this.grid.query(h.x, h.y, range + MAX_ENEMY_R, this.q2)) {
			if (e.dead) continue;
			const dx = e.x - h.x, dy = e.y - h.y;
			if (dx * dx + dy * dy > (range + e.r) ** 2) continue;
			let da = Math.abs(Math.atan2(dy, dx) - dir);
			if (da > Math.PI) da = Math.PI * 2 - da;
			if (da > half) continue;
			if (e.markT <= this.time || L.mark > e.markMul) e.markMul = L.mark;
			e.markT = this.time + L.tick + 0.3;
			this.hurtEnemy(e, L.dmg * h.mods.dmgMul, h, src);
		}
		this.fx.push(['cone', h.pid, Math.round(dir * 100), Math.round(range), Math.round(L.angle / 2)]);
		return true;
	}

	trailTick(h, L, src) {
		if (this.time - h.movedT > MOVE_RECENT) return false;
		const z = {
			id: this.nextId++, owner: h, x: h.x, y: h.y, r: L.radius * h.mods.areaMul, life: L.dur * h.mods.durMul, dmg: L.dmg * h.mods.dmgMul,
			tick: L.tick, t: 0, src, burn: L.burn, trail: true,
		};
		this.puddles.push(z);
		this.fx.push(['zk', z.id, 1]);
		let mine = 0;
		for (const p of this.puddles) if (p.owner === h && p.trail) mine++;
		if (mine > TRAIL_MAX) this.puddles.splice(this.puddles.findIndex((p) => p.owner === h && p.trail), 1);
		return true;
	}

	// Ward / Bastion: charges refill one per cd; a full shield starts the run full.
	wardTick(h, w, L, dt) {
		h.wardMax = L.charges + h.mods.amount;
		if (!w.init) {
			w.init = true;
			h.ward = h.wardMax;
			w.t = L.cd * h.mods.cdMul;
		}
		if (h.ward >= h.wardMax) {
			w.t = L.cd * h.mods.cdMul;
			return;
		}
		w.t -= dt;
		if (w.t <= 0) {
			h.ward++;
			w.t = L.cd * h.mods.cdMul;
			this.fx.push(['ward', h.pid, h.ward]);
		}
	}

	// A charge eats the whole hit; Ward bursts when the last charge breaks, Bastion on every charge and shares one.
	wardAbsorb(h) {
		const id = h.weapons.has('bastion') ? 'bastion' : 'ward';
		const w = h.weapons.get(id);
		const L = weaponDef(id).levels[(w?.lvl ?? 1) - 1];
		h.ward--;
		h.iframes = PLAYER_IFRAMES;
		this.fx.push(['ward', h.pid, h.ward]);
		if (w && h.ward < h.wardMax) w.t = Math.min(w.t, L.cd * h.mods.cdMul);
		if (id === 'bastion' || h.ward <= 0) {
			this.explode({ x: h.x, y: h.y, r: L.burstR * h.mods.areaMul, pdmg: 0, edmg: L.burstDmg * h.mods.dmgMul, owner: h, kind: 7, src: SRC[id], kb: L.kb });
		}
		if (id === 'bastion') {
			for (const o of this.heroes.values()) {
				if (o === h || o.st !== 0 || dist2(o.x, o.y, h.x, h.y) > L.share * L.share) continue;
				o.ward = Math.min(Math.max(o.wardMax, 1), o.ward + 1);
				this.fx.push(['ward', o.pid, o.ward]);
				break;
			}
		}
	}

	crescentStrike(h, L, src) {
		const r = L.radius * h.mods.areaMul;
		this.fx.push(['crescent', h.pid, Math.round(r)]);
		let kills = 0;
		for (const e of this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2)) {
			const rr = r + e.r * 0.5;
			if (e.dead || dist2(e.x, e.y, h.x, h.y) >= rr * rr) continue;
			this.hurtEnemy(e, L.dmg * h.mods.dmgMul, h, src);
			if (e.dead) kills++;
		}
		const heal = Math.min(kills * L.heal, L.healCap * L.cd * h.mods.cdMul);
		if (heal > 0) h.hp = Math.min(h.maxHp, h.hp + heal);
		this.breakAround(h.x, h.y, r, h);
	}

	// Two rings of hammers spinning in opposite directions.
	millstoneHits(h, L) {
		const { dmgMul, areaMul } = h.mods;
		const blade = ORBIT_BLADE_R * areaMul;
		const pts = [];
		for (const [R, dir] of [[L.radius * areaMul, 1], [L.radius2 * areaMul, -1]]) {
			for (let i = 0; i < L.count; i++) {
				const a = dir * orbitAngle(this.time, L.rps, i, L.count);
				pts.push(h.x + Math.cos(a) * R, h.y + Math.sin(a) * R);
			}
		}
		const key = h.pid * 10 + 7;
		for (const e of this.grid.query(h.x, h.y, L.radius2 * areaMul + blade + MAX_ENEMY_R, this.q2)) {
			if (e.dead || (e.oh && (e.oh[key] ?? 0) > this.time)) continue;
			const rr = (blade + e.r) ** 2;
			for (let i = 0; i < pts.length; i += 2) {
				if (dist2(e.x, e.y, pts[i], pts[i + 1]) >= rr) continue;
				(e.oh ??= {})[key] = this.time + L.hitCd;
				this.hurtEnemy(e, L.dmg * dmgMul, h, SRC.millstones);
				if (!e.dead && !e.boss) this.knock(e, h.x, h.y, L.kb);
				break;
			}
		}
	}

	// Four sickles circling on a wide ellipse around the hero.
	moonbladeHits(h, L) {
		const { dmgMul, areaMul } = h.mods;
		const key = h.pid * 10 + 8;
		for (let i = 0; i < L.count; i++) {
			const a = orbitAngle(this.time, L.rps, i, L.count);
			const x = h.x + Math.cos(a) * L.rx * areaMul, y = h.y + Math.sin(a) * L.ry * areaMul;
			if (this.tickNo % 3 === 0) this.breakAround(x, y, L.r, h);
			for (const e of this.grid.query(x, y, L.r + MAX_ENEMY_R, this.q2)) {
				if (e.dead || (e.oh && (e.oh[key] ?? 0) > this.time)) continue;
				if (dist2(e.x, e.y, x, y) >= (L.r + e.r) ** 2) continue;
				(e.oh ??= {})[key] = this.time + L.hitCd;
				this.hurtEnemy(e, L.dmg * dmgMul, h, SRC.moonblade);
			}
		}
	}

	tocsinWave(h, L) {
		const r = L.radius * h.mods.areaMul;
		this.fx.push(['bell', h.pid, Math.round(r)]);
		for (const e of this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2)) {
			if (!e.dead && !e.boss && dist2(e.x, e.y, h.x, h.y) < (r + e.r) ** 2) this.knock(e, h.x, h.y, L.kb);
		}
	}

	// Fireworks: after the blast, sparks fly out in a ring.
	fireworkSparks(h, b, L) {
		for (let i = 0; i < L.sparks; i++) {
			const a = (i / L.sparks) * Math.PI * 2;
			this.addProjectile(h, 'bolt', a, 420, b.edmg * L.sparkFrac, 1, 0.5, null, 0, { x: b.x, y: b.y, src: SRC.fireworks });
		}
	}

