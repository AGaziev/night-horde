import { Room } from '../app/server/game.js';
import { MAX_ENEMIES, WEAPON_IDS, HEROES, ELITE_AFFIXES } from '../app/public/shared/content.js';
const parts = {}, fxk = {}; let n = 0;
const r = new Room('T', (pid, msg) => {
	if (msg.t === 'lvl') r.handle(pid, { t: 'pick', i: 0 });
	if (msg.t !== 's' || pid !== 1) return;
	n++;
	for (const k of Object.keys(msg)) parts[k] = (parts[k] ?? 0) + JSON.stringify(msg[k]).length;
	for (const f of msg.fx) fxk[f[0]] = (fxk[f[0]] ?? 0) + JSON.stringify(f).length + 1;
});
for (let pid = 1; pid <= 8; pid++) r.addPlayer(pid, `P${pid}`, Object.keys(HEROES)[pid % 7]);
r.start();
for (const h of r.heroes.values()) {
	h.weapons = new Map();
	for (let k = 0; k < 6; k++) h.weapons.set(WEAPON_IDS[(h.pid * 3 + k) % WEAPON_IDS.length], { lvl: 5, t: Math.random() });
	h.passives.set('echo', 5); h.passives.set('crit', 5); r.recalcMods(h);
}
r.time = 400; r.bossIdx = 2;
const alive = [...r.heroes.values()];
const dt = 1 / 30;
for (let i = 0; i < 900; i++) {
	while (r.enemies.length < MAX_ENEMIES) r.spawnEnemy(['skel', 'ghoul', 'bat', 'brute', 'spitter', 'bloater'][r.enemies.length % 6], alive, 50);
	for (const h of r.heroes.values()) { h.hp = h.maxHp; const a = i * dt * 0.7 + h.pid; r.handle(h.pid, { t: 'pos', x: Math.cos(a) * (100 + h.pid * 40), y: Math.sin(a) * (100 + h.pid * 40), fx: 1, fy: 0 }); }
	r.tick(dt);
}
for (const k in parts) parts[k] = Math.round(parts[k] / n);
for (const k in fxk) fxk[k] = Math.round(fxk[k] / n);
console.log(parts, fxk);
