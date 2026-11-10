	after(delay, fn) {
		this.timers.push({ t: this.time + delay, fn });
	}

	updateTimers() {
		if (!this.timers.length) return;
		const now = this.time + 1e-9;
		const due = this.timers.filter((x) => x.t <= now);
		if (!due.length) return;
		this.timers = this.timers.filter((x) => x.t > now);
		for (const x of due) x.fn();
	}

	knock(e, fromX, fromY, dist) {
		const dx = e.x - fromX, dy = e.y - fromY;
		const d = Math.hypot(dx, dy) || 1;
		e.x += (dx / d) * dist;
		e.y += (dy / d) * dist;
	}

	// Lightning from the sky into `t` (or the nearest enemy if it already died), then a chain.
	strikeAt(h, t, dmg, chain, src) {
		if (t.dead) t = this.nearestFrom(t, [], 80);
		if (!t) return;
		this.fx.push(['zap', Math.round(t.x), Math.round(t.y - 320), Math.round(t.x), Math.round(t.y)]);
		const hit = [t];
		this.hurtEnemy(t, dmg, h, src);
		for (let c = 0; c < chain; c++) {
			const next = this.nearestFrom(t, hit, CHAIN_RANGE);
			if (!next) break;
			this.fx.push(['zap', Math.round(t.x), Math.round(t.y), Math.round(next.x), Math.round(next.y)]);
			hit.push(next);
			this.hurtEnemy(next, dmg, h, src);
			t = next;
		}
	}

	// Every 3rd Thunder Slash: a fan of bolts from the hero into enemies spread around the swing.
	thunderFan(h, L, range, src) {
		const R = range * 1.3;
		this.fx.push(['tfan', h.pid, Math.round(R)]);
		const cand = this.grid.query(h.x, h.y, R + MAX_ENEMY_R, this.q2).filter((e) => !e.dead && dist2(e.x, e.y, h.x, h.y) < R * R);
		const ang = (e) => Math.atan2(e.y - h.y, e.x - h.x);
		cand.sort((a, b) => ang(a) - ang(b));
		const dmg = L.fanDmg * h.mods.dmgMul;
		for (let i = 0; i < L.fan; i++) {
			const e = cand.length ? cand[Math.floor(((i + 0.5) / L.fan) * cand.length)] : null;
			const a = (i / L.fan) * Math.PI * 2;
			const x = e ? e.x : h.x + Math.cos(a) * range, y = e ? e.y : h.y + Math.sin(a) * range;
			this.fx.push(['zap', Math.round(h.x), Math.round(h.y), Math.round(x), Math.round(y)]);
			if (e && !e.dead) this.hurtEnemy(e, dmg, h, src);
		}
	}

	slashHits(h, dir, range, width, dmg, src, hit) {
		const cx = h.x + (dir * range) / 2;
		const near = this.grid.query(cx, h.y, range / 2 + width / 2 + MAX_ENEMY_R, this.q2);
		const x0 = dir > 0 ? h.x : h.x - range, x1 = dir > 0 ? h.x + range : h.x;
		for (const e of near) {
			if (e.dead || e.x + e.r < x0 || e.x - e.r > x1 || Math.abs(e.y - h.y) > width / 2 + e.r) continue;
			this.hurtEnemy(e, dmg, h, src);
			if (!e.dead) hit.push(e);
		}
	}

	// Lob bombs into the densest groups; `blast(x, y)` builds the explosion. Returns false if there was no target.
	throwBombs(h, count, fuse, lobKind, blast) {
		const pts = this.densestPoints(h, count, BOMB_RANGE);
		if (!pts.length) return false;
		for (const p of pts) {
			this.fx.push(['lob', this.nextId++, Math.round(h.x), Math.round(h.y), Math.round(p.x), Math.round(p.y), round3(fuse), round3(this.time), lobKind]);
			this.blasts.push({ ...blast(p.x, p.y), t: this.time + fuse });
		}
		return true;
	}

	firePool(h, b, L) {
		const z = {
			id: this.nextId++, owner: h, x: b.x, y: b.y, r: b.r * 0.9, life: L.pool * h.mods.durMul, dmg: L.poolDmg * h.mods.dmgMul,
			tick: L.tick, t: 0, slow: h.trait.puddleSlow, src: SRC.molotov,
		};
		this.puddles.push(z);
		this.fx.push(['zk', z.id, 1]);
	}

	// Freeze everyone in the blast; 0.5 s later the frozen ones shatter into shards around them.
	iceBurst(h, b, L) {
		const frozen = [];
		const dur = L.freeze * h.mods.ctrlMul * h.mods.durMul;
		for (const e of this.grid.query(b.x, b.y, b.r + MAX_ENEMY_R, this.q3)) {
			const rr = b.r + e.r * 0.5;
			if (e.dead || e.boss || dist2(e.x, e.y, b.x, b.y) >= rr * rr) continue;
			e.frozenT = Math.max(e.frozenT, this.time + dur);
			if (frozen.length < 8) frozen.push(e);
		}
		const shard = b.edmg * L.shardFrac;
		if (frozen.length) this.after(0.5, () => {
			for (const f of frozen) {
				this.fx.push(['shard', Math.round(f.x), Math.round(f.y)]);
				for (const e of this.grid.query(f.x, f.y, L.shardR + MAX_ENEMY_R, this.q3)) {
					const rr = L.shardR + e.r * 0.5;
					if (!e.dead && dist2(e.x, e.y, f.x, f.y) < rr * rr) this.hurtEnemy(e, shard, h, SRC.icebomb);
				}
			}
		});
	}

	auroraPulse(h, L) {
		const R = L.radius * h.mods.areaMul * 2;
		const dur = L.freeze * h.mods.ctrlMul * h.mods.durMul;
		for (const e of this.grid.query(h.x, h.y, R + MAX_ENEMY_R, this.q2)) {
			const rr = R + e.r * 0.5;
			if (!e.dead && !e.boss && dist2(e.x, e.y, h.x, h.y) < rr * rr) e.frozenT = Math.max(e.frozenT, this.time + dur);
		}
		this.fx.push(['frost', h.pid, Math.round(R)]);
	}

	// Traps (kind 0), mines (1) and knife spikes (3): behind a moving hero, in a ring around a standing one, or at o.x/o.y.
	layTrap(h, o) {
		let x, y;
		if (o.x !== undefined) {
			x = o.x;
			y = o.y;
		} else if (this.time - h.movedT < MOVE_RECENT) {
			x = h.x - h.mvx * TRAP_BEHIND + (Math.random() - 0.5) * 16;
			y = h.y - h.mvy * TRAP_BEHIND + (Math.random() - 0.5) * 16;
		} else {
			const a = h.trapRing++ * 2.4;
			x = h.x + Math.cos(a) * 48;
			y = h.y + Math.sin(a) * 48;
		}
		const kind = o.kind ?? 0;
		this.traps.push({
			id: this.nextId++, owner: h, x, y, kind, r: o.r, dmg: o.dmg, root: o.root ?? 0, splash: o.splash ?? 0, src: o.src,
			blastR: o.blastR ?? 0, kb: o.kb ?? 0, recharge: o.recharge ?? 0, life: o.life ?? Infinity, armT: this.time + TRAP_ARM,
		});
		if (o.max) {
			let mine = 0;
			for (const t of this.traps) if (t.owner === h && t.kind === kind) mine++;
			if (mine > o.max) this.traps.splice(this.traps.findIndex((t) => t.owner === h && t.kind === kind), 1);
		}
	}

	orreryTick(h, w, L, dt) {
		const { dmgMul, areaMul, amount, cdMul } = h.mods;
		const count = L.count + amount;
		w.ready ??= [];
		while (w.ready.length < count) w.ready.push(0);
		w.t -= dt;
		if (w.t > 0) return;
		const target = this.nearestEnemies(h.x, h.y, 1, L.trigger * areaMul)[0];
		if (!target) return;
		const R = L.radius * areaMul;
		let best = -1, bd = Infinity, bx = 0, by = 0;
		for (let i = 0; i < count; i++) {
			if (w.ready[i] > this.time) continue;
			const a = orbitAngle(this.time, L.rps, i, count);
			const x = h.x + Math.cos(a) * R, y = h.y + Math.sin(a) * R;
			const d = dist2(x, y, target.x, target.y);
			if (d < bd) {
				bd = d;
				best = i;
				bx = x;
				by = y;
			}
		}
		if (best < 0) return;
		w.ready[best] = this.time + L.respawn * cdMul;
		this.addProjectile(h, 'bolt', Math.atan2(target.y - by, target.x - bx), L.speed, L.dmg * dmgMul, L.pierce, 2, target, 0, { x: bx, y: by, src: SRC.orrery });
		w.t = 0.12;
	}

	// Sparks still on the orbit as a bit mask for the snapshot (the client draws only those).
	orreryMask(h, w) {
		if (!w.ready) return 0x3fffffff;
		let m = 0;
		for (let i = 0; i < w.ready.length && i < 30; i++) if (w.ready[i] <= this.time) m |= 1 << i;
		return m;
	}

	windmillHits(h, L, dmgMul, areaMul, amount) {
		const count = L.count + amount;
		const len = L.len * areaMul, half = (L.width * areaMul) / 2;
		const cs = [], sn = [];
		for (let i = 0; i < count; i++) {
			const a = orbitAngle(this.time, L.rps, i, count);
			cs.push(Math.cos(a));
			sn.push(Math.sin(a));
		}
		if (this.tickNo % 3 === 0) for (let i = 0; i < count; i++) this.breakAround(h.x + cs[i] * len * 0.75, h.y + sn[i] * len * 0.75, len * 0.25, h);
		const key = -h.pid;
		for (const e of this.grid.query(h.x, h.y, len + MAX_ENEMY_R, this.q2)) {
			if (e.dead || (e.oh && (e.oh[key] ?? 0) > this.time)) continue;
			const dx = e.x - h.x, dy = e.y - h.y;
			for (let i = 0; i < count; i++) {
				const along = dx * cs[i] + dy * sn[i];
				if (along < 0 || along > len + e.r) continue;
				if (Math.abs(-dx * sn[i] + dy * cs[i]) >= half + e.r) continue;
				(e.oh ??= {})[key] = this.time + L.hitCd;
				this.hurtEnemy(e, L.dmg * dmgMul, h, SRC.windmill);
				if (!e.dead && !e.boss) this.knock(e, h.x, h.y, L.kb);
				break;
			}
		}
	}

	tripwireTick(h, w, L, dt) {
		const { dmgMul, cdMul, areaMul, amount, durMul, ctrlMul } = h.mods;
		const src = SRC.tripwire;
		w.t -= dt;
		if (w.t <= 0) {
			const count = L.count + amount;
			const target = this.nearestEnemies(h.x, h.y, 1, KNIFE_AIM_RANGE)[0];
			const base = target ? Math.atan2(target.y - h.y, target.x - h.x) : Math.atan2(h.fy, h.fx);
			for (let i = 0; i < count; i++) {
				this.addProjectile(h, 'knife', base + (i - (count - 1) / 2) * L.spread, L.speed, L.dmg * dmgMul, L.pierce, 1.1, null, 0, {
					src, spike: { dmg: L.spikeDmg * dmgMul, life: L.spikeLife * durMul, root: L.spikeRoot * ctrlMul },
				});
			}
			w.t = L.cd * cdMul;
		}
		w.tt = (w.tt ?? 0) - dt;
		if (w.tt <= 0) {
			this.layTrap(h, { r: L.radius * areaMul, dmg: L.trapDmg * dmgMul, root: L.root * ctrlMul, max: L.max, src });
			w.tt = L.trapCd * cdMul;
		}
		w.wt = (w.wt ?? 0) - dt;
		if (w.wt <= 0) {
			w.wt = L.wireTick;
			this.wireHits(h, L.link, L.wireDmg * dmgMul, src);
		}
	}

	// Threads between the owner's traps no farther than `link` apart cut everything on the line.
	wireHits(h, link, dmg, src) {
		const mine = this.traps.filter((t) => t.owner === h && t.kind === 0);
		for (let i = 0; i < mine.length; i++) {
			for (let j = i + 1; j < mine.length; j++) {
				const a = mine[i], b = mine[j];
				const lx = b.x - a.x, ly = b.y - a.y, l2 = lx * lx + ly * ly;
				if (l2 > link * link || l2 < 1) continue;
				const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
				for (const e of this.grid.query(mx, my, Math.sqrt(l2) / 2 + MAX_ENEMY_R, this.q3)) {
					if (e.dead) continue;
					const k = clamp(((e.x - a.x) * lx + (e.y - a.y) * ly) / l2, 0, 1);
					const px = a.x + lx * k, py = a.y + ly * k;
					if (dist2(e.x, e.y, px, py) < (e.r + 6) * (e.r + 6)) this.hurtEnemy(e, dmg, h, src);
				}
			}
		}
	}

	updateOrbs(dt) {
		if (!this.orbs.length) return;
		let j = 0;
		for (const o of this.orbs) {
			const dx = o.tx - o.x, dy = o.ty - o.y;
			const d = Math.hypot(dx, dy);
			if (d > 0.01) {
				const step = Math.min(d, o.speed * dt);
				o.x += (dx / d) * step;
				o.y += (dy / d) * step;
			}
			o.t -= dt;
			if (o.t <= 0) {
				o.t = o.tick;
				let zaps = 0;
				for (const e of this.grid.query(o.x, o.y, o.r + MAX_ENEMY_R, this.q1)) {
					const rr = o.r + e.r * 0.5;
					if (e.dead || dist2(e.x, e.y, o.x, o.y) >= rr * rr) continue;
					if (zaps++ < 3) this.fx.push(['zap', Math.round(o.x), Math.round(o.y), Math.round(e.x), Math.round(e.y)]);
					this.hurtEnemy(e, o.dmg, o.owner, o.src);
				}
			}
			o.life -= dt;
			if (o.life <= 0) {
				this.explode({ x: o.x, y: o.y, r: o.boomR, pdmg: 0, edmg: o.boom, owner: o.owner, kind: 3, src: o.src });
				continue;
			}
			this.orbs[j++] = o;
		}
		this.orbs.length = j;
	}

