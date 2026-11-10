	// --- simulation ---

	tick(dt) {
		if (this.state !== 'play') return;
		this.time += dt;
		this.tickNo++;
		const alive = [];
		for (const h of this.heroes.values()) if (h.st === 0) alive.push(h);

		if (alive.length) {
			this.spawn(dt, alive);
			this.moveEnemies(dt, alive);
		}
		this.rebuildGrid();
		this.updatePlayers(dt, alive);
		this.auraHeals(dt, alive);
		this.updateProjectiles(dt);
		this.updateHostile(dt);
		this.updateBlasts();
		this.updateTraps();
		this.updatePuddles(dt);
		this.compactEnemies();
		this.updateGems(dt, alive);
		this.updateItems(dt, alive);
		this.updateRevive(dt);
		if (alive.length) {
			if (this.time >= this.nextEliteT) {
				this.nextEliteT = this.time + ELITE_EVERY;
				this.makeElite(alive);
			}
			if (this.time >= this.nextGemSweep) {
				this.nextGemSweep = this.time + GEM_SWEEP_EVERY;
				this.sweepFarGems(alive);
			}
		}

		if (this.checkAllDown()) return;
		if (this.time >= RUN_SECONDS) {
			this.finish(true);
			return;
		}
		if (this.tickNo % SNAPSHOT_EVERY === 0) this.snapshot();
	}

	randomRingPos(alive) {
		const p = alive[Math.floor(Math.random() * alive.length)];
		const a = Math.random() * Math.PI * 2;
		const d = SPAWN_DISTANCE.min + Math.random() * (SPAWN_DISTANCE.max - SPAWN_DISTANCE.min);
		return [p.x + Math.cos(a) * d, p.y + Math.sin(a) * d];
	}

	spawnEnemy(type, alive, hpMul) {
		const E = ENEMIES[type];
		const [x, y] = this.randomRingPos(alive);
		const hp = E.hp * hpMul;
		const e = {
			id: this.nextId++, type: TYPE_INDEX[type], def: E, x, y, hp, maxHp: hp,
			speed: E.speed * (0.9 + Math.random() * 0.2), dmg: E.dmg, r: E.r, xp: E.xp,
			dead: false, zig: type === 'wisp', phase: Math.random() * Math.PI * 2, oh: null,
			boss: type === 'boss', ai: E.ai ?? null,
			slow: 0, slowT: 0, frozenT: 0, rootT: 0, wetT: 0, markT: 0, markMul: 0,
			burnT: 0, burnDps: 0, burnOwner: null, burnAcc: 0,
			elite: null, windT: 0, fuseT: 0, shotT: E.shotCd ? E.shotCd * (0.5 + Math.random() * 0.5) : 0,
			fuseBy: null, exploded: false, auxT: 0,
		};
		this.enemies.push(e);
		return e;
	}

	spawn(dt, alive) {
		const n = this.heroes.size;
		while (this.bossIdx < BOSS_TIMES.length && this.time >= BOSS_TIMES[this.bossIdx]) {
			this.bossIdx++;
			const b = this.spawnEnemy('boss', alive, n);
			this.bosses.push(b);
			this.fx.push(['boss', ENEMIES.boss.name]);
		}
		let wave = WAVES[0];
		for (const w of WAVES) if (w.at <= this.time) wave = w;
		this.spawnAcc += wave.rate * spawnRateScale(n) * dt;
		if (this.spawnAcc < 1) return;
		const types = Object.entries(wave.types);
		const total = types.reduce((s, [, w]) => s + w, 0);
		const hpMul = enemyHpScale(this.time, n);
		while (this.spawnAcc >= 1) {
			this.spawnAcc -= 1;
			if (this.enemies.length >= MAX_ENEMIES) {
				this.spawnAcc = 0;
				break;
			}
			let r = Math.random() * total;
			let type = types[0][0];
			for (const [t, w] of types) {
				if ((r -= w) <= 0) {
					type = t;
					break;
				}
			}
			this.spawnEnemy(type, alive, hpMul);
		}
	}

	rebuildGrid() {
		this.grid.clear();
		for (const e of this.enemies) if (!e.dead) this.grid.insert(e);
	}

	moveEnemies(dt, alive) {
		this.rebuildGrid();
		const near = this.q1;
		const taunters = alive.filter((p) => p.trait.taunt > 0);
		const now = this.time;
		for (const e of this.enemies) {
			if (e.dead) continue;
			if (e.burnT > now) this.burnTick(e, dt);
			if (e.dead) continue;
			let best = null, bd = Infinity;
			for (const p of alive) {
				const d = dist2(e.x, e.y, p.x, p.y);
				if (d < bd) {
					bd = d;
					best = p;
				}
			}
			if (bd > FAR_DIST2) {
				[e.x, e.y] = this.randomRingPos(alive);
				e.windT = 0;
				continue;
			}
			if (taunters.length) [best, bd] = this.tauntTarget(e, taunters, best, bd);
			if (e.elite) this.eliteTick(e, best, dt);
			if (e.frozenT > now || e.rootT > now) continue;
			let dx = best.x - e.x, dy = best.y - e.y;
			const d = Math.sqrt(bd) || 1;
			dx /= d;
			dy /= d;
			// Stop at contact distance so enemies don't stack on the player.
			let speed = e.slowT > now ? e.speed * (1 - e.slow) : e.speed;
			let maxStep = Math.max(0, d - e.r - PLAYER_RADIUS + 2);
			if (e.ai === 'ranged') {
				if (this.rangedTick(e, best, d, dt)) continue;
				const [kmin, kmax] = e.def.keep;
				if (d < kmin) {
					dx = -dx;
					dy = -dy;
					maxStep = Infinity;
				} else if (d <= kmax) {
					// Strafe around the target inside the keep ring.
					const s = Math.sin(e.phase) >= 0 ? 1 : -1;
					[dx, dy] = [-dy * s, dx * s];
					speed *= 0.5;
				}
			} else if (e.ai === 'exploder' && e.fuseT > 0) {
				e.fuseT -= dt;
				if (e.fuseT <= 0) this.killEnemy(e, e.fuseBy, SRC_BLAST);
				continue;
			}
			if (e.zig) {
				const s = Math.sin(now * 5 + e.phase) * 0.9;
				const zx = dx - dy * s, zy = dy + dx * s;
				const l = Math.hypot(zx, zy) || 1;
				dx = zx / l;
				dy = zy / l;
			}
			const step = Math.min(speed * dt, maxStep);
			e.x += dx * step;
			e.y += dy * step;

			this.grid.query(e.x, e.y, e.r + MAX_ENEMY_R, near);
			let checked = 0;
			for (let i = 0; i < near.length && checked < SEPARATION_NEIGHBORS; i++) {
				const o = near[i];
				if (o === e) continue;
				const ox = e.x - o.x, oy = e.y - o.y;
				const min = e.r + o.r;
				const dd = ox * ox + oy * oy;
				if (dd >= min * min) continue;
				checked++;
				if (dd < 0.0001) {
					e.x += (Math.random() - 0.5) * 2;
					continue;
				}
				const l = Math.sqrt(dd);
				// Heavier enemies (boss) are pushed less.
				const push = (min - l) * 0.5 * (o.r / (e.r + o.r)) * 2;
				e.x += (ox / l) * push * 0.5;
				e.y += (oy / l) * push * 0.5;
			}
		}
	}

	// Ranged enemy: wind up, then spit at the target's current position. Returns true while it stands still.
	rangedTick(e, target, d, dt) {
		const E = e.def;
		if (e.windT > 0) {
			e.windT -= dt;
			if (e.windT <= 0) {
				e.windT = 0;
				this.fireHostile(e, target);
			}
			return true;
		}
		e.shotT -= dt;
		if (e.shotT <= 0 && d < E.keep[1] + 80) {
			e.windT = E.windup;
			e.shotT = E.shotCd;
			return true;
		}
		return false;
	}

	fireHostile(e, target) {
		const E = e.def;
		const dx = target.x - e.x, dy = target.y - e.y;
		const d = Math.hypot(dx, dy) || 1;
		const s = {
			id: this.nextId++, x: e.x, y: e.y, vx: (dx / d) * E.shotSpeed, vy: (dy / d) * E.shotSpeed,
			life: E.shotLife, dmg: E.shotDmg,
		};
		this.hostile.push(s);
		this.fx.push(['eshot', s.id, Math.round(s.x), Math.round(s.y), Math.round(s.vx), Math.round(s.vy), round3(s.life), round3(this.time)]);
	}

	updateHostile(dt) {
		let j = 0;
		for (const s of this.hostile) {
			s.life -= dt;
			s.x += s.vx * dt;
			s.y += s.vy * dt;
			let done = s.life <= 0;
			if (!done) {
				const min = HOSTILE_R + PLAYER_RADIUS;
				for (const h of this.heroes.values()) {
					if (h.st !== 0 || dist2(h.x, h.y, s.x, s.y) >= min * min) continue;
					if (h.iframes <= 0) this.hurtPlayer(h, s.dmg);
					done = true;
					break;
				}
			}
			if (done) this.fx.push(['epend', s.id, round3(this.time)]);
			else this.hostile[j++] = s;
		}
		this.hostile.length = j;
	}

	eliteTick(e, target, dt) {
		if (e.elite === 'leech') {
			e.auxT -= dt;
			if (e.auxT > 0) return;
			e.auxT = LEECH_EVERY;
			for (const o of this.grid.query(e.x, e.y, LEECH_R, this.q3)) {
				if (o === e || o.dead || dist2(o.x, o.y, e.x, e.y) > LEECH_R * LEECH_R) continue;
				o.hp = Math.min(o.maxHp, o.hp + o.maxHp * LEECH_FRAC * LEECH_EVERY);
			}
		} else if (e.elite === 'blink') {
			e.auxT -= dt;
			if (e.auxT > 0 || e.frozenT > this.time || e.rootT > this.time) return;
			e.auxT = BLINK_EVERY;
			const dx = target.x - e.x, dy = target.y - e.y;
			const d = Math.hypot(dx, dy) || 1;
			const step = Math.min(BLINK_DIST, Math.max(0, d - e.r - PLAYER_RADIUS - 20));
			this.fx.push(['blink', Math.round(e.x), Math.round(e.y)]);
			e.x += (dx / d) * step;
			e.y += (dy / d) * step;
		}
	}

	// Once in a while a regular enemy near the players turns into an elite with one affix.
	makeElite(alive) {
		const cand = [];
		for (const e of this.enemies) {
			if (e.dead || e.boss || e.elite || e.ai === 'exploder') continue;
			for (const h of alive) {
				if (dist2(e.x, e.y, h.x, h.y) < ELITE_PICK_DIST2) {
					cand.push(e);
					break;
				}
			}
		}
		if (!cand.length) return null;
		// Prefer tougher enemies.
		cand.sort((a, b) => b.maxHp - a.maxHp);
		const e = cand[Math.floor(Math.random() * Math.min(cand.length, 12))];
		const affix = ELITE_AFFIXES[Math.floor(Math.random() * ELITE_AFFIXES.length)].id;
		this.setElite(e, affix);
		return e;
	}

	setElite(e, affix) {
		e.elite = affix;
		e.hp *= ELITE_HP_MUL;
		e.maxHp *= ELITE_HP_MUL;
		e.r *= ELITE_R_MUL;
		e.xp *= 3;
		e.auxT = affix === 'blink' ? BLINK_EVERY : 0;
		if (affix === 'fast') e.speed *= 1.4;
		this.fx.push(['elite', e.id, ELITE_AFFIX_INDEX[affix]]);
	}

	// Taunting heroes pull enemies within their taunt range away from the nearest player.
	tauntTarget(e, taunters, best, bd) {
		let tb = null, td = Infinity;
		for (const p of taunters) {
			const d = dist2(e.x, e.y, p.x, p.y);
			if (d < p.trait.taunt * p.trait.taunt && d < td) {
				td = d;
				tb = p;
			}
		}
		return tb ? [tb, td] : [best, bd];
	}

	// The single damage entry point: mark → crit → (reactions, wave 2) → armor → hp → burn.
	hurtEnemy(e, dmg, h, src = SRC_NONE) {
		if (e.dead || dmg <= 0) return 0;
		const now = this.time;
		let crit = false;
		if (e.markT > now) dmg *= 1 + e.markMul;
		if (h) {
			if (h.rageT > now) dmg *= ITEMS.rage.mul;
			if (h.mods.chillVuln > 0 && e.slowT > now) dmg *= 1 + h.mods.chillVuln;
			if (h.mods.critChance > 0 && Math.random() < h.mods.critChance) {
				crit = true;
				dmg *= h.mods.critMul;
			}
		}
		if (e.elite === 'armored' && src.tags.includes('proj')) dmg *= 0.5;
		const dealt = Math.min(dmg, e.hp);
		if (h) {
			h.dmg += dealt;
			h.dmgBy[src.weapon] = (h.dmgBy[src.weapon] ?? 0) + dealt;
		}
		e.hp -= dmg;
		if (crit && this.critFx < MAX_CRIT_FX) {
			this.critFx++;
			this.fx.push(['hit', Math.round(e.x), Math.round(e.y), Math.max(1, Math.round(dmg)), 1, h.pid]);
		} else if (this.hitFx < MAX_HIT_FX) {
			this.hitFx++;
			this.fx.push(['hit', Math.round(e.x), Math.round(e.y), Math.max(1, Math.round(dmg))]);
		}
		if (e.hp <= 0) this.killEnemy(e, h, src);
		else if (h && h.mods.burnChance > 0 && src !== SRC_BURN && Math.random() < h.mods.burnChance) this.burn(e, h, h.mods.burnDps, 3);
		return dmg;
	}

	burn(e, h, dps, dur) {
		if (e.burnT <= this.time) e.burnAcc = 0;
		e.burnT = this.time + dur * h.mods.durMul;
		if (dps >= e.burnDps || e.burnT <= this.time) e.burnDps = dps;
		e.burnOwner = h;
	}

	burnTick(e, dt) {
		e.burnAcc += dt;
		if (e.burnAcc < BURN_TICK) return;
		e.burnAcc -= BURN_TICK;
		this.hurtEnemy(e, e.burnDps * BURN_TICK, e.burnOwner, SRC_BURN);
	}

	slowEnemy(e, slow, dur) {
		if (e.slowT <= this.time || slow >= e.slow) e.slow = slow;
		e.slowT = Math.max(e.slowT, this.time + dur);
	}

	killEnemy(e, h, src = SRC_NONE) {
		e.dead = true;
		this.kills++;
		if (h) h.kills++;
		if (this.dieFx < MAX_DIE_FX) {
			this.dieFx++;
			this.fx.push(['die', Math.round(e.x), Math.round(e.y), e.type]);
		}
		const luck = h ? h.mods.luck : 0;
		this.dropGem(e.x, e.y, e.xp, Math.random() < GOLD_GEM_CHANCE * (1 + luck));
		if (e.ai === 'exploder' && !e.exploded) {
			e.exploded = true;
			const E = e.def;
			// Killed by a player: short fuse at the spot; fuse burnt out: blows up right away.
			this.addBlast(e.x, e.y, E.blastR, E.blastDmg, E.blastEnemyDmg, h, 1, e.fuseT > 0 || src === SRC_BLAST ? 0 : E.fuse);
		}
		if (e.elite) {
			if (e.elite === 'volatile') this.addBlast(e.x, e.y, VOLATILE_R, ENEMIES.bloater.blastDmg, ENEMIES.bloater.blastEnemyDmg, h, 2, ENEMIES.bloater.fuse);
			if (Math.random() < ELITE_CHEST_CHANCE * (1 + luck)) this.dropItem('chest', e.x, e.y);
			else this.dropGem(e.x + 12, e.y, e.xp * GOLD_GEM_MUL, true);
		}
		if (e.type === TYPE_INDEX.brute && this.time >= this.nextMagnetT) {
			this.nextMagnetT = this.time + MAGNET_ITEM_EVERY;
			this.dropItem('magnet', e.x, e.y + 10);
		}
		const bi = this.bosses.indexOf(e);
		if (bi >= 0) {
			this.bosses.splice(bi, 1);
			this.fx.push(['chest', Math.round(e.x), Math.round(e.y)]);
			for (const p of this.heroes.values()) if (p.st === 0) this.grantOffer(p);
		}
	}

	// kind: 0 petard (enemies only), 1 bloater, 2 volatile elite (both hurt players too).
	addBlast(x, y, r, pdmg, edmg, owner, kind, delay, src = SRC_BLAST) {
		const b = { x, y, r, pdmg, edmg, owner, kind, t: this.time + delay, src };
		if (delay <= 0) {
			this.explode(b);
			return;
		}
		this.blasts.push(b);
		if (kind !== 0) this.fx.push(['warn', Math.round(x), Math.round(y), Math.round(r), round3(delay)]);
	}

	updateBlasts() {
		if (!this.blasts.length) return;
		let j = 0;
		const due = [];
		for (const b of this.blasts) {
			if (b.t <= this.time + 1e-9) due.push(b);
			else this.blasts[j++] = b;
		}
		this.blasts.length = j;
		for (const b of due) this.explode(b);
	}

	explode(b) {
		this.fx.push(['boom', Math.round(b.x), Math.round(b.y), Math.round(b.r), b.kind]);
		const near = this.grid.query(b.x, b.y, b.r + MAX_ENEMY_R, []);
		for (const e of near) {
			const rr = b.r + e.r * 0.5;
			if (!e.dead && dist2(e.x, e.y, b.x, b.y) < rr * rr) this.hurtEnemy(e, b.edmg, b.owner, b.src);
		}
		if (b.pdmg > 0) {
			for (const h of this.heroes.values()) {
				const rr = b.r + PLAYER_RADIUS;
				if (h.st === 0 && h.iframes <= 0 && dist2(h.x, h.y, b.x, b.y) < rr * rr) this.hurtPlayer(h, b.pdmg);
			}
		}
		if (b.owner) this.breakAround(b.x, b.y, b.r, b.owner);
	}

	dropGem(x, y, xp, gold = false) {
		if (this.gems.length >= MAX_GEMS) {
			// G1: fold the gem farthest from every player into the new one, so XP never drifts out of reach.
			let wi = 0, wd = -1;
			for (let i = 0; i < this.gems.length; i++) {
				const g = this.gems[i];
				let d = Infinity;
				for (const h of this.heroes.values()) {
					const dd = dist2(g.x, g.y, h.x, h.y);
					if (dd < d) d = dd;
				}
				if (d > wd) {
					wd = d;
					wi = i;
				}
			}
			const far = this.gems[wi];
			xp += far.xp;
			gold ||= far.gold;
			this.gems[wi] = this.gems[this.gems.length - 1];
			this.gems.pop();
		}
		this.gems.push({ id: this.nextId++, x, y, xp, gold, pull: null });
	}

	// G1: gems farther than FAR from all players are merged next to the nearest one, at the edge of the view.
	sweepFarGems(alive) {
		const groups = new Map();
		let j = 0;
		for (const g of this.gems) {
			let best = null, bd = Infinity;
			for (const h of alive) {
				const d = dist2(g.x, g.y, h.x, h.y);
				if (d < bd) {
					bd = d;
					best = h;
				}
			}
			if (bd <= FAR_DIST2 || g.pull) {
				this.gems[j++] = g;
				continue;
			}
			let gr = groups.get(best);
			if (!gr) groups.set(best, gr = { xp: 0, sx: 0, sy: 0, n: 0, gold: false });
			gr.xp += g.xp;
			gr.sx += g.x;
			gr.sy += g.y;
			gr.n++;
			gr.gold ||= g.gold;
		}
		this.gems.length = j;
		for (const [h, gr] of groups) {
			const dx = gr.sx / gr.n - h.x, dy = gr.sy / gr.n - h.y;
			const d = Math.hypot(dx, dy) || 1;
			this.gems.push({ id: this.nextId++, x: h.x + (dx / d) * GEM_SWEEP_PLACE, y: h.y + (dy / d) * GEM_SWEEP_PLACE, xp: gr.xp, gold: gr.gold, pull: null });
		}
	}

	dropItem(type, x, y) {
		if (this.items.length >= MAX_ITEMS) {
			const i = this.items.findIndex((it) => it.type !== ITEM_INDEX.chest);
			if (i < 0) return null;
			this.items.splice(i, 1);
		}
		const it = { id: this.nextId++, type: ITEM_INDEX[type], x, y, life: type === 'chest' ? ITEM_LIFE * 2 : ITEM_LIFE };
		this.items.push(it);
		return it;
	}

	updateItems(dt, alive) {
		if (!this.items.length) return;
		let j = 0;
		for (const it of this.items) {
			it.life -= dt;
			if (it.life <= 0) continue;
			let taker = null;
			for (const h of alive) {
				if (h.st === 0 && dist2(h.x, h.y, it.x, it.y) < ITEM_PICK_R * ITEM_PICK_R) {
					taker = h;
					break;
				}
			}
			if (taker) this.useItem(taker, it, alive);
			else this.items[j++] = it;
		}
		this.items.length = j;
	}

	useItem(h, it, alive) {
		const type = ITEM_TYPES[it.type];
		this.fx.push(['item', h.pid, it.type, Math.round(it.x), Math.round(it.y)]);
		const now = this.time;
		switch (type) {
			case 'dew':
				h.hp = Math.min(h.maxHp, h.hp + ITEMS.dew.heal);
				break;
			case 'magnet':
				for (const g of this.gems) g.pull = h;
				break;
			case 'rage': {
				const R = ITEMS.rage.radius;
				for (const o of alive) if (o.st === 0 && dist2(o.x, o.y, h.x, h.y) < R * R) o.rageT = now + ITEMS.rage.dur;
				break;
			}
			case 'cracker': {
				const R = ITEMS.cracker.radius;
				for (const e of this.enemies) {
					if (e.dead || dist2(e.x, e.y, h.x, h.y) >= R * R) continue;
					this.hurtEnemy(e, e.boss || e.elite ? e.maxHp * ITEMS.cracker.bigFrac : e.hp + 1, h, SRC_CRACKER);
				}
				break;
			}
			case 'slowtime': {
				const R = ITEMS.slowtime.radius;
				for (const e of this.enemies) {
					if (e.dead || dist2(e.x, e.y, h.x, h.y) >= R * R) continue;
					e.slow = ITEMS.slowtime.slow;
					e.slowT = Math.max(e.slowT, now + ITEMS.slowtime.dur);
				}
				break;
			}
			case 'feather':
				h.rerolls++;
				if (h.offer) this.sendOffer(h);
				break;
			case 'chest':
				this.fx.push(['open', h.pid, Math.round(it.x), Math.round(it.y)]);
				this.grantOffer(h, true);
				break;
		}
	}

	// Breakable props (deterministic per tile, see content.js) break from any hit that covers them.
	breakAround(x, y, r, h) {
		const R = r + BREAK_R;
		const tx0 = Math.floor((x - R) / BREAK_TILE), tx1 = Math.floor((x + R) / BREAK_TILE);
		const ty0 = Math.floor((y - R) / BREAK_TILE), ty1 = Math.floor((y + R) / BREAK_TILE);
		for (let tx = tx0; tx <= tx1; tx++) {
			for (let ty = ty0; ty <= ty1; ty++) {
				const b = breakableAt(tx, ty);
				if (!b || dist2(b.x, b.y, x, y) >= R * R) continue;
				const key = tx * 100003 + ty;
				if (this.broken.has(key)) continue;
				this.broken.add(key);
				this.brokenList.push(tx, ty);
				this.breakProp(b, h);
			}
		}
	}

	breakProp(b, h) {
		let r = Math.random() * BREAK_DROP_TOTAL;
		let drop = BREAK_DROPS[0][0];
		for (const [id, w] of BREAK_DROPS) {
			if ((r -= w) <= 0) {
				drop = id;
				break;
			}
		}
		this.fx.push(['brk', b.tx, b.ty]);
		if (drop === 'gems') {
			for (let i = 0; i < 5; i++) {
				const a = (i / 5) * Math.PI * 2;
				this.dropGem(b.x + Math.cos(a) * 18, b.y + Math.sin(a) * 18, 3);
			}
		} else {
			this.dropItem(drop, b.x, b.y);
		}
	}

	compactEnemies() {
		let j = 0;
		for (const e of this.enemies) if (!e.dead) this.enemies[j++] = e;
		this.enemies.length = j;
	}

	updatePlayers(dt, alive) {
		const near = this.q1;
		const now = this.time;
		for (const h of alive) {
			if (h.st !== 0) continue;
			h.iframes = Math.max(0, h.iframes - dt);
			if (h.mods.regen > 0) h.hp = Math.min(h.maxHp, h.hp + h.mods.regen * dt);

			this.grid.query(h.x, h.y, PLAYER_RADIUS + MAX_ENEMY_R, near);
			for (const e of near) {
				if (e.dead) continue;
				const min = e.r + PLAYER_RADIUS;
				if (dist2(e.x, e.y, h.x, h.y) >= min * min) continue;
				if (e.ai === 'exploder') {
					if (e.fuseT <= 0) {
						e.fuseT = e.def.fuse;
						e.fuseBy = null;
					}
					continue;
				}
				if (h.iframes > 0 || e.dmg <= 0 || e.frozenT > now) continue;
				this.hurtPlayer(h, e.dmg);
				if (h.st !== 0) break;
			}
			if (h.st !== 0) continue;
			this.breakAround(h.x, h.y, PLAYER_RADIUS, h);
			for (const [id, w] of h.weapons) this.updateWeapon(h, id, w, dt);
		}
	}

	hurtPlayer(h, dmg) {
		h.hp -= Math.max(1, dmg * h.trait.dmgTaken - h.mods.armor);
		h.iframes = PLAYER_IFRAMES;
		this.fx.push(['hurt', h.pid]);
		if (h.hp <= 0) {
			h.hp = 0;
			h.st = 1;
			h.rev = 0;
			this.fx.push(['down', h.pid]);
		}
	}

	nearestEnemies(x, y, count, range) {
		const r2max = range * range;
		const picked = [];
		for (let k = 0; k < count; k++) {
			let best = null, bd = r2max;
			for (const e of this.enemies) {
				if (e.dead || picked.includes(e)) continue;
				const d = dist2(x, y, e.x, e.y);
				if (d < bd) {
					bd = d;
					best = e;
				}
			}
			if (!best) break;
			picked.push(best);
		}
		return picked;
	}

	// Up to `count` points in the densest groups within `range` (most neighbors in DENSE_R among the 12 nearest).
	densestPoints(h, count, range) {
		const cand = this.nearestEnemies(h.x, h.y, 12, range);
		if (!cand.length) return [];
		const scored = cand.map((c) => {
			let n = 0;
			for (const o of this.grid.query(c.x, c.y, DENSE_R, this.q3)) if (!o.dead && dist2(o.x, o.y, c.x, c.y) < DENSE_R * DENSE_R) n++;
			return [n, c];
		});
		scored.sort((a, b) => b[0] - a[0]);
		const out = [];
		for (const [, c] of scored) {
			if (out.length >= count) break;
			if (out.some((p) => dist2(p.x, p.y, c.x, c.y) < 50 * 50)) continue;
			out.push({ x: c.x, y: c.y });
		}
		for (let i = 0; out.length < count; i++) {
			const p = out[i % out.length];
			const a = Math.random() * Math.PI * 2;
			out.push({ x: p.x + Math.cos(a) * 60, y: p.y + Math.sin(a) * 60 });
		}
		return out;
	}

	updateWeapon(h, id, w, dt) {
		const L = WEAPONS[id].levels[w.lvl - 1];
		const { dmgMul, cdMul, areaMul, amount, durMul } = h.mods;
		const src = SRC[id];
		if (id === 'orbit') {
			this.orbitHits(h, L, dmgMul, areaMul, amount);
			return;
		}
		w.t -= dt;
		if (w.t > 0) return;
		const dmg = L.dmg * dmgMul;
		switch (id) {
			case 'bolt': {
				const count = L.count + amount;
				const targets = this.nearestEnemies(h.x, h.y, count, BOLT_RANGE);
				if (!targets.length) {
					w.t = 0.1;
					return;
				}
				for (let i = 0; i < count; i++) {
					const t = targets[i % targets.length];
					const a = Math.atan2(t.y - h.y, t.x - h.x) + (i - (count - 1) / 2) * 0.25;
					this.addProjectile(h, 'bolt', a, L.speed, dmg, L.pierce, 2.5, t);
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'knives': {
				// Aim at the nearest enemy: players usually run away from the horde, so facing would shoot into empty space.
				const count = L.count + amount;
				const target = this.nearestEnemies(h.x, h.y, 1, KNIFE_AIM_RANGE)[0];
				const base = target ? Math.atan2(target.y - h.y, target.x - h.x) : Math.atan2(h.fy, h.fx);
				for (let i = 0; i < count; i++) {
					this.addProjectile(h, 'knife', base + (i - (count - 1) / 2) * L.spread, L.speed, dmg, L.pierce, 1.1, null);
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'sickle': {
				const count = L.count + amount;
				const range = L.range * areaMul;
				const targets = this.nearestEnemies(h.x, h.y, count, range + 60);
				if (!targets.length) {
					w.t = 0.1;
					return;
				}
				for (let i = 0; i < count; i++) {
					const t = targets[i % targets.length];
					const spread = i < targets.length ? 0 : (i - targets.length + 1) * 0.5;
					const a = Math.atan2(t.y - h.y, t.x - h.x) + spread;
					this.addProjectile(h, 'sickle', a, L.speed, dmg, Infinity, (range / L.speed) * 2 + 1.5, null, range / L.speed);
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'whip': {
				const range = L.range * areaMul, width = L.width * areaMul;
				const target = this.nearestEnemies(h.x, h.y, 1, range + width)[0];
				const dir = target ? (target.x >= h.x ? 1 : -1) : (h.fx >= 0 ? 1 : -1);
				this.slash(h, dir, range, width, dmg);
				if (L.both) this.slash(h, -dir, range, width, dmg);
				w.t = L.cd * cdMul;
				return;
			}
			case 'aura': {
				const r = L.radius * areaMul;
				const near = this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2);
				for (const e of near) {
					const rr = r + e.r * 0.5;
					if (!e.dead && dist2(e.x, e.y, h.x, h.y) < rr * rr) this.hurtEnemy(e, dmg, h, src);
				}
				this.breakAround(h.x, h.y, r, h);
				w.t = L.tick;
				return;
			}
			case 'frost': {
				const r = L.radius * areaMul;
				const near = this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2);
				let any = false;
				for (const e of near) {
					const rr = r + e.r * 0.5;
					if (e.dead || dist2(e.x, e.y, h.x, h.y) >= rr * rr) continue;
					any = true;
					this.hurtEnemy(e, dmg, h, src);
					if (e.dead) continue;
					this.slowEnemy(e, L.slow, L.dur * durMul);
					if (L.freeze > 0 && !e.boss) e.frozenT = Math.max(e.frozenT, this.time + L.freeze * h.mods.ctrlMul * durMul);
				}
				if (!any) {
					w.t = 0.2;
					return;
				}
				this.fx.push(['frost', h.pid, Math.round(r)]);
				this.breakAround(h.x, h.y, r, h);
				w.t = L.cd * cdMul;
				return;
			}
			case 'bomb': {
				const pts = this.densestPoints(h, L.count + amount, BOMB_RANGE);
				if (!pts.length) {
					w.t = 0.2;
					return;
				}
				for (const p of pts) {
					const id2 = this.nextId++;
					this.fx.push(['lob', id2, Math.round(h.x), Math.round(h.y), Math.round(p.x), Math.round(p.y), round3(L.fuse), round3(this.time)]);
					this.blasts.push({ x: p.x, y: p.y, r: L.radius * areaMul, pdmg: 0, edmg: dmg, owner: h, kind: 0, t: this.time + L.fuse, src });
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'traps': {
				let x, y;
				if (this.time - h.movedT < MOVE_RECENT) {
					x = h.x - h.mvx * TRAP_BEHIND + (Math.random() - 0.5) * 16;
					y = h.y - h.mvy * TRAP_BEHIND + (Math.random() - 0.5) * 16;
				} else {
					// Standing still: lay them in a ring around the hero.
					const a = h.trapRing++ * 2.4;
					x = h.x + Math.cos(a) * 48;
					y = h.y + Math.sin(a) * 48;
				}
				const r = L.radius * areaMul;
				this.traps.push({ id: this.nextId++, owner: h, x, y, r, dmg, root: L.root * h.mods.ctrlMul, splash: L.splash * areaMul, armT: this.time + TRAP_ARM });
				let mine = 0;
				for (const t of this.traps) if (t.owner === h) mine++;
				if (mine > L.max) this.traps.splice(this.traps.findIndex((t) => t.owner === h), 1);
				w.t = L.cd * cdMul;
				return;
			}
			case 'lightning': {
				const cand = [];
				const R2 = LIGHTNING_RANGE * LIGHTNING_RANGE;
				for (const e of this.enemies) if (!e.dead && dist2(e.x, e.y, h.x, h.y) < R2) cand.push(e);
				if (!cand.length) {
					w.t = 0.2;
					return;
				}
				for (let s = 0; s < L.strikes + amount && cand.length; s++) {
					const idx = Math.floor(Math.random() * cand.length);
					let t = cand[idx];
					cand[idx] = cand[cand.length - 1];
					cand.pop();
					this.fx.push(['zap', Math.round(t.x), Math.round(t.y - 320), Math.round(t.x), Math.round(t.y)]);
					const hit = [t];
					this.hurtEnemy(t, dmg, h, src);
					const chain = L.chain + h.trait.chainBonus;
					for (let c = 0; c < chain; c++) {
						const next = this.nearestFrom(t, hit, CHAIN_RANGE);
						if (!next) break;
						this.fx.push(['zap', Math.round(t.x), Math.round(t.y), Math.round(next.x), Math.round(next.y)]);
						hit.push(next);
						this.hurtEnemy(next, dmg, h, src);
						t = next;
					}
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'flask': {
				const count = L.count + amount;
				const targets = this.nearestEnemies(h.x, h.y, count, 300);
				for (let i = 0; i < count; i++) {
					let x, y;
					const t = targets[i];
					if (t) {
						x = t.x;
						y = t.y;
					} else {
						const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 100;
						x = h.x + Math.cos(a) * d;
						y = h.y + Math.sin(a) * d;
					}
					const z = { id: this.nextId++, owner: h, x, y, r: L.radius * areaMul, life: L.duration * durMul, dmg, tick: L.tick, t: 0, slow: h.trait.puddleSlow };
					this.puddles.push(z);
					if (z.slow > 0) this.fx.push(['slowz', z.id]);
				}
				w.t = L.cd * cdMul;
				return;
			}
		}
	}

	nearestFrom(from, exclude, range) {
		const near = this.grid.query(from.x, from.y, range, this.q2);
		let best = null, bd = range * range;
		for (const e of near) {
			if (e.dead || exclude.includes(e)) continue;
			const d = dist2(from.x, from.y, e.x, e.y);
			if (d < bd) {
				bd = d;
				best = e;
			}
		}
		return best;
	}

	slash(h, dir, range, width, dmg) {
		this.fx.push(['slash', h.pid, dir, Math.round(range), Math.round(width)]);
		const cx = h.x + dir * range / 2;
		const near = this.grid.query(cx, h.y, range / 2 + width / 2 + MAX_ENEMY_R, this.q2);
		const x0 = dir > 0 ? h.x : h.x - range, x1 = dir > 0 ? h.x + range : h.x;
		for (const e of near) {
			if (e.dead) continue;
			if (e.x + e.r < x0 || e.x - e.r > x1) continue;
			if (Math.abs(e.y - h.y) > width / 2 + e.r) continue;
			this.hurtEnemy(e, dmg, h, SRC.whip);
		}
		this.breakAround(cx, h.y, range / 2, h);
	}

	orbitHits(h, L, dmgMul, areaMul, amount) {
		const R = L.radius * areaMul;
		const bladeR = ORBIT_BLADE_R * areaMul;
		const count = L.count + amount;
		const bx = [], by = [];
		for (let i = 0; i < count; i++) {
			const a = orbitAngle(this.time, L.rps, i, count);
			bx.push(h.x + Math.cos(a) * R);
			by.push(h.y + Math.sin(a) * R);
		}
		if (this.tickNo % 3 === 0) for (let i = 0; i < count; i++) this.breakAround(bx[i], by[i], bladeR, h);
		const near = this.grid.query(h.x, h.y, R + bladeR + MAX_ENEMY_R, this.q2);
		if (!near.length) return;
		for (const e of near) {
			if (e.dead) continue;
			if (e.oh && (e.oh[h.pid] ?? 0) > this.time) continue;
			const rr = (bladeR + e.r) * (bladeR + e.r);
			for (let i = 0; i < bx.length; i++) {
				if (dist2(e.x, e.y, bx[i], by[i]) < rr) {
					(e.oh ??= {})[h.pid] = this.time + L.hitCd;
					this.hurtEnemy(e, L.dmg * dmgMul, h, SRC.orbit);
					break;
				}
			}
		}
	}

	// `outT` > 0 makes a returning projectile (sickle): straight out for outT seconds, then back to the owner.
	addProjectile(h, kind, ang, speed, dmg, pierce, life, target, outT = 0) {
		const p = {
			id: this.nextId++, kind: KIND_INDEX[kind], src: SRC[kind === 'knife' ? 'knives' : kind], owner: h, x: h.x, y: h.y,
			vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, speed, dmg, pierce, life, target, hit: [], outT,
		};
		this.projectiles.push(p);
		// Projectiles often live shorter than a snapshot interval, so clients simulate them from events.
		const ev = ['shot', p.id, p.kind, Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy),
			round3(life), target ? target.id : -1, round3(this.time)];
		if (outT > 0) ev.push(h.pid, round3(outT));
		this.fx.push(ev);
	}

	endProjectile(p) {
		this.fx.push(['pend', p.id, Math.round(p.x), Math.round(p.y), round3(this.time)]);
	}

	updateProjectiles(dt) {
		const near = this.q1;
		let j = 0;
		for (const p of this.projectiles) {
			p.life -= dt;
			if (p.life <= 0 || p.pierce <= 0) {
				this.endProjectile(p);
				continue;
			}
			if (p.outT > 0) {
				p.outT -= dt;
				if (p.outT <= 0) p.hit.length = 0; // a new pass on the way back
			} else if (p.outT < 0 || p.kind === KIND_INDEX.sickle) {
				// Returning: fly straight at the owner and vanish on touch.
				const dx = p.owner.x - p.x, dy = p.owner.y - p.y;
				const d = Math.hypot(dx, dy) || 1;
				if (d < SICKLE_CATCH) {
					this.endProjectile(p);
					continue;
				}
				p.vx = (dx / d) * p.speed;
				p.vy = (dy / d) * p.speed;
			}
			if (p.target) {
				if (p.target.dead) {
					p.target = this.nearestEnemies(p.x, p.y, 1, 400)[0] ?? null;
					this.fx.push(['ptgt', p.id, p.target ? p.target.id : -1, round3(this.time)]);
				}
				if (p.target) {
					const dx = p.target.x - p.x, dy = p.target.y - p.y;
					const d = Math.hypot(dx, dy) || 1;
					const k = Math.min(1, dt * 10);
					p.vx += ((dx / d) * p.speed - p.vx) * k;
					p.vy += ((dy / d) * p.speed - p.vy) * k;
					const v = Math.hypot(p.vx, p.vy) || 1;
					p.vx = (p.vx / v) * p.speed;
					p.vy = (p.vy / v) * p.speed;
				}
			}
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			this.breakAround(p.x, p.y, PROJ_R, p.owner);
			this.grid.query(p.x, p.y, PROJ_R + MAX_ENEMY_R, near);
			for (const e of near) {
				if (e.dead || p.hit.includes(e.id)) continue;
				const min = e.r + PROJ_R;
				if (dist2(e.x, e.y, p.x, p.y) >= min * min) continue;
				p.hit.push(e.id);
				this.hurtEnemy(e, p.dmg, p.owner, p.src);
				if (--p.pierce <= 0) break;
				if (p.target === e) {
					p.target = null;
					this.fx.push(['ptgt', p.id, -1, round3(this.time)]);
				}
			}
			if (p.pierce > 0) this.projectiles[j++] = p;
			else this.endProjectile(p);
		}
		this.projectiles.length = j;
	}

	updateTraps() {
		if (!this.traps.length) return;
		const near = this.q1;
		let j = 0;
		for (const t of this.traps) {
			if (!this.heroes.has(t.owner.pid) || dist2(t.x, t.y, t.owner.x, t.owner.y) > TRAP_FAR2) continue;
			let victim = null;
			if (t.armT <= this.time) {
				this.grid.query(t.x, t.y, t.r + MAX_ENEMY_R, near);
				for (const e of near) {
					const rr = t.r + e.r * 0.5;
					if (!e.dead && dist2(e.x, e.y, t.x, t.y) < rr * rr) {
						victim = e;
						break;
					}
				}
			}
			if (!victim) {
				this.traps[j++] = t;
				continue;
			}
			this.fx.push(['snap', Math.round(t.x), Math.round(t.y)]);
			if (!victim.boss) victim.rootT = Math.max(victim.rootT, this.time + t.root);
			this.hurtEnemy(victim, t.dmg, t.owner, SRC.traps);
			if (t.splash > 0) {
				for (const e of this.grid.query(t.x, t.y, t.splash + MAX_ENEMY_R, near)) {
					const rr = t.splash + e.r * 0.5;
					if (e !== victim && !e.dead && dist2(e.x, e.y, t.x, t.y) < rr * rr) this.hurtEnemy(e, t.dmg * SPLASH_FRAC, t.owner, SRC.traps);
				}
			}
		}
		this.traps.length = j;
	}

	updatePuddles(dt) {
		const near = this.q1;
		let j = 0;
		for (const z of this.puddles) {
			z.life -= dt;
			if (z.life <= 0) continue;
			if (z.slow > 0) this.slowInPuddle(z);
			z.t -= dt;
			if (z.t <= 0) {
				z.t = z.tick;
				this.grid.query(z.x, z.y, z.r + MAX_ENEMY_R, near);
				for (const e of near) {
					const rr = z.r + e.r * 0.5;
					if (e.dead || dist2(e.x, e.y, z.x, z.y) >= rr * rr) continue;
					e.wetT = this.time + WET_HOLD;
					this.hurtEnemy(e, z.dmg, z.owner, SRC.flask);
				}
				this.breakAround(z.x, z.y, z.r, z.owner);
			}
			this.puddles[j++] = z;
		}
		this.puddles.length = j;
	}

	slowInPuddle(z) {
		const near = this.grid.query(z.x, z.y, z.r + MAX_ENEMY_R, this.q2);
		for (const e of near) {
			const rr = z.r + e.r * 0.5;
			if (e.dead || dist2(e.x, e.y, z.x, z.y) >= rr * rr) continue;
			if (e.slowT <= this.time || z.slow > e.slow) e.slow = z.slow;
			e.slowT = Math.max(e.slowT, this.time + SLOW_HOLD);
		}
	}

	// Herald-like heroes heal other alive players standing inside their aura.
	auraHeals(dt, alive) {
		for (const h of alive) {
			if (h.st !== 0 || h.trait.auraHeal <= 0) continue;
			const w = h.weapons.get('aura');
			if (!w) continue;
			const r = WEAPONS.aura.levels[w.lvl - 1].radius * h.mods.areaMul;
			for (const o of alive) {
				if (o === h || o.st !== 0 || dist2(o.x, o.y, h.x, h.y) >= r * r) continue;
				o.hp = Math.min(o.maxHp, o.hp + h.trait.auraHeal * dt);
			}
		}
	}

	updateGems(dt, alive) {
		if (!alive.length) return;
		let j = 0;
		for (const g of this.gems) {
			let best = null, bd = Infinity;
			if (g.pull && g.pull.st === 0 && this.heroes.has(g.pull.pid)) {
				best = g.pull;
				bd = dist2(g.x, g.y, best.x, best.y);
			} else {
				g.pull = null;
				for (const h of alive) {
					if (h.st !== 0) continue;
					const d = dist2(g.x, g.y, h.x, h.y);
					const mr = BASE_MAGNET * h.mods.magnetMul;
					if (d < mr * mr && d < bd) {
						bd = d;
						best = h;
					}
				}
			}
			if (best) {
				const d = Math.sqrt(bd);
				if (d < PLAYER_RADIUS + 6) {
					this.collectGem(best, g.xp);
					continue;
				}
				const step = Math.min(d, (g.pull ? GEM_PULL_SPEED * 2 : GEM_PULL_SPEED) * dt);
				g.x += ((best.x - g.x) / d) * step;
				g.y += ((best.y - g.y) / d) * step;
			}
			this.gems[j++] = g;
		}
		this.gems.length = j;
	}

	collectGem(h, xp) {
		this.addXp(h, xp * h.mods.xpMul);
		for (const o of this.heroes.values()) if (o !== h && o.st === 0) this.addXp(o, xp * GEM_SHARE * o.mods.xpMul);
	}

	addXp(h, xp) {
		h.xp += xp;
		let need = xpForNext(h.level);
		while (h.xp >= need) {
			h.xp -= need;
			h.level++;
			this.fx.push(['lvl', h.pid]);
			this.grantOffer(h);
			need = xpForNext(h.level);
		}
	}

	updateRevive(dt) {
		const rate = (100 / REVIVE_SECONDS) * dt;
		for (const h of this.heroes.values()) {
			if (h.st !== 1) continue;
			let helped = false;
			for (const o of this.heroes.values()) {
				if (o.st === 0 && dist2(o.x, o.y, h.x, h.y) < REVIVE_RADIUS * REVIVE_RADIUS) {
					helped = true;
					break;
				}
			}
			h.rev = helped ? h.rev + rate : Math.max(0, h.rev - rate * 0.5);
			if (h.rev >= 100) {
				h.st = 0;
				h.rev = 0;
				h.hp = h.maxHp * REVIVE_HP_FRACTION;
				h.iframes = REVIVE_IFRAMES;
				h.lastPosT = this.time;
				this.fx.push(['up', h.pid]);
			}
		}
	}

	checkAllDown() {
		if (this.state !== 'play' || this.heroes.size === 0) return false;
		for (const h of this.heroes.values()) if (h.st === 0) return false;
		this.finish(false);
		return true;
	}

	finish(win) {
		this.snapshot();
		this.state = 'over';
		for (const h of this.heroes.values()) {
			h.offer = null;
			h.queue = 0;
		}
		this.overMsg = {
			t: 'over', win, time: Math.round(this.time * 10) / 10, host: this.host,
			stats: [...this.heroes.values()].map((h) => ({ pid: h.pid, name: h.name, hero: h.hero, kills: h.kills, dmg: Math.round(h.dmg), level: h.level })),
		};
		this.broadcast(this.overMsg);
	}

	enemyState(en) {
		const t = this.time;
		let st = 0;
		if (en.burnT > t) st |= ST.burn;
		if (en.slowT > t) st |= ST.chill;
		if (en.frozenT > t) st |= ST.frozen;
		if (en.wetT > t) st |= ST.wet;
		if (en.markT > t) st |= ST.mark;
		if (en.rootT > t) st |= ST.root;
		if (en.elite) st |= ST.elite;
		if (en.windT > 0 || en.fuseT > 0) st |= ST.windup;
		return st;
	}

	snapshot() {
		const ps = [...this.heroes.values()];
		const visible = (x, y) => {
			for (const h of ps) if (dist2(x, y, h.x, h.y) < VIEW_DIST2) return true;
			return false;
		};
		const p = ps.map((h) => [
			h.pid, Math.round(h.x), Math.round(h.y), Math.ceil(h.hp), Math.round(h.maxHp), h.level,
			Math.floor(h.xp), xpForNext(h.level), h.st, Math.round(h.rev), r2(h.fx), r2(h.fy),
			// Orbit gets a 3rd field with extra blades (Echo) so clients draw what the server hits with.
			[...h.weapons].map(([id, w]) => (id === 'orbit' && h.mods.amount > 0 ? [id, w.lvl, h.mods.amount] : [id, w.lvl])),
		]);
		const e = [];
		for (const en of this.enemies) {
			if (en.dead || !visible(en.x, en.y)) continue;
			e.push(en.id, en.type, Math.round(en.x), Math.round(en.y), clamp(Math.ceil((en.hp / en.maxHp) * 100), 1, 100), this.enemyState(en));
		}
		const b = []; // projectiles travel as shot/ptgt/pend events in fx
		const g = [];
		for (const gm of this.gems) {
			if (!visible(gm.x, gm.y)) continue;
			g.push(gm.id, Math.round(gm.x), Math.round(gm.y), gemTier(gm.xp, gm.gold));
		}
		const z = [];
		for (const pz of this.puddles) z.push(pz.id, Math.round(pz.x), Math.round(pz.y), Math.round(pz.r));
		const tr = [];
		for (const t of this.traps) if (visible(t.x, t.y)) tr.push(t.id, Math.round(t.x), Math.round(t.y));
		const it = [];
		for (const i of this.items) if (visible(i.x, i.y)) it.push(i.id, i.type, Math.round(i.x), Math.round(i.y));
		const boss = this.bosses.find((x) => !x.dead);
		const msg = {
			t: 's', tm: Math.round(this.time * 100) / 100, k: this.kills, p, e, b, g, z, tr, it,
			fx: this.fx, boss: boss ? [Math.ceil(boss.hp), Math.round(boss.maxHp)] : null,
		};
		this.fx = [];
		this.hitFx = 0;
		this.dieFx = 0;
		this.critFx = 0;
		this.broadcast(msg);
		return msg;
	}
}

