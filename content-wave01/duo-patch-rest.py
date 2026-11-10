rep("""			case 'bomb': {
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
			}""","""			case 'bomb':
			case 'molotov':
			case 'icebomb': {
				const lobKind = id === 'bomb' ? 0 : id === 'molotov' ? 1 : 2;
				const thrown = this.throwBombs(h, L.count + amount, L.fuse, lobKind, (x, y) => ({
					x, y, r: L.radius * areaMul, pdmg: 0, edmg: dmg, owner: h, src,
					kind: lobKind === 0 ? 0 : lobKind === 1 ? 6 : 4,
					then: lobKind === 1 ? (b) => this.firePool(h, b, L) : lobKind === 2 ? (b) => this.iceBurst(h, b, L) : null,
				}));
				w.t = thrown ? L.cd * cdMul : 0.2;
				return;
			}
			case 'traps':
				this.layTrap(h, { r: L.radius * areaMul, dmg, root: L.root * h.mods.ctrlMul, splash: L.splash * areaMul, max: L.max, src });
				w.t = L.cd * cdMul;
				return;
			case 'minefield':
				this.layTrap(h, { kind: 1, r: L.trigger * areaMul, dmg, blastR: L.radius * areaMul, kb: L.kb, recharge: L.recharge, max: L.max, src });
				w.t = L.cd * cdMul;
				return;
			case 'thunderslash': {
				const range = L.range * areaMul, width = L.width * areaMul;
				w.n = (w.n ?? 0) + 1;
				const big = w.n % 3 === 0;
				this.fx.push(['tslash', h.pid, Math.round(range), Math.round(width), big ? 1 : 0]);
				const hit = [];
				for (const dir of [1, -1]) {
					this.slashHits(h, dir, range, width, dmg, src, hit);
					this.breakAround(h.x + (dir * range) / 2, h.y, range / 2, h);
				}
				// Every enemy hit becomes a lightning rod: a strike from the sky 0.3 s later, chaining on.
				const rods = hit.slice(0, 5);
				const chain = L.chain + h.trait.chainBonus;
				if (rods.length) this.after(0.3, () => { for (const e of rods) this.strikeAt(h, e, dmg * L.rodFrac, chain, src); });
				if (big) this.thunderFan(h, L, range, src);
				w.t = L.cd * cdMul;
				return;
			}
			case 'orb': {
				const pts = this.densestPoints(h, L.count + amount, 420);
				if (!pts.length) {
					w.t = 0.2;
					return;
				}
				for (const p of pts) {
					const o = {
						id: this.nextId++, owner: h, x: h.x, y: h.y, tx: p.x, ty: p.y, speed: L.speed, life: L.life,
						r: L.radius * areaMul, dmg, tick: L.tick, t: L.tick, boom: L.boom * dmgMul, boomR: L.boomR * areaMul, src,
					};
					this.orbs.push(o);
					this.fx.push(['orb', o.id, Math.round(o.x), Math.round(o.y), Math.round(o.tx), Math.round(o.ty), o.speed, round3(o.life), round3(this.time), Math.round(o.r)]);
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'fanback': {
				const count = L.count + amount;
				const range = L.range * areaMul;
				const target = this.nearestEnemies(h.x, h.y, 1, range + 200)[0];
				if (!target) {
					w.t = 0.1;
					return;
				}
				const base = Math.atan2(target.y - h.y, target.x - h.x);
				for (let i = 0; i < count; i++) {
					this.addProjectile(h, 'knife', base + (i - (count - 1) / 2) * L.spread, L.speed, dmg, Infinity, (range / L.speed) * 2 + 1.2, null, range / L.speed, { src });
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'icedisc': {
				const count = L.count + amount;
				const range = L.range * areaMul;
				const targets = this.nearestEnemies(h.x, h.y, count, range + 60);
				if (!targets.length) {
					w.t = 0.1;
					return;
				}
				for (let i = 0; i < count; i++) {
					const t = targets[i % targets.length];
					const a = Math.atan2(t.y - h.y, t.x - h.x) + (i < targets.length ? 0 : (i - targets.length + 1) * 0.5);
					this.addProjectile(h, 'icedisc', a, L.speed, dmg, Infinity, (range / L.speed) * 2 + 1.5, null, range / L.speed, {
						src, trail: { r: L.trailR * areaMul, life: L.trailLife * durMul, slow: L.trailSlow, every: 0.08, acc: 0 },
						freezeBack: L.freeze * h.mods.ctrlMul * durMul,
					});
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'aurora': {
				const r = L.radius * areaMul;
				for (const e of this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2)) {
					const rr = r + e.r * 0.5;
					if (e.dead || dist2(e.x, e.y, h.x, h.y) >= rr * rr) continue;
					this.hurtEnemy(e, dmg, h, src);
					if (!e.dead) this.slowEnemy(e, L.slow, L.tick + 0.2);
				}
				this.breakAround(h.x, h.y, r, h);
				w.t = L.tick;
				return;
			}
			case 'censer': {
				const z = {
					id: this.nextId++, owner: h, x: h.x, y: h.y, r: L.radius * areaMul, life: L.life * durMul, dmg, tick: L.tick, t: 0,
					slow: h.trait.puddleSlow, heal: L.heal,
				};
				this.puddles.push(z);
				this.fx.push(['zk', z.id, 2]);
				w.t = L.every;
				return;
			}""")
rep("""	nearestFrom(from, exclude, range) {""", open('/Users/a.gaziev/src/modules/.tmp/vibe-survivors/content-wave01/duo-helpers.js').read() + """	nearestFrom(from, exclude, range) {""")
rep("""	addProjectile(h, kind, ang, speed, dmg, pierce, life, target, outT = 0) {
		const p = {
			id: this.nextId++, kind: KIND_INDEX[kind], src: SRC[kind === 'knife' ? 'knives' : kind], owner: h, x: h.x, y: h.y,
			vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, speed, dmg, pierce, life, target, hit: [], outT,
		};""","""	// opts: x, y (start), src, spike (knife becomes a spike on a miss), trail (ice trail), freezeBack (freeze on the way back).
	addProjectile(h, kind, ang, speed, dmg, pierce, life, target, outT = 0, opts = {}) {
		const p = {
			id: this.nextId++, kind: KIND_INDEX[kind], src: opts.src ?? SRC[kind === 'knife' ? 'knives' : kind], owner: h,
			x: opts.x ?? h.x, y: opts.y ?? h.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, speed, dmg, pierce, life, target,
			hit: [], outT, returns: outT > 0, spike: opts.spike ?? null, trail: opts.trail ?? null, freezeBack: opts.freezeBack ?? 0, anyHit: false,
		};""")
rep("""			if (p.life <= 0 || p.pierce <= 0) {
				this.endProjectile(p);
				continue;
			}
			if (p.outT > 0) {
				p.outT -= dt;
				if (p.outT <= 0) p.hit.length = 0; // a new pass on the way back
			} else if (p.kind === KIND_INDEX.sickle) {""","""			if (p.life <= 0 || p.pierce <= 0) {
				if (p.spike && !p.anyHit) this.layTrap(p.owner, { kind: 3, x: p.x, y: p.y, r: 14, dmg: p.spike.dmg, root: p.spike.root, life: p.spike.life, src: p.src });
				this.endProjectile(p);
				continue;
			}
			if (p.trail) this.iceTrail(p, dt);
			if (p.outT > 0) {
				p.outT -= dt;
				if (p.outT <= 0) p.hit.length = 0; // a new pass on the way back
			} else if (p.returns) {""")
rep("""				p.hit.push(e.id);
				this.hurtEnemy(e, p.dmg, p.owner, p.src);
				if (--p.pierce <= 0) break;""","""				p.hit.push(e.id);
				p.anyHit = true;
				this.hurtEnemy(e, p.dmg, p.owner, p.src);
				if (p.freezeBack > 0 && p.outT <= 0 && !e.dead && !e.boss) e.frozenT = Math.max(e.frozenT, this.time + p.freezeBack);
				if (--p.pierce <= 0) break;""")
rep("""	endProjectile(p) {""","""	iceTrail(p, dt) {
		const tr = p.trail;
		tr.acc += dt;
		if (tr.acc < tr.every) return;
		tr.acc = 0;
		const z = { id: this.nextId++, owner: p.owner, x: p.x, y: p.y, r: tr.r, life: tr.life, dmg: 0, tick: 1, t: 1, slow: tr.slow };
		this.puddles.push(z);
		this.fx.push(['zk', z.id, 3]);
	}

	endProjectile(p) {""")
a=s.index("	updateTraps() {")
b=s.index("	updatePuddles(dt) {")
s=s[:a]+open('/Users/a.gaziev/src/modules/.tmp/vibe-survivors/content-wave01/duo-traps.js').read()+s[b:]
rep("""				for (const e of near) {
					const rr = z.r + e.r * 0.5;
					if (e.dead || dist2(e.x, e.y, z.x, z.y) >= rr * rr) continue;
					e.wetT = this.time + WET_HOLD;
					this.hurtEnemy(e, z.dmg, z.owner, SRC.flask);
				}
				this.breakAround(z.x, z.y, z.r, z.owner);
			}""","""				if (z.dmg > 0) {
					for (const e of near) {
						const rr = z.r + e.r * 0.5;
						if (e.dead || dist2(e.x, e.y, z.x, z.y) >= rr * rr) continue;
						if (!z.heal && !z.src) e.wetT = this.time + WET_HOLD; // wet from duo clouds and pools comes with wave 2
						this.hurtEnemy(e, z.dmg, z.owner, z.src ?? (z.heal ? SRC.censer : SRC.flask));
					}
					this.breakAround(z.x, z.y, z.r, z.owner);
				}
			}
			if (z.heal > 0) {
				for (const o of this.heroes.values()) {
					if (o !== z.owner && o.st === 0 && dist2(o.x, o.y, z.x, z.y) < z.r * z.r) o.hp = Math.min(o.maxHp, o.hp + z.heal * dt);
				}
			}""")
rep("""			const w = h.weapons.get('aura');
			if (!w) continue;
			const r = WEAPONS.aura.levels[w.lvl - 1].radius * h.mods.areaMul;""","""			const auraId = h.weapons.has('aura') ? 'aura' : h.weapons.has('aurora') ? 'aurora' : null;
			if (!auraId) continue;
			const r = weaponDef(auraId).levels[h.weapons.get(auraId).lvl - 1].radius * h.mods.areaMul;""")
rep("""			[...h.weapons].map(([id, w]) => (id === 'orbit' && h.mods.amount > 0 ? [id, w.lvl, h.mods.amount] : [id, w.lvl])),""",
"""			[...h.weapons].map(([id, w]) => (id === 'orrery' ? [id, w.lvl, h.mods.amount, this.orreryMask(h, w)]
				: (id === 'orbit' || id === 'windmill') && h.mods.amount > 0 ? [id, w.lvl, h.mods.amount] : [id, w.lvl])),""")
rep("""		for (const t of this.traps) if (visible(t.x, t.y)) tr.push(t.id, Math.round(t.x), Math.round(t.y));""",
"""		for (const t of this.traps) {
			if (!visible(t.x, t.y)) continue;
			tr.push(t.id, Math.round(t.x), Math.round(t.y), t.kind === 1 && t.armT > this.time ? 2 : t.kind, t.owner.pid);
		}""")
rep("""			t: 's', tm: Math.round(this.time * 100) / 100, k: this.kills, p, e, b, g, z, tr, it,""",
"""			t: 's', tm: Math.round(this.time * 100) / 100, k: this.kills, p, e, b, g, z, tr, it, syn: Math.round(this.synergy * 100),""")
