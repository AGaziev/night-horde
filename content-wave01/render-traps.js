	// Traps [id, x, y, kind, pid]: 0 trap, 1 mine, 2 mine recharging, 3 knife spike; Растяжка links its traps with threads.
	drawTraps(ctx, snap, now) {
		const t = snap.tr;
		if (!t.length) return;
		this.drawWires(ctx, snap, now);
		for (let i = 0; i + TR_STRIDE <= t.length; i += TR_STRIDE) {
			const x = t[i + 1], y = t[i + 2], kind = t[i + 3] | 0;
			if (!this.visible(x, y)) continue;
			if (kind === 1 || kind === 2) {
				this.drawMine(ctx, x, y, kind === 1, now, t[i]);
				continue;
			}
			if (kind === 3) {
				ctx.fillStyle = '#cfd8dc';
				ctx.strokeStyle = '#455a64';
				ctx.lineWidth = 1;
				ctx.beginPath();
				for (let k = 0; k < 3; k++) {
					const sx = x + (k - 1) * 5;
					ctx.moveTo(sx - 2.5, y + 4);
					ctx.lineTo(sx, y - 7);
					ctx.lineTo(sx + 2.5, y + 4);
					ctx.closePath();
				}
				ctx.fill();
				ctx.stroke();
				continue;
			}
			ctx.fillStyle = 'rgba(0,0,0,0.3)';
			ctx.beginPath();
			ctx.ellipse(x, y + 3, 15, 6, 0, 0, TAU);
			ctx.fill();
			ctx.strokeStyle = '#90a4ae';
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.ellipse(x, y, 13, 8, 0, 0, TAU);
			ctx.stroke();
			ctx.fillStyle = '#cfd8dc';
			ctx.beginPath();
			for (let k = 0; k < 8; k++) {
				const a = (k / 8) * TAU;
				const cx = x + Math.cos(a) * 13, cy = y + Math.sin(a) * 8;
				ctx.moveTo(cx, cy);
				ctx.lineTo(x + Math.cos(a + 0.2) * 7, y + Math.sin(a + 0.2) * 4);
				ctx.lineTo(x + Math.cos(a - 0.2) * 7, y + Math.sin(a - 0.2) * 4);
				ctx.closePath();
			}
			ctx.fill();
			ctx.fillStyle = `rgba(255,171,64,${0.5 + 0.3 * Math.sin(now * 4 + t[i])})`;
			ctx.beginPath();
			ctx.arc(x, y, 2.5, 0, TAU);
			ctx.fill();
		}
	}

	drawWires(ctx, snap, now) {
		const t = snap.tr;
		const owners = new Map(); // pid -> link length, for players with Растяжка
		for (const row of snap.p) {
			const wl = Array.isArray(row[P.w]) ? row[P.w].find((w) => Array.isArray(w) && w[0] === 'tripwire') : null;
			if (wl) owners.set(row[P.pid], duoLevel('tripwire', wl[1]).link);
		}
		if (!owners.size) return;
		ctx.strokeStyle = `rgba(236,239,241,${0.55 + 0.25 * Math.sin(now * 8)})`;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		for (let i = 0; i + TR_STRIDE <= t.length; i += TR_STRIDE) {
			const link = owners.get(t[i + 4]);
			if (!link || t[i + 3] !== 0) continue;
			for (let j = i + TR_STRIDE; j + TR_STRIDE <= t.length; j += TR_STRIDE) {
				if (t[j + 4] !== t[i + 4] || t[j + 3] !== 0) continue;
				const dx = t[j + 1] - t[i + 1], dy = t[j + 2] - t[i + 2];
				if (dx * dx + dy * dy > link * link) continue;
				ctx.moveTo(t[i + 1], t[i + 2]);
				ctx.lineTo(t[j + 1], t[j + 2]);
			}
		}
		ctx.stroke();
	}

	drawMine(ctx, x, y, armed, now, id) {
		ctx.fillStyle = 'rgba(0,0,0,0.3)';
		ctx.beginPath();
		ctx.ellipse(x, y + 4, 13, 5, 0, 0, TAU);
		ctx.fill();
		ctx.fillStyle = armed ? '#5d4037' : '#3e2723';
		ctx.strokeStyle = armed ? '#ffab40' : '#6d4c41';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(x, y - 11);
		ctx.lineTo(x + 11, y);
		ctx.lineTo(x, y + 11);
		ctx.lineTo(x - 11, y);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		const blink = armed && Math.sin(now * 8 + id) > 0;
		ctx.fillStyle = blink ? '#ff5252' : armed ? '#b71c1c' : '#424242';
		ctx.beginPath();
		ctx.arc(x, y, 3, 0, TAU);
		ctx.fill();
	}

