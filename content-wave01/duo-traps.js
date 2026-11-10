	updateTraps(dt) {
		if (!this.traps.length) return;
		const near = this.q1;
		let j = 0;
		for (const t of this.traps) {
			if (!this.heroes.has(t.owner.pid) || dist2(t.x, t.y, t.owner.x, t.owner.y) > TRAP_FAR2) continue;
			t.life -= dt;
			if (t.life <= 0) continue;
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
			const src = t.src ?? SRC.traps;
			if (t.kind === 1) {
				// Mine: blast and recharge instead of vanishing.
				this.explode({ x: t.x, y: t.y, r: t.blastR, pdmg: 0, edmg: t.dmg, owner: t.owner, kind: 5, src, kb: t.kb });
				t.armT = this.time + t.recharge;
				this.traps[j++] = t;
				continue;
			}
			this.fx.push(['snap', Math.round(t.x), Math.round(t.y)]);
			if (!victim.boss && t.root > 0) victim.rootT = Math.max(victim.rootT, this.time + t.root);
			this.hurtEnemy(victim, t.dmg, t.owner, src);
			if (t.splash > 0) {
				for (const e of this.grid.query(t.x, t.y, t.splash + MAX_ENEMY_R, near)) {
					const rr = t.splash + e.r * 0.5;
					if (e !== victim && !e.dead && dist2(e.x, e.y, t.x, t.y) < rr * rr) this.hurtEnemy(e, t.dmg * SPLASH_FRAC, t.owner, src);
				}
			}
		}
		this.traps.length = j;
	}

