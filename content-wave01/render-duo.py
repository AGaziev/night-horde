p='render.js'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (s.count(a), a[:80])
    s=s.replace(a,b)

rep("""	BREAK_TILE, breakableAt, PROJECTILE_KINDS,
} from '/shared/content.js';
import { P, lerpEnemy, E_STRIDE } from './game.js';""","""	BREAK_TILE, breakableAt, PROJECTILE_KINDS, DUOS,
} from '/shared/content.js';
import { P, lerpEnemy, E_STRIDE, TR_STRIDE, ZK_FIRE, ZK_CLOUD } from './game.js';""")
rep("const SICKLE_K = PROJECTILE_KINDS.indexOf('sickle');","const SICKLE_K = PROJECTILE_KINDS.indexOf('sickle');\nconst ICEDISC_K = PROJECTILE_KINDS.indexOf('icedisc');\nconst duoLevel = (id, lvl) => DUOS[id].levels[Math.max(0, Math.min(2, (lvl | 0) - 1))];")

# draw order: ice trail under puddles, orbs and thunder over enemies
rep("""			this.drawPuddles(ctx, view.b, now);""","""			this.drawIceTrail(ctx, game);
			this.drawPuddles(ctx, view.b, now, game);""")
rep("""			this.drawProjectiles(ctx, game, now);
			this.drawLobs(ctx, game, now);""","""			this.drawProjectiles(ctx, game, now);
			this.drawOrbs(ctx, game, now);
			this.drawThunder(ctx, game, now);
			this.drawLobs(ctx, game, now);""")

# puddles by look
rep("""	drawPuddles(ctx, snap, now) {
		const z = snap.z;
		if (!z.length) return;
		ctx.fillStyle = 'rgba(120,220,90,0.22)';
		ctx.beginPath();
		for (let i = 0; i + 4 <= z.length; i += 4) {
			const x = z[i + 1], y = z[i + 2], r = z[i + 3];
			ctx.moveTo(x + r, y);
			ctx.ellipse(x, y, r, r * 0.8, 0, 0, TAU);
		}
		ctx.fill();""","""	drawPuddles(ctx, snap, now, game) {
		const z = snap.z;
		if (!z.length) return;
		const look = (i) => game.zk.get(z[i]) | 0;
		// Burning pools (Коктейль) and censer clouds (Кадило) have their own look.
		for (let i = 0; i + 4 <= z.length; i += 4) {
			const k = look(i);
			if (!k) continue;
			const x = z[i + 1], y = z[i + 2], r = z[i + 3];
			if (k === ZK_FIRE) {
				const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
				g.addColorStop(0, 'rgba(255,214,0,0.45)');
				g.addColorStop(0.6, 'rgba(255,112,67,0.32)');
				g.addColorStop(1, 'rgba(120,200,80,0.12)');
				ctx.fillStyle = g;
				ctx.beginPath();
				ctx.ellipse(x, y, r, r * 0.8, 0, 0, TAU);
				ctx.fill();
				ctx.fillStyle = 'rgba(255,171,64,0.85)';
				ctx.beginPath();
				for (let f = 0; f < 4; f++) {
					const a = f * 1.6 + z[i] * 0.3, ph = (now * 2 + f * 0.25 + z[i] * 0.07) % 1;
					const fx = x + Math.cos(a) * r * 0.5, fy = y + Math.sin(a) * r * 0.35 - ph * 14;
					ctx.moveTo(fx + 3, fy);
					ctx.arc(fx, fy, 3 * (1 - ph), 0, TAU);
				}
				ctx.fill();
			} else if (k === ZK_CLOUD) {
				ctx.fillStyle = 'rgba(200,230,201,0.16)';
				ctx.beginPath();
				for (let c = 0; c < 3; c++) {
					const a = c * 2.1 + now * 0.6 + z[i] * 0.2;
					const cx = x + Math.cos(a) * r * 0.3, cy = y + Math.sin(a) * r * 0.25 - 4;
					ctx.moveTo(cx + r * 0.7, cy);
					ctx.arc(cx, cy, r * 0.7, 0, TAU);
				}
				ctx.fill();
				ctx.strokeStyle = 'rgba(232,245,233,0.35)';
				ctx.lineWidth = 1.5;
				ctx.stroke();
			}
		}
		ctx.fillStyle = 'rgba(120,220,90,0.22)';
		ctx.beginPath();
		let plain = false;
		for (let i = 0; i + 4 <= z.length; i += 4) {
			if (look(i)) continue;
			const x = z[i + 1], y = z[i + 2], r = z[i + 3];
			ctx.moveTo(x + r, y);
			ctx.ellipse(x, y, r, r * 0.8, 0, 0, TAU);
			plain = true;
		}
		if (!plain) return;
		ctx.fill();""")

# auras incl. aurora
rep("""			for (const wl of w) {
				if (!Array.isArray(wl) || wl[0] !== 'aura') continue;
				const def = WEAPONS.aura.levels[Math.max(0, Math.min(4, (wl[1] | 0) - 1))];
				const pos = game.playerPos(row[P.pid], this.tmp);
				if (!pos) continue;
				const r = def.radius * (row[P.pid] === game.me ? game.areaMul() : 1);""","""			for (const wl of w) {
				if (!Array.isArray(wl)) continue;
				if (wl[0] === 'aurora') {
					const pos = game.playerPos(row[P.pid], this.tmp);
					if (pos) this.drawAurora(ctx, pos.x, pos.y, duoLevel('aurora', wl[1]).radius * (row[P.pid] === game.me ? game.areaMul() : 1), now);
					continue;
				}
				if (wl[0] !== 'aura') continue;
				const def = WEAPONS.aura.levels[Math.max(0, Math.min(4, (wl[1] | 0) - 1))];
				const pos = game.playerPos(row[P.pid], this.tmp);
				if (!pos) continue;
				const r = def.radius * (row[P.pid] === game.me ? game.areaMul() : 1);""")

# orbits: windmill + orrery
rep("""			for (const wl of w) {
				if (!Array.isArray(wl) || wl[0] !== 'orbit') continue;
				const lv = WEAPONS.orbit.levels[Math.max(0, Math.min(4, (wl[1] | 0) - 1))];""","""			for (const wl of w) {
				if (!Array.isArray(wl)) continue;
				if (wl[0] === 'windmill' || wl[0] === 'orrery') {
					const pos = game.playerPos(row[P.pid], this.tmp);
					if (!pos) continue;
					const area = row[P.pid] === game.me ? game.areaMul() : 1;
					const L = duoLevel(wl[0], wl[1]);
					const count = L.count + Math.max(0, wl[2] | 0);
					if (wl[0] === 'windmill') this.drawWindmill(ctx, pos.x, pos.y, L, count, area, tm, game.meta(row[P.pid]).color);
					else this.drawOrrery(ctx, pos.x, pos.y, L, count, area, tm, wl[3] === undefined ? -1 : wl[3] | 0);
					ctx.fillStyle = '#e3f2fd';
					ctx.strokeStyle = 'rgba(144,202,249,0.9)';
					ctx.lineWidth = 2;
					continue;
				}
				if (wl[0] !== 'orbit') continue;
				const lv = WEAPONS.orbit.levels[Math.max(0, Math.min(4, (wl[1] | 0) - 1))];""")

# traps by kind + wires
a=s.index("	drawTraps(ctx, snap, now) {")
b=s.index("	drawItems(ctx, snap, now) {")
s=s[:a]+open('/Users/a.gaziev/src/modules/.tmp/vibe-survivors/content-wave01/render-traps.js').read()+s[b:]

# lob colours by kind
rep("""			ctx.fillStyle = '#e53935';
			ctx.fillRect(-4, -8, 8, 16);
			ctx.fillStyle = '#ffeb3b';
			ctx.fillRect(-4, -2, 8, 3);""","""			// 0 petard, 1 molotov bottle, 2 ice grenade.
			ctx.fillStyle = ['#e53935', '#7cb342', '#4fc3f7'][l.kind] || '#e53935';
			ctx.fillRect(-4, -8, 8, 16);
			ctx.fillStyle = ['#ffeb3b', '#ff7043', '#e1f5fe'][l.kind] || '#ffeb3b';
			ctx.fillRect(-4, -2, 8, 3);""")

# ice discs drawn next to sickles
rep("""		this.drawSickles(ctx, shots, now);""","""		this.drawSickles(ctx, shots, now);
		this.drawIceDiscs(ctx, shots, now);""")

rep("""	drawPlayers(ctx, game, now) {""", open('/Users/a.gaziev/src/modules/.tmp/vibe-survivors/content-wave01/render-duo-methods.js').read() + """	drawPlayers(ctx, game, now) {""")
open(p,'w').write(s)
