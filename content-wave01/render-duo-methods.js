	// Громовой разрез: a two-sided crescent with an electric rim; every 3rd swing a ring of lightning.
	drawThunder(ctx, game, now) {
		if (!game.tslashes.length && !game.fans.length) return;
		ctx.save();
		ctx.lineJoin = 'round';
		for (const s of game.tslashes) {
			const p = game.playerPos(s.pid, this.tmp);
			if (!p) continue;
			const k = s.t / 0.32;
			const fade = 1 - k;
			const grow = 0.75 + 0.25 * Math.min(1, k * 4);
			for (const dir of [1, -1]) {
				const rx = (s.range / 2 + 8) * grow, ry = (s.width / 2 + 6) * grow;
				const cx = p.x + dir * rx;
				const a0 = dir > 0 ? -Math.PI / 2 : Math.PI / 2, a1 = dir > 0 ? Math.PI / 2 : Math.PI * 1.5;
				// Body: white at the hero, ice-blue at the tip.
				const g = ctx.createLinearGradient(p.x, p.y, p.x + dir * rx * 2, p.y);
				g.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`);
				g.addColorStop(1, `rgba(64,196,255,${0.75 * fade})`);
				ctx.fillStyle = g;
				ctx.shadowColor = '#40c4ff';
				ctx.shadowBlur = s.big ? 26 : 16;
				ctx.beginPath();
				ctx.ellipse(cx, p.y, rx, ry, 0, a0, a1);
				ctx.ellipse(cx - dir * rx * 0.35, p.y + ry * 0.15, rx * 0.8, ry * 0.62, 0, a1, a0, true);
				ctx.fill();
				ctx.shadowBlur = 0;
				// Electric rim: jagged line along the outer arc, new every frame so it crackles.
				const pts = [];
				const n = 14;
				for (let i = 0; i <= n; i++) {
					const a = a0 + ((a1 - a0) * i) / n;
					const j = i === 0 || i === n ? 0 : (Math.random() - 0.5) * 9;
					pts.push(cx + Math.cos(a) * (rx + j), p.y + Math.sin(a) * (ry + j));
				}
				for (const [w, c] of [[s.big ? 9 : 6, `rgba(128,216,255,${0.55 * fade})`], [2, `rgba(255,255,255,${fade})`]]) {
					ctx.strokeStyle = c;
					ctx.lineWidth = w;
					ctx.beginPath();
					ctx.moveTo(pts[0], pts[1]);
					for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
					ctx.stroke();
				}
			}
			// Sparks spraying from the hero.
			ctx.fillStyle = `rgba(225,245,254,${fade})`;
			ctx.beginPath();
			for (let i = 0; i < 8; i++) {
				const a = s.seed + i * 0.785;
				const d = 20 + k * s.range * 0.9;
				const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d * 0.6;
				ctx.moveTo(x + 2, y);
				ctx.arc(x, y, 2, 0, TAU);
			}
			ctx.fill();
			if (s.big) {
				ctx.fillStyle = `rgba(255,255,255,${0.35 * fade})`;
				ctx.beginPath();
				ctx.arc(p.x, p.y, s.range * 0.55 * grow, 0, TAU);
				ctx.fill();
			}
		}
		for (const f of game.fans) {
			const p = game.playerPos(f.pid, this.tmp);
			if (!p) continue;
			const k = f.t / 0.45;
			const r = f.r * (0.35 + 0.65 * Math.min(1, k * 1.6));
			const pts = [];
			const n = 36;
			for (let i = 0; i <= n; i++) {
				const a = (i / n) * TAU;
				const j = (Math.random() - 0.5) * 16;
				pts.push(p.x + Math.cos(a) * (r + j), p.y + Math.sin(a) * (r + j));
			}
			for (const [w, c] of [[10, `rgba(64,196,255,${0.4 * (1 - k)})`], [2.5, `rgba(255,255,255,${1 - k})`]]) {
				ctx.strokeStyle = c;
				ctx.lineWidth = w;
				ctx.beginPath();
				ctx.moveTo(pts[0], pts[1]);
				for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
				ctx.stroke();
			}
		}
		ctx.restore();
	}

	// Шаровая молния: glowing ball with flickering arcs.
	drawOrbs(ctx, game, now) {
		if (!game.orbs.size) return;
		for (const o of game.orbs.values()) {
			if (!o.show || !this.visible(o.x, o.y)) continue;
			ctx.fillStyle = 'rgba(128,216,255,0.08)';
			ctx.beginPath();
			ctx.arc(o.x, o.y, o.r, 0, TAU);
			ctx.fill();
			ctx.strokeStyle = 'rgba(128,216,255,0.35)';
			ctx.setLineDash([4, 8]);
			ctx.lineDashOffset = -now * 40;
			ctx.lineWidth = 1.5;
			ctx.stroke();
			ctx.setLineDash([]);
			const g = ctx.createRadialGradient(o.x, o.y, 2, o.x, o.y, 22);
			g.addColorStop(0, '#ffffff');
			g.addColorStop(0.4, 'rgba(179,229,252,0.9)');
			g.addColorStop(1, 'rgba(64,196,255,0)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(o.x, o.y, 22 + Math.sin(now * 20) * 2, 0, TAU);
			ctx.fill();
			ctx.strokeStyle = 'rgba(255,255,255,0.9)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			for (let i = 0; i < 4; i++) {
				const a = now * 9 + i * 1.57 + Math.random() * 0.6;
				let x = o.x, y = o.y;
				ctx.moveTo(x, y);
				for (let s = 1; s <= 3; s++) {
					x = o.x + Math.cos(a) * s * 9 + (Math.random() - 0.5) * 6;
					y = o.y + Math.sin(a) * s * 9 + (Math.random() - 0.5) * 6;
					ctx.lineTo(x, y);
				}
			}
			ctx.stroke();
		}
	}

	// Полярное сияние: shimmering green-violet ring of light.
	drawAurora(ctx, x, y, r, now) {
		const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
		g.addColorStop(0, 'rgba(105,240,174,0.03)');
		g.addColorStop(0.75, `rgba(105,240,174,${0.12 + Math.sin(now * 2) * 0.04})`);
		g.addColorStop(1, 'rgba(179,136,255,0.22)');
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, TAU);
		ctx.fill();
		ctx.lineWidth = 3;
		for (let band = 0; band < 2; band++) {
			ctx.strokeStyle = band ? 'rgba(179,136,255,0.45)' : 'rgba(105,240,174,0.5)';
			ctx.beginPath();
			for (let i = 0; i <= 48; i++) {
				const a = (i / 48) * TAU;
				const rr = r * (0.92 + 0.05 * Math.sin(a * 5 + now * (band ? -2 : 2.6)));
				if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
				else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
			}
			ctx.stroke();
		}
	}

	// Мельница: long translucent blades with a motion trail.
	drawWindmill(ctx, px, py, L, count, area, tm, color) {
		const len = L.len * area, w = L.width * area;
		for (let i = 0; i < count; i++) {
			const a = orbitAngle(tm, L.rps, i, count);
			for (let tr = 3; tr >= 0; tr--) {
				const aa = a - tr * 0.07;
				const c = Math.cos(aa), s = Math.sin(aa);
				ctx.fillStyle = tr ? `rgba(227,242,253,${0.08 * (4 - tr)})` : 'rgba(236,239,241,0.55)';
				ctx.beginPath();
				ctx.moveTo(px + c * 16 - s * w * 0.3, py + s * 16 + c * w * 0.3);
				ctx.lineTo(px + c * len - s * w * 0.5, py + s * len + c * w * 0.5);
				ctx.lineTo(px + c * (len + 10), py + s * (len + 10));
				ctx.lineTo(px + c * len + s * w * 0.5, py + s * len - c * w * 0.5);
				ctx.lineTo(px + c * 16 + s * w * 0.3, py + s * 16 - c * w * 0.3);
				ctx.closePath();
				ctx.fill();
			}
			ctx.strokeStyle = color;
			ctx.lineWidth = 1.5;
			ctx.stroke();
		}
		ctx.fillStyle = '#90a4ae';
		ctx.beginPath();
		ctx.arc(px, py, 6, 0, TAU);
		ctx.fill();
	}

	// Планетарий: sparks on an orbit; those that flew off (mask bit 0) are missing until they respawn.
	drawOrrery(ctx, px, py, L, count, area, tm, mask) {
		const R = L.radius * area;
		ctx.strokeStyle = 'rgba(206,147,216,0.25)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(px, py, R, 0, TAU);
		ctx.stroke();
		for (let i = 0; i < count; i++) {
			if (mask >= 0 && i < 30 && !(mask & (1 << i))) continue;
			const a = orbitAngle(tm, L.rps, i, count);
			const x = px + Math.cos(a) * R, y = py + Math.sin(a) * R;
			ctx.fillStyle = 'rgba(206,147,216,0.4)';
			ctx.beginPath();
			ctx.arc(x, y, 9, 0, TAU);
			ctx.fill();
			ctx.fillStyle = '#f8eefa';
			ctx.beginPath();
			ctx.arc(x, y, 4, 0, TAU);
			ctx.fill();
		}
	}

	// Ледяной диск: spinning blue disc with frost teeth.
	drawIceDiscs(ctx, shots, now) {
		for (const s of shots) {
			if (s.kind !== ICEDISC_K) continue;
			ctx.save();
			ctx.translate(s.x, s.y);
			ctx.rotate(now * 14 + s.st * 5);
			ctx.fillStyle = 'rgba(129,212,250,0.3)';
			ctx.beginPath();
			ctx.arc(0, 0, 18, 0, TAU);
			ctx.fill();
			ctx.fillStyle = '#b3e5fc';
			ctx.strokeStyle = '#0277bd';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			for (let i = 0; i < 12; i++) {
				const a = (i / 12) * TAU, r = i % 2 ? 9 : 14;
				if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
				else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
			}
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}
	}

	drawIceTrail(ctx, game) {
		if (!game.iceTrail.length) return;
		for (const p of game.iceTrail) {
			if (!this.visible(p.x, p.y)) continue;
			const k = p.t / 2.5;
			ctx.fillStyle = `rgba(179,229,252,${0.28 * (1 - k)})`;
			ctx.beginPath();
			ctx.ellipse(p.x, p.y, 24, 18, p.seed, 0, TAU);
			ctx.fill();
		}
	}

