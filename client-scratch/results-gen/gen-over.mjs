// Plays headless runs on the real Room and saves their `over` messages: lose, win (grade 1), gold (grade 2).
import fs from 'node:fs';
const APP = '/Users/a.gaziev/src/modules/.tmp/vibe-survivors/app';
const { Room } = await import(`${APP}/server/game.js`);
const { TICK_HZ, REVIVE_SECONDS } = await import(`${APP}/public/shared/content.js`);
const dt = 1 / TICK_HZ;
const OUT = '/Users/a.gaziev/src/modules/.tmp/vibe-survivors/client-scratch/results-gen/';
const HEROES = ['knight', 'witch', 'ranger'];
const NAMES = ['Алан', 'Артём', 'Сергей'];

function room(n) {
	const msgs = [];
	const r = new Room('GEN', (pid, m) => { if (pid === 1 && m.t === 'over') msgs.push(m); });
	r.setMode('lunch');
	for (let i = 0; i < n; i++) r.addPlayer(i + 1, NAMES[i], HEROES[i]);
	r.start();
	r.msgs = msgs;
	return r;
}
// Bots: pick the first card, wander in a slow circle, get healed under 35% (so the run lasts), fall on schedule.
function play(r, until, falls = [], godFrom = Infinity) {
	let i = 0;
	while (r.state === 'play' && r.time < until) {
		for (const h of r.heroes.values()) {
			if (h.offer) r.handle(h.pid, { t: 'pick', i: 0 });
			if (h.st === 0 && h.hp < h.maxHp * 0.35) h.hp = h.maxHp * 0.8;
			if (h.st === 0 && r.time >= godFrom) { h.hp = h.maxHp; h.iframes = 9; }
		}
		const f = falls.find((x) => !x.done && r.time >= x.t);
		if (f) {
			f.done = true;
			const h = r.heroes.get(f.pid);
			if (h.st === 0) { h.iframes = 0; r.hurtPlayer(h, h.hp + 99, f.from); }
		}
		for (const h of r.heroes.values()) {
			if (h.st === 1 && !h.offline) {
				const helper = [...r.heroes.values()].find((o) => o.st === 0 && o.pid !== h.pid && (f?.noHelp !== h.pid));
				if (helper && r.time - h.downT > 3) { helper.x = h.x + 20; helper.y = h.y; }
			}
		}
		r.tick(dt);
		i++;
	}
}
const falls = () => [
	{ t: 70, pid: 2, from: 'skel' }, { t: 160, pid: 2, from: 'bloater:blast' }, { t: 250, pid: 3, from: 'sniper:shot' }, { t: 400, pid: 2, from: 'brute' },
];

// 1. Lose: a normal run, then everybody falls at 6:20.
{
	const r = room(3);
	play(r, 380, falls());
	for (const h of r.heroes.values()) if (h.st === 0) { h.iframes = 0; r.hurtPlayer(h, h.hp + 999, 'brute'); }
	r.tick(dt);
	fs.writeFileSync(OUT + 'over-lose.json', JSON.stringify(r.msgs.at(-1)));
	console.log('lose', r.msgs.at(-1)?.grade, r.msgs.at(-1)?.card?.group);
}
// 2. Win (grade 1): to the end with the Lord kept alive (he survives, damage to him only from weapons).
{
	const r = room(3);
	play(r, 700, falls(), 530);
	const o = r.msgs.at(-1);
	fs.writeFileSync(OUT + 'over-win.json', JSON.stringify(o));
	console.log('win', o?.grade, o?.card?.fin, o?.card?.group);
}
// 3. Gold: the Lord is slain soon after he comes out.
{
	const r = room(3);
	play(r, 555, falls());
	const L = r.fin?.lord;
	if (L) {
		const a = r.heroes.get(1);
		r.hurtEnemy(L, L.maxHp * 0.25, r.heroes.get(3));
		r.hurtEnemy(L, L.maxHp, a);
		r.tick(dt);
	}
	const o = r.msgs.at(-1);
	fs.writeFileSync(OUT + 'over-gold.json', JSON.stringify(o));
	console.log('gold', o?.grade, o?.card?.fin, o?.card?.awards?.map((x) => x.id));
}
