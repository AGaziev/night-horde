// v23 results screen: group numbers, awards, the finale, a tab per player with small canvas charts, events,
// plus the shareable text and PNG card. Data: `over.card` from the server (server/runlog.js, card()).
import { modeOf } from '/shared/content.js';
import { sprites } from './sprites.js';

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
	const n = document.createElement(tag);
	if (cls) n.className = cls;
	if (text !== undefined) n.textContent = text;
	return n;
}
const mmss = (t) => {
	const s = Math.max(0, Math.round(t || 0));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
// Short form for tight spots of the PNG: 1,33 млн / 133 тыс.
const fmtShort = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace('.', ',')} млн` : n >= 1e5 ? `${Math.round(n / 1e3)} тыс` : fmtNum(n));
export const fmtNum = (n) => String(Math.round(n ?? 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const plural = (n, one, few, many) => {
	const a = Math.abs(n) % 100, b = a % 10;
	return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
const times = (n) => `${n} ${plural(n, 'раз', 'раза', 'раз')}`;
const STATE = { alive: 'на ногах', down: 'лежит', offline: 'вне сети' };
const TITLE = (c) => (c.grade === 2 ? 'Владыка повержен' : c.win ? 'Ночь пережита' : 'Орда победила');
const card = (c) => (c && typeof c === 'object' && Array.isArray(c.players) ? c : null);

// The results block inside #over-card. Returns true when there was a card to show.
let cur = null, sel = null, colors = new Map(), meId = null;
const colorOf = (pid) => colors.get(pid) || '#90a4ae';

function mark(hero, color) {
	const url = hero && sprites.ready ? sprites.portrait(hero, color, 0) : null;
	if (url) {
		const img = el('img', 'portrait portrait-sm');
		img.alt = '';
		img.src = url;
		return img;
	}
	const dot = el('span', 'res-dot');
	dot.style.background = color;
	return dot;
}

export function renderResults(c, me, cols) {
	const root = $('over-card');
	root.textContent = '';
	cur = card(c);
	colors = cols instanceof Map ? cols : new Map();
	meId = me;
	root.hidden = !cur;
	if (!cur) return false;
	root.append(groupBlock(), awardsBlock());
	const fin = finaleBlock();
	if (fin) root.appendChild(fin);
	const players = cur.players;
	const tabs = el('div', 'res-tabs');
	tabs.setAttribute('role', 'tablist');
	tabs.hidden = players.length < 2;
	for (const p of players) {
		const b = el('button', 'res-tab');
		b.type = 'button';
		b.dataset.pid = p.pid;
		b.setAttribute('role', 'tab');
		b.style.setProperty('--c', colorOf(p.pid));
		b.append(el('span', '', p.name), el('span', p.downs ? 'res-tab-downs' : 'res-tab-downs zero', `✝${p.downs}`));
		tabs.appendChild(b);
	}
	tabs.addEventListener('click', (e) => {
		const b = e.target.closest('button[data-pid]');
		if (b) select(b.dataset.pid);
	});
	const body = el('div', 'res-player');
	body.id = 'over-player';
	root.append(tabs, body);
	const ev = eventsBlock();
	if (ev) root.appendChild(ev);
	select(players.some((p) => p.pid === sel) ? sel : players.find((p) => String(p.pid) === String(me))?.pid ?? players[0]?.pid);
	return true;
}

// Charts follow the panel width (phone rotation, window resize); one redraw per frame at most.
let raf = 0;
window.addEventListener('resize', () => {
	if (raf || !cur) return;
	raf = requestAnimationFrame(() => {
		raf = 0;
		drawCharts();
	});
});

function sec(title) {
	const s = el('section', 'res-sec');
	if (title) s.appendChild(el('h3', 'res-h', title));
	return s;
}

function bigTile(box, v, label, cls = '') {
	const t = el('div', 'big-tile ' + cls);
	t.append(el('b', '', String(v)), el('span', '', label));
	box.appendChild(t);
}

function groupBlock() {
	const c = cur, g = c.group ?? { downs: 0, lifted: 0, revives: 0 };
	const box = el('div', 'res-group');
	bigTile(box, fmtNum(c.kills), 'убито врагов');
	bigTile(box, g.downs, c.players.length > 1 ? 'падений группы' : plural(g.downs, 'падение', 'падения', 'падений'), g.downs ? 'bad' : 'good');
	if (c.players.length > 1) bigTile(box, g.revives, 'раз поднимали друг друга', g.revives ? 'good' : '');
	bigTile(box, mmss(c.time), `из ${mmss(c.len || modeOf(c.mode).seconds)}`);
	return box;
}

function awardsBlock() {
	const s = sec('Награды');
	const list = cur.awards ?? [];
	s.hidden = !list.length;
	const box = el('div', 'res-awards');
	for (const a of list) {
		const it = el('div', 'res-award' + (a.pid === meId ? ' me' : ''));
		it.style.setProperty('--c', colorOf(a.pid));
		const head = el('div', 'res-award-top');
		head.append(el('span', 'res-award-icon', a.icon), el('b', '', a.title));
		it.append(head, el('span', 'res-award-who', a.name), el('span', 'res-award-text', a.text));
		box.appendChild(it);
	}
	s.appendChild(box);
	return s;
}

function finaleBlock() {
	const f = cur.fin;
	if (!f) return null;
	const s = sec('Финал');
	s.classList.add('res-fin');
	if (f.grade === 2) s.classList.add('gold');
	const taken = Math.max(0, Math.min(100, Math.round((1 - (f.hpLeft ?? 0)) * 100)));
	const head = f.grade === 2 ? `👑 Владыка повержен за ${Math.round(f.sec)} с` : f.grade === 1 ? `Владыка ушёл в тень — снято ${taken}% здоровья` : `Группа пала на ${Math.round(f.sec)}-й секунде боя — снято ${taken}%`;
	s.appendChild(el('p', 'res-lead', head));
	// One bar = the Lord's health: a segment per player by damage dealt, the rest is what he kept.
	const bar = el('div', 'fin-bar');
	const players = cur.players.filter((p) => p.lord > 0).sort((a, b) => b.lord - a.lord);
	const total = players.reduce((t, p) => t + p.lord, 0) || 1;
	for (const p of players) {
		const seg = el('span', 'fin-seg');
		seg.style.width = `${(p.lord / total) * taken}%`;
		seg.style.background = colorOf(p.pid);
		seg.title = `${p.name}: ${fmtNum(p.lord)}`;
		bar.appendChild(seg);
	}
	s.appendChild(bar);
	const who = players.map((p) => `${p.name} ${fmtNum(p.lord)} (${Math.round((p.lord / total) * 100)}%)`).join(' · ');
	const extra = [
		f.lastHit ? `последний удар — ${f.lastHit}` : '',
		who ? `урон по Владыке: ${who}` : '',
		f.rageAt !== null && f.rageAt !== undefined ? `ярость на ${Math.round(f.rageAt)}-й с` : '',
		f.revived ? `лучом поднято ${f.revived}` : '',
	].filter(Boolean);
	if (extra.length) s.appendChild(el('p', 'res-note', extra.join(' · ')));
	return s;
}

function eventsBlock() {
	const ev = cur.events ?? [], bosses = cur.bosses ?? [];
	if (!ev.length && !bosses.length) return null;
	const s = sec('Боссы и события');
	const rows = [
		...bosses.map(([name, at, secs, absorbed]) => [at, name, secs !== null ? `убит за ${Math.round(secs)} с` : absorbed ? 'поглощён Владыкой' : 'не убит', secs !== null ? true : absorbed ? null : false]),
		...ev.map(([name, at, res, ok]) => [at, name, res, ok ?? null]),
	].sort((a, b) => a[0] - b[0]);
	const ul = el('ul', 'res-list res-events');
	for (const [at, name, res, ok] of rows) {
		const li = el('li', ok === true ? 'ok' : ok === false ? 'bad' : '');
		const what = el('span', 'ev-what');
		what.append(el('b', '', name), el('span', 'muted', ` — ${res}`));
		li.append(el('span', 'ev-time', mmss(at)), el('span', 'ev-icon', ok === true ? '✓' : ok === false ? '✗' : '•'), what);
		ul.appendChild(li);
	}
	s.appendChild(ul);
	return s;
}

function select(pid) {
	// Tabs carry the pid as a string in data-pid; the card has numbers.
	const p = cur?.players.find((x) => String(x.pid) === String(pid));
	const box = $('over-player');
	if (!p || !box) return;
	sel = p.pid;
	pid = p.pid;
	for (const b of document.querySelectorAll('#over-card .res-tab')) {
		const on = b.dataset.pid === String(pid);
		b.classList.toggle('on', on);
		b.setAttribute('aria-selected', String(on));
	}
	box.textContent = '';
	box.style.setProperty('--c', colorOf(pid));
	const head = el('div', 'pl-head');
	head.append(mark(p.hero, colorOf(pid)), el('b', '', p.name), el('span', 'muted', `${p.heroName} · ур. ${p.level}${STATE[p.state] ? ` · ${STATE[p.state]}` : ''}`));
	box.appendChild(head);
	// The three numbers players asked for, big.
	const big = el('div', 'pl-big');
	bigTile(big, p.downs, `${plural(p.downs, 'раз падал', 'раза падал', 'раз падал')}`, p.downs ? 'bad' : 'good');
	bigTile(big, p.lifted, `${plural(p.lifted, 'раз', 'раза', 'раз')} подняли`, p.lifted ? 'warn' : '');
	bigTile(big, p.revives, `${plural(p.revives, 'раз', 'раза', 'раз')} поднял сам`, p.revives ? 'good' : '');
	box.appendChild(big);
	const nums = el('div', 'pl-nums');
	const num = (v, label) => {
		const t = el('span');
		t.append(el('b', '', v), document.createTextNode(` ${label}`));
		nums.appendChild(t);
	};
	num(fmtNum(p.kills), 'убийств');
	num(fmtNum(p.dmg), 'урона');
	num(fmtNum(p.taken), 'принял');
	num(`${p.minHp ?? '—'}/${p.maxHp}`, 'мин. здоровье');
	if (p.lord) num(fmtNum(p.lord), 'по Владыке');
	if (p.drops) num(String(p.drops), 'обрыв связи');
	box.appendChild(nums);

	const ws = sec('Урон по оружию');
	const max = Math.max(1, ...p.weapons.map((w) => w[1]));
	p.weapons.forEach(([name, dmg, pct], i) => {
		const row = el('div', 'res-bar');
		const top = el('div', 'res-bar-top');
		top.append(el('span', 'res-bar-name', `${i === 0 ? '★ ' : ''}${name}`), el('span', 'res-bar-val', `${fmtNum(dmg)} · ${Math.round(pct)}%`));
		const tr = el('div', 'res-track');
		const fill = el('i');
		fill.style.width = `${Math.max(2, (dmg / max) * 100)}%`;
		tr.appendChild(fill);
		row.append(top, tr);
		ws.appendChild(row);
	});
	if (!p.weapons.length) ws.appendChild(el('p', 'res-note', 'Урона нет'));
	box.appendChild(ws);

	if ((p.dpm?.length ?? 0) > 0) {
		const cs = sec('По минутам');
		const cv = el('canvas', 'res-canvas');
		cv.setAttribute('role', 'img');
		cv.setAttribute('aria-label', `Урон в секунду по минутам: ${p.dpm.join(', ')}; минимум здоровья: ${(p.hpm ?? []).join(', ')}`);
		const leg = el('div', 'res-legend');
		leg.append(el('span', 'res-key res-key-dmg', 'урон в секунду'), el('span', 'res-key res-key-hp', 'минимум здоровья'), el('span', 'res-key res-key-down', 'падение'));
		cs.append(cv, leg);
		box.appendChild(cs);
	}

	const best = [];
	if (p.bestHit) best.push(['💥', `Самый сильный удар: ${fmtNum(p.bestHit[0])} (${p.bestHit[1]})`, p.bestHit[2]]);
	if (p.streak) best.push(['🔥', `Лучшая серия: ${p.streak[0]} ${plural(p.streak[0], 'убийство', 'убийства', 'убийств')} за 10 с`, p.streak[1]]);
	for (const [at, name, kind] of p.fused ?? []) best.push([kind === 'evo' ? '★' : '⚭', `${kind === 'evo' ? 'Эволюция' : 'Связка'}: ${name}`, at]);
	for (const [at, name] of p.ovr ?? []) best.push(['⚙', `Разгон: ${name}`, at]);
	for (const t of p.downsAt ?? []) best.push(['✝', 'Упал', t]);
	for (const t of p.liftedAt ?? []) best.push(['✚', 'Подняли', t]);
	if (best.length) {
		const ms = sec('Лучшие моменты и хронология');
		const ul = el('ul', 'res-list moments');
		best.sort((a, b) => (a[2] ?? 0) - (b[2] ?? 0));
		for (const [icon, text, at] of best) {
			const li = el('li', icon === '✝' ? 'bad' : '');
			li.append(el('span', 'ev-time', mmss(at)), el('span', 'ev-icon', icon), el('span', '', text));
			ul.appendChild(li);
		}
		ms.appendChild(ul);
		if (p.embers) ms.appendChild(el('p', 'res-note', `Углей взято: ${p.embers}`));
		box.appendChild(ms);
	}
	if (p.takenTop?.length) {
		const ts = sec('Больше всего били');
		const ul = el('ul', 'res-list');
		for (const [name, v] of p.takenTop) {
			const li = el('li');
			const what = el('span', 'ev-what');
			what.append(el('span', '', name), el('span', 'muted', ` — ${fmtNum(v)}`));
			li.appendChild(what);
			ul.appendChild(li);
		}
		ts.appendChild(ul);
		box.appendChild(ts);
	}
	drawCharts();
}

function drawCharts() {
	const p = cur?.players.find((x) => x.pid === sel);
	const cv = document.querySelector('#over-player canvas.res-canvas');
	if (p && cv) drawChart(cv, p, colorOf(p.pid));
}

export const cardText = (c) => (card(c) ? resultsText(c) : '');
export const cardImage = (c, cols) => resultsCanvas(c, (pid) => (cols instanceof Map && cols.get(pid)) || '#90a4ae');

// Damage per second as bars, the minute's lowest health as a line (share of max health), downs as red ticks.
function drawChart(cv, p, color) {
	const w = Math.max(160, Math.round(cv.clientWidth || 300)), h = 96;
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	cv.width = Math.round(w * dpr);
	cv.height = Math.round(h * dpr);
	cv.style.height = `${h}px`;
	const g = cv.getContext('2d');
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	g.clearRect(0, 0, w, h);
	const dpm = p.dpm ?? [], hpm = p.hpm ?? [];
	const n = Math.max(dpm.length, hpm.length, 1);
	const top = 12, bot = h - 14, ch = bot - top, bw = w / n;
	g.strokeStyle = 'rgba(255,255,255,0.08)';
	g.beginPath();
	for (const f of [0, 0.5, 1]) { g.moveTo(0, top + ch * f + 0.5); g.lineTo(w, top + ch * f + 0.5); }
	g.stroke();
	const maxD = Math.max(1, ...dpm);
	g.fillStyle = color;
	g.globalAlpha = 0.55;
	dpm.forEach((v, i) => {
		const bh = (v / maxD) * ch;
		g.fillRect(i * bw + bw * 0.15, bot - bh, bw * 0.7, bh);
	});
	g.globalAlpha = 1;
	if (hpm.length) {
		g.strokeStyle = '#81c784';
		g.lineWidth = 2;
		g.beginPath();
		hpm.forEach((v, i) => {
			const y = bot - Math.max(0, Math.min(1, v / (p.maxHp || 1))) * ch;
			const x = i * bw + bw / 2;
			if (i) g.lineTo(x, y); else g.moveTo(x, y);
		});
		g.stroke();
	}
	g.fillStyle = '#ef5350';
	for (const t of p.downsAt ?? []) {
		const x = Math.min(w - 2, (t / 60) * bw);
		g.fillRect(x - 1, top, 2, ch);
	}
	g.fillStyle = 'rgba(232,233,243,0.6)';
	g.font = '10px system-ui, sans-serif';
	g.textBaseline = 'top';
	g.fillText(`${fmtNum(maxD)}/с`, 2, 0);
	g.textBaseline = 'bottom';
	const step = n > 10 ? 5 : n > 5 ? 2 : 1;
	for (let i = 0; i < n; i += step) g.fillText(String(i + 1), i * bw + bw / 2 - 3, h);
}

// Text for a chat message.
export function resultsText(c) {
	const out = [];
	const len = c.len || modeOf(c.mode).seconds;
	out.push(`🌙 Ночная орда — ${TITLE(c)} (${modeOf(c.mode).name}, ${mmss(c.time)} из ${mmss(len)})`);
	const g = c.group ?? {};
	out.push(`Убито ${fmtNum(c.kills)} · падений ${g.downs ?? 0}${c.players.length > 1 ? ` · подняли друг друга ${times(g.revives ?? 0)}` : ''}`);
	const f = c.fin;
	if (f) {
		const taken = Math.round((1 - (f.hpLeft ?? 0)) * 100);
		out.push(f.grade === 2 ? `👑 Бой с Владыкой — ${Math.round(f.sec)} с` : `Владыка: снято ${taken}% здоровья`);
	}
	for (const a of c.awards ?? []) out.push(`${a.icon} ${a.title}: ${a.name} — ${a.text}`);
	out.push('');
	for (const p of c.players) {
		const top = p.weapons[0] ? `, лучшее — ${p.weapons[0][0]} ${Math.round(p.weapons[0][2])}%` : '';
		out.push(`${p.name} (${p.heroName}, ур. ${p.level}): убийств ${fmtNum(p.kills)}, урон ${fmtNum(p.dmg)}${top}; падал ${p.downs}, поднимали ${p.lifted}, поднял ${p.revives}`);
	}
	if (c.id) out.push('', `Лог #${c.id}`);
	return out.join('\n');
}

// The PNG card: a fixed 1080 px wide canvas, height by the number of players and awards.
export function resultsCanvas(c, colorOf) {
	const W = 1080, pad = 56;
	const awards = (c.awards ?? []).slice(0, 8);
	const H = 360 + (c.fin ? 90 : 0) + Math.ceil(awards.length / 2) * 92 + c.players.length * 104 + 90;
	const cv = document.createElement('canvas');
	cv.width = W;
	cv.height = H;
	const g = cv.getContext('2d');
	const bg = g.createLinearGradient(0, 0, 0, H);
	bg.addColorStop(0, '#151827');
	bg.addColorStop(1, '#0b0d14');
	g.fillStyle = bg;
	g.fillRect(0, 0, W, H);
	const font = (px, w = 600) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
	const text = (s, x, y, px, color = '#e8e9f3', w = 600, align = 'left', maxW) => {
		g.font = font(px, w);
		g.fillStyle = color;
		g.textAlign = align;
		g.fillText(s, x, y, maxW);
	};
	g.textBaseline = 'alphabetic';
	const titleColor = c.grade === 2 ? '#ffe082' : c.win ? '#ffb74d' : '#ef5350';
	text('НОЧНАЯ ОРДА', W / 2, 70, 26, '#8d92ad', 700, 'center');
	if (c.grade === 2) {
		g.shadowColor = 'rgba(255,193,7,0.8)';
		g.shadowBlur = 24;
	}
	text(TITLE(c), W / 2, 140, 64, titleColor, 900, 'center');
	g.shadowBlur = 0;
	const len = c.len || modeOf(c.mode).seconds;
	text(`${modeOf(c.mode).name} · ${mmss(c.time)} из ${mmss(len)} · игроков: ${c.players.length}`, W / 2, 186, 26, '#8d92ad', 500, 'center');
	const g2 = c.group ?? {};
	const tiles = [[fmtNum(c.kills), 'убито'], [String(g2.downs ?? 0), 'падений'], [String(g2.revives ?? 0), 'подъёмов']];
	const tw = (W - pad * 2 - 40) / 3;
	tiles.forEach(([v, l], i) => {
		const x = pad + i * (tw + 20);
		g.fillStyle = 'rgba(255,255,255,0.05)';
		roundRect(g, x, 216, tw, 100, 16);
		g.fill();
		text(v, x + tw / 2, 270, 46, i === 1 && (g2.downs ?? 0) > 0 ? '#ef9a9a' : '#e8e9f3', 800, 'center');
		text(l, x + tw / 2, 302, 22, '#8d92ad', 500, 'center');
	});
	let y = 360;
	if (c.fin) {
		const f = c.fin, taken = Math.max(0, Math.min(1, 1 - (f.hpLeft ?? 0)));
		text(f.grade === 2 ? `👑 Владыка повержен за ${Math.round(f.sec)} с${f.lastHit ? ` — добил ${f.lastHit}` : ''}` : `Владыка: снято ${Math.round(taken * 100)}%`, pad, y + 6, 28, f.grade === 2 ? '#ffe082' : '#e8e9f3', 700, 'left', W - pad * 2);
		g.fillStyle = 'rgba(0,0,0,0.5)';
		roundRect(g, pad, y + 26, W - pad * 2, 24, 12);
		g.fill();
		const ps = c.players.filter((p) => p.lord > 0).sort((a, b) => b.lord - a.lord);
		const tot = ps.reduce((s, p) => s + p.lord, 0) || 1;
		let x = pad;
		g.save();
		roundRect(g, pad, y + 26, W - pad * 2, 24, 12);
		g.clip();
		for (const p of ps) {
			const sw = (p.lord / tot) * taken * (W - pad * 2);
			g.fillStyle = colorOf(p.pid);
			g.fillRect(x, y + 26, sw, 24);
			x += sw;
		}
		g.restore();
		y += 90;
	}
	const aw = (W - pad * 2 - 20) / 2;
	awards.forEach((a, i) => {
		const x = pad + (i % 2) * (aw + 20), yy = y + Math.floor(i / 2) * 92;
		g.fillStyle = 'rgba(255,183,77,0.08)';
		roundRect(g, x, yy, aw, 78, 14);
		g.fill();
		g.fillStyle = colorOf(a.pid);
		g.fillRect(x, yy + 12, 5, 54);
		text(a.icon, x + 44, yy + 50, 34, '#ffe082', 400, 'center');
		text(a.title, x + 80, yy + 32, 24, '#ffb74d', 800, 'left', aw - 96);
		text(`${a.name} — ${a.text}`, x + 80, yy + 62, 20, '#c5c8dc', 500, 'left', aw - 96);
	});
	y += Math.ceil(awards.length / 2) * 92 + (awards.length ? 10 : 0);
	for (const p of c.players) {
		g.fillStyle = 'rgba(255,255,255,0.04)';
		roundRect(g, pad, y, W - pad * 2, 90, 14);
		g.fill();
		g.fillStyle = colorOf(p.pid);
		g.beginPath();
		g.arc(pad + 34, y + 45, 16, 0, Math.PI * 2);
		g.fill();
		text(p.name, pad + 66, y + 38, 28, '#e8e9f3', 800, 'left', 380);
		text(`${p.heroName} · ур. ${p.level}${p.weapons[0] ? ` · ${p.weapons[0][0]} ${Math.round(p.weapons[0][2])}%` : ''}`, pad + 66, y + 70, 20, '#8d92ad', 500, 'left', 400);
		const cols = [[fmtNum(p.kills), 'убийств'], [fmtShort(p.dmg), 'урон'], [String(p.downs), 'падал'], [String(p.lifted), 'подняли'], [String(p.revives), 'поднял']];
		cols.forEach(([v, l], i) => {
			const cx = 560 + i * 94;
			text(v, cx, y + 44, 28, i === 2 && p.downs ? '#ef9a9a' : '#e8e9f3', 800, 'center', 92);
			text(l, cx, y + 70, 17, '#8d92ad', 500, 'center', 92);
		});
		y += 104;
	}
	text(`Лог #${c.id ?? '—'} · ${c.v ?? ''}`, W / 2, H - 36, 20, '#5d6280', 500, 'center');
	return cv;
}

function roundRect(g, x, y, w, h, r) {
	g.beginPath();
	g.moveTo(x + r, y);
	g.arcTo(x + w, y, x + w, y + h, r);
	g.arcTo(x + w, y + h, x, y + h, r);
	g.arcTo(x, y + h, x, y, r);
	g.arcTo(x, y, x + w, y, r);
	g.closePath();
}
