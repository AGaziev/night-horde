	// Lantern: a warm cone of light toward the densest group.
	drawCones(ctx, game) {
		for (const c of game.cones) {
			const p = game.playerPos(c.pid, this.tmp);
			if (!p) continue;
			const k = c.t / 0.45;
			const g = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, c.range);
			g.addColorStop(0, `rgba(255,236,179,${0.35 * (1 - k)})`);
			g.addColorStop(1, 'rgba(255,213,79,0)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.moveTo(p.x, p.y);
			ctx.arc(p.x, p.y, c.range, c.a - c.half, c.a + c.half);
			ctx.closePath();
			ctx.fill();
		}
	}

	// Crescent: a full white-blue ring swing.
	drawCrescents(ctx, game) {
		for (const c of game.crescents) {
			const p = game.playerPos(c.pid, this.tmp);
			if (!p) continue;
			const k = c.t / 0.3;
			const r = c.r * (0.6 + 0.4 * k);
			ctx.strokeStyle = `rgba(144,202,249,${0.7 * (1 - k)})`;
			ctx.lineWidth = 16 * (1 - k) + 2;
			ctx.beginPath();
			ctx.arc(p.x, p.y, r, 0, TAU);
			ctx.stroke();
			ctx.strokeStyle = `rgba(255,255,255,${1 - k})`;
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.arc(p.x, p.y, r + 6, k * 6, k * 6 + Math.PI * 1.6);
			ctx.stroke();
		}
	}

	// Ward / Bastion: a translucent hexagon with one dot per charge.
	drawWard(ctx, x, y, charges, bastion, now) {
		if (!(charges > 0)) return;
		const r = 26;
		ctx.strokeStyle = bastion ? 'rgba(255,213,79,0.85)' : 'rgba(128,216,255,0.75)';
		ctx.fillStyle = bastion ? 'rgba(255,213,79,0.1)' : 'rgba(128,216,255,0.1)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * TAU + now * 0.5;
			if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
			else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = bastion ? '#ffe082' : '#b3e5fc';
		ctx.beginPath();
		for (let i = 0; i < charges; i++) {
			const cx = x + (i - (charges - 1) / 2) * 7, cy = y - r - 6;
			ctx.moveTo(cx + 2.5, cy);
			ctx.arc(cx, cy, 2.5, 0, TAU);
		}
		ctx.fill();
	}

	// Millstones: two rings of hammers turning opposite ways.
	drawMillstones(ctx, px, py, L, area, tm) {
		for (const [R, dir] of [[L.radius * area, 1], [L.radius2 * area, -1]]) {
			for (let i = 0; i < L.count; i++) {
				const a = dir * orbitAngle(tm, L.rps, i, L.count);
				const x = px + Math.cos(a) * R, y = py + Math.sin(a) * R;
				ctx.save();
				ctx.translate(x, y);
				ctx.rotate(a + tm * 6 * dir);
				ctx.fillStyle = '#90a4ae';
				ctx.strokeStyle = 'rgba(0,0,0,0.7)';
				ctx.lineWidth = 1.5;
				ctx.fillRect(-6, -8, 12, 16);
				ctx.strokeRect(-6, -8, 12, 16);
				ctx.fillStyle = '#eceff1';
				ctx.fillRect(4, -8, 2, 16);
				ctx.restore();
			}
		}
	}

	// Moonblade: four pale sickles circling on a wide ellipse.
	drawMoonblades(ctx, px, py, L, area, tm, now) {
		for (let i = 0; i < L.count; i++) {
			const a = orbitAngle(tm, L.rps, i, L.count);
			const x = px + Math.cos(a) * L.rx * area, y = py + Math.sin(a) * L.ry * area;
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(now * 12 + i);
			ctx.fillStyle = 'rgba(225,245,254,0.3)';
			ctx.beginPath();
			ctx.arc(0, 0, 22, 0, TAU);
			ctx.fill();
			ctx.fillStyle = '#e1f5fe';
			ctx.strokeStyle = '#81d4fa';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(0, 0, 17, -1.9, 1.9);
			ctx.arc(6, 0, 12, 1.7, -1.7, true);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}
	}

	// Blizzard: a ring of drifting snow around the hero.
	drawBlizzard(ctx, x, y, r, now) {
		ctx.fillStyle = 'rgba(179,229,252,0.08)';
		ctx.beginPath();
		ctx.arc(x, y, r, 0, TAU);
		ctx.fill();
		ctx.fillStyle = 'rgba(255,255,255,0.85)';
		ctx.beginPath();
		for (let i = 0; i < 36; i++) {
			const a = i * 2.39996 + now * (0.6 + (i % 3) * 0.2);
			const d = r * (0.25 + ((i * 37) % 75) / 100);
			const sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d * 0.9;
			ctx.moveTo(sx + 1.8, sy);
			ctx.arc(sx, sy, 1.8, 0, TAU);
		}
		ctx.fill();
	}

	drawSpears(ctx, shots) {
		ctx.lineCap = 'round';
		for (const s of shots) {
			if (s.kind !== SPEAR_K) continue;
			const v = Math.hypot(s.vx, s.vy) || 1;
			const c = s.vx / v, n = s.vy / v;
			ctx.strokeStyle = 'rgba(255,224,178,0.35)';
			ctx.lineWidth = 7;
			ctx.beginPath();
			ctx.moveTo(s.x - c * 60, s.y - n * 60);
			ctx.lineTo(s.x, s.y);
			ctx.stroke();
			ctx.strokeStyle = '#8d6e63';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.moveTo(s.x - c * 34, s.y - n * 34);
			ctx.lineTo(s.x + c * 6, s.y + n * 6);
			ctx.stroke();
			ctx.fillStyle = '#eceff1';
			ctx.beginPath();
			ctx.moveTo(s.x + c * 18, s.y + n * 18);
			ctx.lineTo(s.x + c * 4 - n * 5, s.y + n * 4 + c * 5);
			ctx.lineTo(s.x + c * 4 + n * 5, s.y + n * 4 - c * 5);
			ctx.closePath();
			ctx.fill();
		}
		ctx.lineCap = 'butt';
	}

