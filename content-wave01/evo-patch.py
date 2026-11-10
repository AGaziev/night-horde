p='game.js'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (s.count(a), a[:90])
    s=s.replace(a,b)

# imports and constants
rep("	SYNERGY_PER, SYNERGY_MAX, ROMAN,\n", "	SYNERGY_PER, SYNERGY_MAX, ROMAN, EVOS, EVO_IDS, EVO_BY_WEAPON, EMBERS,\n")
rep("const FREEZE_IMMUNE = 1.5;", "const FREEZE_IMMUNE = 1.5;\nconst TRAIL_MAX = 24;\nconst SPEAR_RANGE = 500;")
rep("const SRC = Object.fromEntries([...WEAPON_IDS, ...DUO_IDS].map((id) => [id, { weapon: id, tags: weaponDef(id).tags ?? [] }]));",
    "const SRC = Object.fromEntries([...WEAPON_IDS, ...DUO_IDS, ...EVO_IDS].map((id) => [id, { weapon: id, tags: weaponDef(id).tags ?? [] }]));")
rep("		fused: new Set(), duoDefer: {}, offerNo: 0, startWeapon: h.weapon,",
    "		fused: new Set(), duoDefer: {}, offerNo: 0, startWeapon: h.weapon, evolved: new Set(), embers: {}, ward: 0, wardMax: 0,")

# offers: ups over all ids, new weapons skip evolved/fused, evo card first, embers instead of nothing
rep("		for (const id of [...WEAPON_IDS, ...DUO_IDS]) {", "		for (const id of [...WEAPON_IDS, ...DUO_IDS, ...EVO_IDS]) {")
rep("			} else if (!DUOS[id] && !h.fused.has(id) && h.weapons.size < MAX_WEAPONS) {",
    "			} else if (WEAPONS[id] && !h.fused.has(id) && !h.evolved.has(id) && h.weapons.size < MAX_WEAPONS) {")
rep("""		const ready = h.combos.find((c) => c.ready && !(h.duoDefer[c.id] > h.offerNo));
		if (ready) out.push(this.duoCard(h, ready));
		else if (!take(ups)) take(fresh());""","""		// An evolution or a ready duo goes to slot 1 (unless the player declined it recently).
		const evo = this.readyEvo(h);
		const ready = h.combos.find((c) => c.ready && !(h.duoDefer[c.id] > h.offerNo));
		if (evo) out.push(this.evoCard(h, evo));
		else if (ready) out.push(this.duoCard(h, ready));
		else if (!take(ups)) take(fresh());""")
rep("""		if (out.length === 0) return [heal];
		for (const c of out) this.duoHint(h, c);""","""		// Nothing (or not enough) left to upgrade: embers — small permanent bonuses for this run.
		if (out.length < 3) out.push(...this.emberCards(h, 3 - out.length));
		for (const c of out) this.duoHint(h, c);""")

# picking
rep("""		if (c.kind === 'duo') {
			this.fuseDuo(h, c);
		} else if (c.kind === 'weapon') {""","""		if (c.kind === 'duo') {
			this.fuseDuo(h, c);
		} else if (c.kind === 'evo') {
			this.evolve(h, c);
		} else if (c.kind === 'ember') {
			h.embers[c.id] = (h.embers[c.id] ?? 0) + 1;
			const before = h.maxHp;
			this.recalcMods(h);
			if (h.st === 0) h.hp = Math.min(h.maxHp, h.hp + (h.maxHp - before) + (EMBERS[c.id].heal ?? 0));
		} else if (c.kind === 'weapon') {""")
rep("		if (c.kind === 'weapon' || c.kind === 'rare' || c.kind === 'duo') this.updateCombos(h);",
    "		if (c.kind === 'weapon' || c.kind === 'rare' || c.kind === 'duo' || c.kind === 'evo') this.updateCombos(h);")
rep("		for (const c of h.offer ?? []) if (c.kind === 'duo' && c !== picked) h.duoDefer[c.id] = h.offerNo + DUO_DEFER_OFFERS;",
    "		for (const c of h.offer ?? []) if ((c.kind === 'duo' || c.kind === 'evo') && c !== picked) h.duoDefer[c.id] = h.offerNo + DUO_DEFER_OFFERS;")
rep("""		m.cdMul = Math.max(0.3, m.cdMul);""","""		for (const [id, n] of Object.entries(h.embers ?? {})) m[EMBERS[id].stat] += EMBERS[id].value * n;
		m.cdMul = Math.max(0.3, m.cdMul);""")

# ward absorbs a hit
rep("""	hurtPlayer(h, dmg) {
		h.hp -= Math.max(1, dmg * h.trait.dmgTaken - h.mods.armor);""","""	hurtPlayer(h, dmg) {
		if (h.ward > 0) {
			this.wardAbsorb(h);
			return;
		}
		h.hp -= Math.max(1, dmg * h.trait.dmgTaken - h.mods.armor);""")

# crit flag for Tempest
rep("""		if (crit && this.critFx < MAX_CRIT_FX) {""","""		this.lastCrit = crit;
		if (crit && this.critFx < MAX_CRIT_FX) {""")

# Fireworks kills: gems fly to the owner
rep("""		this.dropGem(e.x, e.y, e.xp, Math.random() < GOLD_GEM_CHANCE * (1 + luck));""","""		this.dropGem(e.x, e.y, e.xp, Math.random() < GOLD_GEM_CHANCE * (1 + luck));
		if (h && src.weapon === 'fireworks') this.gems[this.gems.length - 1].pull = h;""")

# continuous weapons
rep("""			case 'aurora':
				w.p = (w.p ?? L.pulse) - dt;
				if (w.p <= 0) {
					w.p = L.pulse * cdMul;
					this.auroraPulse(h, L);
				}
				break;
		}""","""			case 'millstones':
				this.millstoneHits(h, L);
				return;
			case 'moonblade':
				this.moonbladeHits(h, L);
				return;
			case 'ward':
			case 'bastion':
				this.wardTick(h, w, L, dt);
				return;
			case 'aurora':
			case 'blizzard':
				w.p = (w.p ?? L.pulse) - dt;
				if (w.p <= 0) {
					w.p = L.pulse * cdMul;
					this.auroraPulse(h, L, id === 'blizzard' ? 1 : 2);
				}
				break;
			case 'tocsin':
				w.p = (w.p ?? L.wave) - dt;
				if (w.p <= 0) {
					w.p = L.wave;
					this.tocsinWave(h, L);
				}
				break;
		}""")
rep("	auroraPulse(h, L) {\n		const R = L.radius * h.mods.areaMul * 2;","	auroraPulse(h, L, mul = 2) {\n		const R = L.radius * h.mods.areaMul * mul;")

# bolt / swarm
rep("""			case 'bolt': {
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
				}""","""			case 'bolt':
			case 'swarm': {
				const count = L.count + amount;
				const targets = this.nearestEnemies(h.x, h.y, count, BOLT_RANGE);
				if (!targets.length) {
					w.t = 0.1;
					return;
				}
				for (let i = 0; i < count; i++) {
					const t = targets[i % targets.length];
					const a = Math.atan2(t.y - h.y, t.x - h.x) + (i - (count - 1) / 2) * 0.25;
					this.addProjectile(h, 'bolt', a, L.speed, dmg, L.pierce, 2.5, t, 0, { src, split: L.split ?? 0 });
				}""")

# lightning / tempest
rep("""			case 'lightning': {
				const cand = [];""","""			case 'lightning':
			case 'tempest': {
				const cand = [];""")
rep("""				for (let s = 0; s < L.strikes + amount && cand.length; s++) {
					const idx = Math.floor(Math.random() * cand.length);
					let t = cand[idx];""","""				if (id === 'tempest') cand.sort((a, b) => dist2(a.x, a.y, h.x, h.y) - dist2(b.x, b.y, h.x, h.y)); // the first strike hits the nearest
				for (let s = 0; s < L.strikes + amount && cand.length; s++) {
					const idx = id === 'tempest' && s === 0 ? 0 : Math.floor(Math.random() * cand.length);
					let t = cand[idx];""")
rep("""					const hit = [t];
					this.hurtEnemy(t, dmg, h, src);
					const chain = L.chain + h.trait.chainBonus;""","""					const hit = [t];
					this.hurtEnemy(t, dmg, h, src);
					// Tempest: a critical strike jumps further along the chain.
					const chain = L.chain + h.trait.chainBonus + (id === 'tempest' && this.lastCrit ? L.critChain : 0);""")

# aura / tocsin share the aura code; flask stays. New cases before 'flask'.
rep("""			case 'aura': {
				const r = L.radius * areaMul;""","""			case 'aura':
			case 'tocsin': {
				const r = L.radius * areaMul;
				if (L.heal) {
					for (const o of this.heroes.values()) {
						if (o !== h && o.st === 0 && dist2(o.x, o.y, h.x, h.y) < r * r) o.hp = Math.min(o.maxHp, o.hp + L.heal * L.tick);
					}
				}""")
rep("""			case 'flask': {
				const count = L.count + amount;""","""			case 'lantern':
				w.t = this.lanternTick(h, L, src) ? L.tick : 0.2;
				return;
			case 'trail':
				w.t = this.trailTick(h, L, src) ? L.every : 0.05;
				return;
			case 'spear': {
				const t = this.toughest(h, SPEAR_RANGE);
				if (!t) {
					w.t = 0.2;
					return;
				}
				const a = Math.atan2(t.y - h.y, t.x - h.x);
				for (let i = 0; i < 1 + amount; i++) {
					this.addProjectile(h, 'spear', a + (i - amount / 2) * 0.12, L.speed, dmg, L.pierce, SPEAR_RANGE / L.speed + 0.25, null, 0, { src, kb: L.kb, r: L.width / 2 });
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'crescent':
				this.crescentStrike(h, L, src);
				w.t = L.cd * cdMul;
				return;
			case 'bladestorm': {
				const count = L.count + amount;
				w.rot = (w.rot ?? 0) + 0.45;
				const rot = w.rot;
				for (let k = 0; k < count; k++) {
					this.after(k * L.gap, () => {
						if (h.st !== 0 || !h.weapons.has('bladestorm')) return;
						this.addProjectile(h, 'knife', rot + (k * Math.PI * 2) / count, L.speed, dmg, L.pierce, 1.0, null, 0, { src });
					});
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'fireworks': {
				const thrown = this.throwBombs(h, L.count + amount, L.fuse, 3, (x, y) => ({
					x, y, r: L.radius * areaMul, pdmg: 0, edmg: dmg, owner: h, src, kind: 8, then: (b) => this.fireworkSparks(h, b, L),
				}));
				w.t = thrown ? L.cd * cdMul : 0.2;
				return;
			}
			case 'pitfall':
				this.layTrap(h, { kind: 4, r: L.radius * areaMul, dmg, blastR: L.blastR * areaMul, root: L.root * h.mods.ctrlMul, max: L.max, src });
				w.t = L.cd * cdMul;
				return;
			case 'flask': {
				const count = L.count + amount;""")

# aurora case shared with blizzard
rep("""			case 'aurora': {
				const r = L.radius * areaMul;""","""			case 'aurora':
			case 'blizzard': {
				const r = L.radius * areaMul;""")

# pits: blast + root everyone around, then gone
rep("""			if (t.kind === 1) {
				// Mine: blast and recharge instead of vanishing.""","""			if (t.kind === 4) {
				// Wolf pit: a blast that roots everyone around.
				this.explode({ x: t.x, y: t.y, r: t.blastR, pdmg: 0, edmg: t.dmg, owner: t.owner, kind: 5, src });
				for (const e of this.grid.query(t.x, t.y, t.blastR + MAX_ENEMY_R, near)) {
					if (!e.dead && !e.boss && dist2(e.x, e.y, t.x, t.y) < (t.blastR + e.r) ** 2) e.rootT = Math.max(e.rootT, this.time + t.root);
				}
				continue;
			}
			if (t.kind === 1) {
				// Mine: blast and recharge instead of vanishing.""")

# projectiles: hit radius, knockback, split
rep("""			hit: [], outT, returns: outT > 0, spike: opts.spike ?? null, trail: opts.trail ?? null, freezeBack: opts.freezeBack ?? 0, anyHit: false,
		};""","""			hit: [], outT, returns: outT > 0, spike: opts.spike ?? null, trail: opts.trail ?? null, freezeBack: opts.freezeBack ?? 0, anyHit: false,
			r: opts.r ?? PROJ_R, kb: opts.kb ?? 0, split: opts.split ?? 0,
		};""")
rep("""			this.breakAround(p.x, p.y, PROJ_R, p.owner);
			this.grid.query(p.x, p.y, PROJ_R + MAX_ENEMY_R, near);
			for (const e of near) {
				if (e.dead || p.hit.includes(e.id)) continue;
				const min = e.r + PROJ_R;""","""			this.breakAround(p.x, p.y, p.r, p.owner);
			this.grid.query(p.x, p.y, p.r + MAX_ENEMY_R, near);
			for (const e of near) {
				if (e.dead || p.hit.includes(e.id)) continue;
				const min = e.r + p.r;""")
rep("""				if (p.freezeBack > 0 && p.outT <= 0 && !e.dead && !e.boss) this.freeze(e, p.freezeBack);""","""				if (p.freezeBack > 0 && p.outT <= 0 && !e.dead && !e.boss) this.freeze(e, p.freezeBack);
				if (p.kb && !e.dead && !e.boss) this.knock(e, e.x - p.vx, e.y - p.vy, p.kb);
				if (p.split) this.splitSpark(p, e);""")
rep("""	iceTrail(p, dt) {""","""	// Swarm: a spark that hits breaks into smaller sparks seeking other enemies.
	splitSpark(p, e) {
		const exclude = [e];
		for (let i = 0; i < p.split; i++) {
			const t = this.nearestFrom(e, exclude, 260);
			if (t) exclude.push(t);
			const a = t ? Math.atan2(t.y - e.y, t.x - e.x) : Math.random() * Math.PI * 2;
			this.addProjectile(p.owner, 'bolt', a, p.speed, p.dmg * 0.5, 1, 1.0, t ?? null, 0, { x: e.x, y: e.y, src: p.src });
		}
	}

	iceTrail(p, dt) {""")

# puddles: trail burn
rep("""						this.hurtEnemy(e, z.dmg, z.owner, z.src ?? (z.heal ? SRC.censer : SRC.flask));""","""						this.hurtEnemy(e, z.dmg, z.owner, z.src ?? (z.heal ? SRC.censer : SRC.flask));
						if (z.burn && !e.dead) this.burn(e, z.owner, z.burn, 2);""")

# Herald heal works with Tocsin too
rep("			const auraId = h.weapons.has('aura') ? 'aura' : h.weapons.has('aurora') ? 'aurora' : null;",
    "			const auraId = ['aura', 'aurora', 'tocsin'].find((id) => h.weapons.has(id)) ?? null;")

# snapshot: ward charges as p[13]
rep("""				: (id === 'orbit' || id === 'windmill') && h.mods.amount > 0 ? [id, w.lvl, h.mods.amount] : [id, w.lvl])),""","""				: (id === 'orbit' || id === 'windmill') && h.mods.amount > 0 ? [id, w.lvl, h.mods.amount] : [id, w.lvl])),
			h.ward,""")

# helpers
rep("""	after(delay, fn) {""", open('/Users/a.gaziev/src/modules/.tmp/vibe-survivors/content-wave01/evo-helpers.js').read() + """	after(delay, fn) {""")
open(p,'w').write(s)
