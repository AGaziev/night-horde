p='game.js'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (s.count(a), a[:90])
    s=s.replace(a,b)
rep("		this.nextMagnetT = MAGNET_ITEM_EVERY;\n		this.critFx = 0;\n","		this.nextMagnetT = MAGNET_ITEM_EVERY;\n		this.critFx = 0;\n		this.orbs = [];\n		this.timers = [];\n		this.synergy = 0;\n")
rep("""		this.updateBlasts();
		this.updateTraps();""","""		this.updateBlasts();
		this.updateOrbs(dt);
		this.updateTimers();
		this.updateTraps(dt);""")
rep("""			if (h.rageT > now) dmg *= ITEMS.rage.mul;""","""			if (h.rageT > now) dmg *= ITEMS.rage.mul;
			if (this.synergy > 0) dmg *= 1 + this.synergy;""")
rep("""		for (const e of near) {
			const rr = b.r + e.r * 0.5;
			if (!e.dead && dist2(e.x, e.y, b.x, b.y) < rr * rr) this.hurtEnemy(e, b.edmg, b.owner, b.src);
		}""","""		for (const e of near) {
			const rr = b.r + e.r * 0.5;
			if (e.dead || dist2(e.x, e.y, b.x, b.y) >= rr * rr) continue;
			this.hurtEnemy(e, b.edmg, b.owner, b.src);
			if (b.kb && !e.dead && !e.boss) this.knock(e, b.x, b.y, b.kb);
		}
		if (b.then) b.then(b);""")
rep("""		const L = WEAPONS[id].levels[w.lvl - 1];
		const { dmgMul, cdMul, areaMul, amount, durMul } = h.mods;
		const src = SRC[id];
		if (id === 'orbit') {
			this.orbitHits(h, L, dmgMul, areaMul, amount);
			return;
		}""","""		const L = weaponDef(id).levels[w.lvl - 1];
		const { dmgMul, cdMul, areaMul, amount, durMul } = h.mods;
		const src = SRC[id];
		switch (id) {
			case 'orbit':
				this.orbitHits(h, L, dmgMul, areaMul, amount);
				return;
			case 'windmill':
				this.windmillHits(h, L, dmgMul, areaMul, amount);
				return;
			case 'orrery':
				this.orreryTick(h, w, L, dt);
				return;
			case 'tripwire':
				this.tripwireTick(h, w, L, dt);
				return;
			case 'aurora':
				w.p = (w.p ?? L.pulse) - dt;
				if (w.p <= 0) {
					w.p = L.pulse * cdMul;
					this.auroraPulse(h, L);
				}
				break;
		}""")
exec(open('/Users/a.gaziev/src/modules/.tmp/vibe-survivors/content-wave01/duo-patch-rest.py').read())
open(p,'w').write(s)
