// DOM screens, HUD, level-up panel, toasts.
import { HEROES, WEAPONS, PASSIVES, MAX_PLAYERS } from '/shared/content.js';
import { drawHeroPreview } from './render.js';
import { P } from './game.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
	const n = document.createElement(tag);
	if (cls) n.className = cls;
	if (text !== undefined) n.textContent = text;
	return n;
}

export function fmtTime(sec) {
	const s = Math.max(0, Math.floor(sec));
	return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

export class UI {
	constructor() {
		this.screen = null;
		this.screens = { menu: $('screen-menu'), lobby: $('screen-lobby'), over: $('screen-over') };
		this.hud = $('hud');
		this.levelup = $('levelup');
		this.cache = Object.create(null);
		this.heroCards = new Map();
		this.offerKey = '';
		this.onPick = null;
		this.onHero = null;
	}

	show(name) {
		this.screen = name;
		for (const [k, node] of Object.entries(this.screens)) node.hidden = k !== name;
		this.hud.hidden = name !== 'game' && name !== 'over';
		if (name !== 'game') this.hideOffer();
		$('connecting').hidden = true;
	}

	setConnecting(on) {
		$('connecting').hidden = !on || this.screen !== null;
	}

	toast(msg, kind = 'error') {
		const box = $('toasts');
		const n = el('div', 'toast' + (kind === 'info' ? ' info' : ''), msg);
		box.appendChild(n);
		while (box.children.length > 4) box.firstChild.remove();
		setTimeout(() => n.remove(), 3300);
	}

	banner(text) {
		const b = $('banner');
		b.hidden = true;
		b.textContent = text;
		void b.offsetWidth; // restart the CSS animation
		b.hidden = false;
		clearTimeout(this.bannerTimer);
		this.bannerTimer = setTimeout(() => { b.hidden = true; }, 2700);
	}

	setNet(transport, ping, connected) {
		const n = $('netinfo');
		n.textContent = connected ? `${transport || '…'} · ${ping === null ? '—' : ping + ' мс'}` : 'нет связи…';
		n.classList.toggle('bad', !connected || ping > 250);
	}

	// Menu

	renderRooms(rooms, onJoin) {
		const list = $('menu-rooms');
		list.textContent = '';
		const open = (Array.isArray(rooms) ? rooms : []).filter((r) => !r.state || r.state === 'lobby');
		if (!open.length) {
			list.appendChild(el('li', 'empty', 'Пока никого — создайте свою комнату'));
			return;
		}
		for (const r of open) {
			const li = el('li');
			li.appendChild(el('span', 'room-code-sm', r.code));
			li.appendChild(el('span', 'grow', r.host ? `хост: ${r.host}` : ''));
			li.appendChild(el('span', 'tag', `${r.players ?? '?'}/${MAX_PLAYERS}`));
			const btn = el('button', 'btn btn-small', 'Войти');
			btn.addEventListener('click', () => onJoin(r.code));
			li.appendChild(btn);
			list.appendChild(li);
		}
	}

	// Lobby

	buildHeroCards(selected) {
		const grid = $('lobby-heroes');
		grid.textContent = '';
		for (const [id, h] of Object.entries(HEROES)) {
			const card = el('button', 'hero-card');
			card.type = 'button';
			card.style.setProperty('--hero-color', h.color);
			const cv = document.createElement('canvas');
			card.appendChild(cv);
			card.appendChild(el('div', 'hero-name', h.name));
			card.appendChild(el('div', 'hero-desc', h.desc));
			const w = WEAPONS[h.weapon];
			card.appendChild(el('div', 'hero-weapon', w ? `${w.icon} ${w.name}` : ''));
			card.appendChild(el('div', 'hero-stats', `❤ ${h.hp} · ➜ ${h.speed}`));
			if (h.traitDesc) card.appendChild(el('div', 'hero-trait', `★ ${h.traitDesc}`));
			card.addEventListener('click', () => this.onHero && this.onHero(id));
			grid.appendChild(card);
			this.heroCards.set(id, { card, cv });
		}
		this.selectHero(selected, '#90a4ae');
	}

	selectHero(id, color) {
		for (const [hid, { card, cv }] of this.heroCards) {
			card.classList.toggle('selected', hid === id);
			drawHeroPreview(cv, hid, hid === id ? color : '#5c6378');
		}
	}

	renderLobby(lobby, me) {
		$('lobby-code').textContent = lobby.code || '—';
		const players = Array.isArray(lobby.players) ? lobby.players : [];
		$('lobby-count').textContent = `${players.length}/${MAX_PLAYERS}`;
		const list = $('lobby-players');
		list.textContent = '';
		let myReady = false;
		for (const p of players) {
			const li = el('li');
			const dot = el('span', 'dot');
			dot.style.background = p.color;
			dot.style.color = p.color;
			li.appendChild(dot);
			li.appendChild(el('span', 'grow', p.name));
			const hero = HEROES[p.hero];
			if (hero) li.appendChild(el('span', 'tag', hero.name));
			if (p.pid === lobby.host) li.appendChild(el('span', 'tag tag-host', 'хост'));
			if (p.pid === me) li.appendChild(el('span', 'tag tag-me', 'вы'));
			li.appendChild(el('span', p.ready ? 'tag tag-ready' : 'tag', p.ready ? '✓ готов' : 'не готов'));
			list.appendChild(li);
			if (p.pid === me) {
				myReady = !!p.ready;
				this.selectHero(p.hero, p.color);
			}
		}
		const isHost = lobby.host === me;
		const readyBtn = $('lobby-ready');
		readyBtn.textContent = myReady ? '✓ Готов' : 'Готов';
		readyBtn.classList.toggle('btn-on', myReady);
		$('lobby-start').hidden = !isHost;
		const notReady = players.filter((p) => !p.ready).length;
		$('lobby-hint').textContent = isHost
			? (notReady ? `Не готовы: ${notReady}. Можно начать и так.` : 'Все готовы — начинайте!')
			: 'Игру запускает хост.';
		return myReady;
	}

	// Level-up panel

	showOffer(offer) {
		const choices = Array.isArray(offer.choices) ? offer.choices : [];
		const key = choices.map((c) => `${c.kind}:${c.id}:${c.level}`).join('|');
		const pending = offer.pending | 0;
		$('levelup-pending').textContent = pending > 0 ? `(+${pending} в очереди)` : '';
		if (key === this.offerKey && !this.levelup.hidden) return;
		this.offerKey = key;
		const box = $('levelup-cards');
		box.textContent = '';
		choices.forEach((c, i) => {
			const card = el('button', 'card');
			card.type = 'button';
			card.appendChild(el('span', 'card-key', String(i + 1)));
			card.appendChild(el('span', 'card-kind', c.kind === 'weapon' ? 'оружие' : c.kind === 'passive' ? 'усиление' : ''));
			const def = c.kind === 'weapon' ? WEAPONS[c.id] : c.kind === 'passive' ? PASSIVES[c.id] : null;
			card.appendChild(el('div', 'card-icon', c.icon || def?.icon || '?'));
			card.appendChild(el('div', 'card-name', c.name || def?.name || c.id));
			if (c.kind !== 'heal') {
				card.appendChild(c.level <= 1
					? el('div', 'card-level card-new', 'Новое!')
					: el('div', 'card-level', `Ур. ${c.level}`));
			}
			card.appendChild(el('div', 'card-desc', c.desc || def?.desc || ''));
			card.addEventListener('click', () => this.onPick && this.onPick(i));
			box.appendChild(card);
		});
		box.style.gridTemplateColumns = `repeat(${Math.max(1, choices.length)}, 1fr)`;
		this.levelup.hidden = false;
	}

	hideOffer() {
		this.levelup.hidden = true;
		this.offerKey = '';
	}

	// Game over

	renderOver(msg, me, isHost) {
		const title = $('over-title');
		title.textContent = msg.win ? 'Победа!' : 'Орда победила';
		title.className = 'over-title ' + (msg.win ? 'win' : 'lose');
		$('over-sub').textContent = msg.win
			? `Вы продержались ${fmtTime(msg.time)}`
			: `Продержались ${fmtTime(msg.time)}`;
		const body = $('over-stats');
		body.textContent = '';
		const stats = (Array.isArray(msg.stats) ? msg.stats : []).slice().sort((a, b) => (b.kills | 0) - (a.kills | 0));
		for (const s of stats) {
			const tr = el('tr', s.pid === me ? 'me' : '');
			const name = el('td');
			const dot = el('span', 'dot');
			dot.style.background = s.color || '#90a4ae';
			dot.style.color = s.color || '#90a4ae';
			name.appendChild(dot);
			name.appendChild(el('span', '', s.name));
			tr.appendChild(name);
			tr.appendChild(el('td', '', HEROES[s.hero]?.name || '—'));
			tr.appendChild(el('td', 'num', String(s.level ?? '—')));
			tr.appendChild(el('td', 'num', String(s.kills | 0)));
			tr.appendChild(el('td', 'num', String(Math.round(s.dmg || 0))));
			body.appendChild(tr);
		}
		$('over-again').hidden = !isHost;
	}

	// HUD (writes to the DOM only when values change)

	set(id, prop, value) {
		const key = id + '.' + prop;
		if (this.cache[key] === value) return;
		this.cache[key] = value;
		const n = $(id);
		if (prop === 'text') n.textContent = value;
		else if (prop === 'width') n.style.width = value;
		else if (prop === 'hidden') n.hidden = value;
	}

	updateHud(game) {
		const snap = game.latest();
		this.set('hud-time', 'text', fmtTime(game.view.tm));
		if (!snap) return;
		this.set('hud-kills', 'text', String(snap.k));
		const row = snap.pMap.get(game.me);
		if (row) {
			const xpNext = row[P.xpNext] || 1;
			this.set('hud-xp-fill', 'width', `${Math.min(100, (row[P.xp] / xpNext) * 100).toFixed(1)}%`);
			this.set('hud-level', 'text', `Ур. ${row[P.level]}`);
			const hp = Math.max(0, row[P.hp]);
			const maxHp = row[P.maxHp] || 1;
			this.set('hud-hp-fill', 'width', `${Math.min(100, (hp / maxHp) * 100).toFixed(1)}%`);
			this.set('hud-hp-text', 'text', `${Math.ceil(hp)} / ${maxHp}`);
			this.set('hud-down', 'hidden', row[P.st] !== 1);
			const w = Array.isArray(row[P.w]) ? row[P.w] : [];
			const wKey = JSON.stringify(w);
			if (this.cache.weapons !== wKey) {
				this.cache.weapons = wKey;
				fillIcons($('hud-weapons'), w.map(([id, lvl]) => [WEAPONS[id]?.icon || '?', lvl, WEAPONS[id]?.name || id]));
			}
		}
		const pKey = JSON.stringify(game.passives);
		if (this.cache.passives !== pKey) {
			this.cache.passives = pKey;
			fillIcons($('hud-passives'), Object.entries(game.passives).map(([id, lvl]) => [PASSIVES[id]?.icon || '?', lvl, PASSIVES[id]?.name || id]));
		}

		// Allies.
		const allies = [];
		for (const r of snap.p) {
			if (r[P.pid] === game.me) continue;
			const m = game.meta(r[P.pid]);
			allies.push(`${r[P.pid]}:${m.name}:${r[P.st]}:${Math.round((r[P.hp] / (r[P.maxHp] || 1)) * 20)}`);
		}
		const aKey = allies.join('|');
		if (this.cache.allies !== aKey) {
			this.cache.allies = aKey;
			const ul = $('hud-allies');
			ul.textContent = '';
			for (const r of snap.p) {
				if (r[P.pid] === game.me) continue;
				const m = game.meta(r[P.pid]);
				const down = r[P.st] === 1;
				const li = el('li', down ? 'down' : '');
				const dot = el('span', 'dot');
				dot.style.background = m.color;
				li.appendChild(dot);
				li.appendChild(el('span', 'nm', (down ? '✝ ' : '') + m.name));
				const bar = el('div', 'bar');
				const fill = el('i');
				fill.style.width = `${down ? 0 : Math.max(0, Math.min(100, (r[P.hp] / (r[P.maxHp] || 1)) * 100))}%`;
				bar.appendChild(fill);
				li.appendChild(bar);
				ul.appendChild(li);
			}
		}

		// Boss.
		const boss = snap.boss;
		this.set('hud-boss', 'hidden', !boss);
		if (boss) this.set('hud-boss-fill', 'width', `${Math.max(0, Math.min(100, (boss[0] / (boss[1] || 1)) * 100)).toFixed(1)}%`);
	}

	resetHud() {
		this.cache = Object.create(null);
		$('hud-weapons').textContent = '';
		$('hud-passives').textContent = '';
		$('hud-allies').textContent = '';
		$('hud-boss').hidden = true;
		$('hud-down').hidden = true;
		$('banner').hidden = true;
	}

	setBossName(name) {
		$('hud-boss-name').textContent = name || 'Босс';
	}
}

function fillIcons(box, items) {
	box.textContent = '';
	for (const [icon, lvl, title] of items) {
		const d = el('div', 'hud-icon', icon);
		d.title = title;
		d.appendChild(el('b', '', String(lvl)));
		box.appendChild(d);
	}
}
