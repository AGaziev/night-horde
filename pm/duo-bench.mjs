// Duo bench on dummies: dps of a duo at I/II/III vs the sum of its two parts at 3+3 / 4+4 / 5+5.
// node pm/duo-bench.mjs [seconds=40] [duo ids csv]   APP=<dir> picks a code variant (default ../app). Prints a markdown table + JSON.
// Layouts: crowd — 50 immortal harmless dummies walking at the hero (ghoul speed), boss — one big one; a dummy that
// reaches the hero steps back to a ring 300–340 px away, so the stream never ends. The hero walks a small circle.
// HIT=<s>: the hero takes a 1-damage hit every <s> seconds (shield duos — Оберег, Фаланга, Купол, Контрудар, Громоотвод — answer hits).
// AFF=1 node pm/duo-bench.mjs [seconds] [pairs csv «a+b» | all]: affinity (DUOS v2) of plain weapon pairs at 3+3 and 5+5,
//   dps with affinity vs with `room.affinityOff = true`; target ×1.05–1.12, ceiling ×1.15. No pairs — one per rule.
const APP = process.env.APP ?? new URL('../app/', import.meta.url).pathname;
const { Room } = await import(APP + '/server/game.js');
const C = await import(APP + '/public/shared/content.js');
const { TICK_HZ, DUOS, WEAPONS } = C;

const [secS = '40', only = ''] = process.argv.slice(2);
const SECS = +secS, dt = 1 / TICK_HZ;
const HIT = +(process.env.HIT ?? 0);
const ids = only ? only.split(',') : Object.keys(DUOS);

function seeded(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function dps(weapons, layout, seed = 1, opt = {}) {
	const rnd = seeded(seed);
	const orig = Math.random;
	Math.random = rnd;
	try {
		const r = new Room('BENCH', () => {});
		r.addPlayer(1, 'B', 'knight');
		r.start();
		r.spawn = () => {};
		r.nextEliteT = r.nextInvasionT = Infinity;
		r.peaks = [];
		r.bossAt = [];
		if (opt.affinityOff) r.affinityOff = true;
		const h = r.heroes.get(1);
		h.weapons = new Map(weapons.map(([id, lvl]) => [id, { lvl, t: 0.2 }]));
		h.hp = h.maxHp = 1e9;
		const home = [];
		const add = (type, x, y) => {
			const e = r.spawnEnemy(type, [h], 1);
			e.hp = e.maxHp = 1e9;
			e.x = x; e.y = y; e.speed = 60; e.dmg = 0; e.shotT = 1e9;
			home.push(e);
		};
		if (layout === 'boss') { add('brute', 200, 0); home[0].boss = true; home[0].bk = null; }
		else if(layout === 'target') add('ghoul',200,0);
		else for (let i = 0; i < 50; i++) {
			const a = rnd() * Math.PI * 2, d = 40 + Math.sqrt(rnd()) * 280;
			add('ghoul', Math.cos(a) * d, Math.sin(a) * d);
		}
		if (layout === 'boss') home[0].r = 38;
		let a = 0, hitT = HIT;
		for (let i = 0; i < SECS * TICK_HZ; i++) {
			if (HIT > 0 && (hitT -= dt) <= 0) {
				hitT += HIT;
				if (h.iframes <= 0) r.hurtPlayer(h, 1, 'bench');
			}
			a += (120 / 60) * dt;
			const nx = Math.cos(a) * 60, ny = Math.sin(a) * 60;
			h.fx = nx - h.x || 1; h.fy = ny - h.y;
			const l = Math.hypot(h.fx, h.fy); h.fx /= l; h.fy /= l;
			h.mvx = h.fx; h.mvy = h.fy; h.movedT = r.time;
			h.x = nx; h.y = ny;
			r.tick(dt);
			for (const e of home) {
				e.dead = false; e.hp = 1e9;
				if ((e.x - h.x) ** 2 + (e.y - h.y) ** 2 < (e.r + 16) ** 2) {
					const b = rnd() * Math.PI * 2, d = 300 + rnd() * 40;
					e.x = h.x + Math.cos(b) * d; e.y = h.y + Math.sin(b) * d;
				}
			}
			r.fx.length = 0;
		}
		return h.dmg / SECS;
	} finally {
		Math.random = orig;
	}
}

export const avg = (w, layout, opt) => (dps(w, layout, 1, opt) + dps(w, layout, 2, opt) + dps(w, layout, 3, opt)) / 3;
export { DUOS, dps };

// One pair per rule: Тиски, Перекрёстный огонь, Пропитка, Отдача, Вязкость, Наводка (DUOS-v2-design.md, п. 6).
const AFF_SAMPLE = ['whip+frost', 'bolt+knives', 'flask+traps', 'bolt+whip', 'whip+flask', 'knives+lantern'];
function affMain() {
	if (!C.AFFINITY || !Object.values(WEAPONS).every((w) => w.role)) {
		console.error('В этой версии нет сродства: нужны AFFINITY и WEAPONS[id].role в content.js (DUOS v2).');
		process.exit(2);
	}
	const W = Object.keys(WEAPONS);
	const all = W.flatMap((a, i) => W.slice(i + 1).map((b) => `${a}+${b}`)).filter((k) => !C.DUO_BY_PAIR[C.duoKey(...k.split('+'))]);
	const pairs = only === 'all' ? all : only ? only.split(',') : AFF_SAMPLE;
	const rule = (a, b) => [WEAPONS[a].role, WEAPONS[b].role].sort().join('');
	const rows = [];
	for (const k of pairs) {
		const [a, b] = k.split('+');
		if (!WEAPONS[a] || !WEAPONS[b]) throw new Error(`нет оружия в паре ${k}`);
		if (C.DUO_BY_PAIR[C.duoKey(a, b)]) throw new Error(`у пары ${k} есть связка — сродства нет`);
		const row = { pair: k, name: `${WEAPONS[a].name} + ${WEAPONS[b].name}`, rule: rule(a, b) };
		for (const layout of ['crowd', 'boss']) {
			for (const lv of [3, 5]) {
				const w = [[a, lv], [b, lv]];
				const on = avg(w, layout), off = avg(w, layout, { affinityOff: true });
				row[`${layout}${lv}`] = { on: Math.round(on), off: Math.round(off), k: Math.round((on / off) * 100) / 100 };
			}
		}
		rows.push(row);
		process.stderr.write(`${k} `);
	}
	process.stderr.write('\n');
	const fmt = (c) => `${c.on} / ${c.off} (×${c.k}${c.k > 1.15 ? ' ⚠ > 1,15' : c.k < 1.05 ? ' ↓' : ''})`;
	console.log('| Пара | роли | толпа 3+3 | толпа 5+5 | босс 3+3 | босс 5+5 |');
	console.log('|---|---|---|---|---|---|');
	for (const r of rows) console.log(`| ${r.name} | ${r.rule} | ${fmt(r.crowd3)} | ${fmt(r.crowd5)} | ${fmt(r.boss3)} | ${fmt(r.boss5)} |`);
	console.log('\n' + JSON.stringify(rows));
}

function main() {
const rows = [];
for (const id of ids) {
	const [pa, pb] = DUOS[id].parts;
	const row = { id, name: DUOS[id].name };
	for (const layout of ['crowd', 'boss']) {
		for (const [lv, pl] of [[1, 3], [2, 4], [3, 5]]) {
			const duo = avg([[id, lv]], layout);
			const parts = avg([[pa, pl], [pb, pl]], layout);
			row[`${layout}${lv}`] = { duo: Math.round(duo), parts: Math.round(parts), k: Math.round((duo / parts) * 100) / 100 };
		}
	}
	rows.push(row);
	process.stderr.write(`${id} `);
}
process.stderr.write('\n');
const fmt = (c) => `${c.duo} / ${c.parts} (×${c.k})`;
console.log('| Связка | толпа I vs 3+3 | толпа II vs 4+4 | толпа III vs 5+5 | босс I vs 3+3 | босс III vs 5+5 |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.name} | ${fmt(r.crowd1)} | ${fmt(r.crowd2)} | ${fmt(r.crowd3)} | ${fmt(r.boss1)} | ${fmt(r.boss3)} |`);
console.log('\n' + JSON.stringify(rows));
}

if (!process.env.NO_MAIN) (process.env.AFF ? affMain : main)();
