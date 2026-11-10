// DOM screens, HUD, level-up panel, toasts.
import { ENEMIES, ENEMY_TYPES, HEROES, WEAPONS, PASSIVES, MAX_PLAYERS, MAX_WEAPONS, MAX_PASSIVES, DUOS, DUO_BY_PAIR, duoKey, weaponDef, ROMAN, EVOS, EVO_BY_WEAPON } from '/shared/content.js';

// Duos the player has ever opened (per browser): unknown ones show as «???» in card hints.
const DUO_STORE = 'nh.duos';
export function knownDuos() {
	try { return new Set(JSON.parse(localStorage.getItem(DUO_STORE) || '[]')); } catch { return new Set(); }
}
export function rememberDuo(id) {
	const set = knownDuos();
	const isNew = !set.has(id);
	set.add(id);
	try { localStorage.setItem(DUO_STORE, JSON.stringify([...set])); } catch { /* private mode */ }
	return isNew;
}
const lvlText = (id, lvl) => (EVOS[id] ? '★' : DUOS[id] ? ROMAN[lvl - 1] || String(lvl) : String(lvl));
import { drawHeroPreview } from './render.js';
import { sprites } from './sprites.js';
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
		this.heroSel = null;
		this.walkTimer = 0;
		this.lastLobby = null;
		this.lastOver = null;
		// Portraits switch from vector icons to sprites once the atlas arrives.
		sprites.whenReady(() => {
			if (this.heroSel) this.selectHero(this.heroSel.id, this.heroSel.color);
			if (this.lastLobby) this.renderLobby(...this.lastLobby);
			if (this.lastOver) this.renderOver(...this.lastOver);
			this.cache.allies = '';
		});
		this.offerKey = '';
		this.onPick = null;
		this.onHero = null;
		this.onReroll = null;
		this.onSkip = null;
		$('levelup-reroll').addEventListener('click', () => this.onReroll && this.onReroll());
		$('levelup-skip').addEventListener('click', () => this.onSkip && this.onSkip());
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
			const pic = el('div', 'hero-pic');
			const cv = document.createElement('canvas');
			const img = el('img', 'portrait');
			img.alt = '';
			img.hidden = true;
			pic.append(cv, img);
			card.appendChild(pic);
			card.appendChild(el('div', 'hero-name', h.name));
			card.appendChild(el('div', 'hero-desc', h.desc));
			const w = WEAPONS[h.weapon];
			card.appendChild(el('div', 'hero-weapon', w ? `${w.icon} ${w.name}` : ''));
			card.appendChild(el('div', 'hero-stats', `❤ ${h.hp} · ➜ ${h.speed}`));
			if (h.traitDesc) card.appendChild(el('div', 'hero-trait', `★ ${h.traitDesc}`));
			card.addEventListener('click', () => this.onHero && this.onHero(id));
			grid.appendChild(card);
			this.heroCards.set(id, { card, cv, img });
		}
		this.selectHero(selected, '#90a4ae');
	}

	selectHero(id, color) {
		this.heroSel = { id, color };
		const live = sprites.ready;
		for (const [hid, { card, cv, img }] of this.heroCards) {
			const c = hid === id ? color : '#5c6378';
			card.classList.toggle('selected', hid === id);
			const url = live && sprites.portrait(hid, c, 0);
			cv.hidden = !!url;
			img.hidden = !url;
			if (url) img.src = url;
			else drawHeroPreview(cv, hid, c);
		}
		this.animateSelected();
	}

	// Walk cycle on the selected card while the lobby is open.
	animateSelected() {
		clearInterval(this.walkTimer);
		this.walkTimer = 0;
		const sel = this.heroSel && this.heroCards.get(this.heroSel.id);
		const sheet = sel && sprites.ready && sprites.get(this.heroSel.id);
		if (!sheet || sheet.walk < 2) return;
		let f = 0;
		this.walkTimer = setInterval(() => {
			if (this.screen !== 'lobby' || !sel.card.isConnected) {
				clearInterval(this.walkTimer);
				this.walkTimer = 0;
				return;
			}
			f = (f + 1) % sheet.walk;
			sel.img.src = sprites.portrait(this.heroSel.id, this.heroSel.color, f);
		}, 1000 / (sheet.fps || 8));
	}

	renderLobby(lobby, me) {
		this.lastLobby = [lobby, me];
		$('lobby-code').textContent = lobby.code || '—';
		const players = Array.isArray(lobby.players) ? lobby.players : [];
		$('lobby-count').textContent = `${players.length}/${MAX_PLAYERS}`;
		const list = $('lobby-players');
		list.textContent = '';
		let myReady = false;
		for (const p of players) {
			const li = el('li');
			li.appendChild(heroMark(p.hero, p.color));
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
		const key = choices.map((c) => `${c.kind}:${c.id}:${c.level}`).join('|') + JSON.stringify(offer.slots);
		const sl = Array.isArray(offer.slots) ? offer.slots : null;
		const pending = offer.pending | 0;
		$('levelup-pending').textContent = pending > 0 ? `(+${pending} в очереди)` : '';
		const rerolls = offer.rerolls | 0;
		$('levelup-rerolls').textContent = `(${rerolls})`;
		$('levelup-reroll').disabled = rerolls <= 0;
		$('levelup-skipxp').textContent = offer.skipXp ? `(+${offer.skipXp} опыта)` : '';
		const [wUsed, wMax, pUsed, pMax] = Array.isArray(offer.slots) ? offer.slots : [0, MAX_WEAPONS, 0, MAX_PASSIVES];
		$('levelup-slots').textContent = `Оружие ${wUsed}/${wMax} · Артефакты ${pUsed}/${pMax}`;
		if (key === this.offerKey && !this.levelup.hidden) return;
		this.offerKey = key;
		const box = $('levelup-cards');
		box.textContent = '';
		const known = knownDuos();
		choices.forEach((c, i) => {
			if (c.kind === 'duo') {
				box.appendChild(this.duoCard(c, i));
				return;
			}
			if (c.kind === 'evo') {
				box.appendChild(this.evoCard(c, i));
				return;
			}
			const card = el('button', c.kind === 'rare' ? 'card card-rare' : c.kind === 'ember' ? 'card card-ember' : DUOS[c.id] ? 'card card-duo-up' : 'card');
			card.type = 'button';
			card.appendChild(el('span', 'card-key', String(i + 1)));
			card.appendChild(el('span', 'card-kind', c.kind === 'weapon' ? (DUOS[c.id] ? 'связка' : 'оружие') : c.kind === 'passive' ? 'артефакт' : c.kind === 'rare' ? 'редкое' : c.kind === 'ember' ? 'угли' : ''));
			const def = c.kind === 'weapon' ? weaponDef(c.id) : c.kind === 'passive' ? PASSIVES[c.id] : null;
			card.appendChild(el('div', 'card-icon', c.icon || def?.icon || '?'));
			card.appendChild(el('div', 'card-name', c.name || def?.name || c.id));
			if (c.kind === 'weapon' || c.kind === 'passive') {
				// A new pick costs a slot: show which one it takes.
				const slot = sl ? (c.kind === 'weapon' ? ` · слот ${sl[0] + 1}/${sl[1]}` : ` · слот ${sl[2] + 1}/${sl[3]}`) : '';
				card.appendChild(c.level <= 1
					? el('div', 'card-level card-new', 'Новое!' + slot)
					: el('div', 'card-level', `Ур. ${lvlText(c.id, c.level)}`));
			}
			card.appendChild(el('div', 'card-desc', c.desc || def?.desc || ''));
			if (c.kind === 'ember') card.appendChild(el('div', 'card-level', `×${c.level}`));
			// Weapons at 4–5 show what they evolve into.
			const evoId = c.kind === 'weapon' && c.level >= 4 ? EVO_BY_WEAPON[c.id] : null;
			if (evoId) card.appendChild(el('div', 'card-hint', `⚡ эволюция с «${PASSIVES[EVOS[evoId].requires].name}» на 5 ур.`));
			if (c.kind === 'passive') {
				const evo = Object.values(EVOS).find((E) => E.requires === c.id);
				if (evo && c.level === 1) card.appendChild(el('div', 'card-hint', `⚡ эволюция: ${WEAPONS[evo.from].name} 5 ур.`));
			}
			if (c.duoHint) {
				const h = c.duoHint;
				const name = known.has(h.id) ? h.name : '???';
				card.appendChild(el('div', 'card-hint', `🔗 с «${h.withName}» → ${name} (нужно ${h.need} + ${h.need})`));
			}
			card.addEventListener('click', () => this.onPick && this.onPick(i));
			box.appendChild(card);
		});
		box.style.gridTemplateColumns = `repeat(${Math.max(1, choices.length)}, 1fr)`;
		this.levelup.hidden = false;
	}

	// Duo card: both part icons merge into the duo icon; the price is spelled out.
	duoCard(c, i) {
		const card = el('button', 'card card-duo');
		card.type = 'button';
		card.appendChild(el('span', 'card-key', String(i + 1)));
		card.appendChild(el('span', 'card-kind', 'связка'));
		const icons = el('div', 'card-icon duo-icons');
		const [ia, ib] = c.partIcons || ['?', '?'];
		icons.appendChild(el('span', 'duo-part duo-a', ia));
		icons.appendChild(el('span', 'duo-main', c.icon || '?'));
		icons.appendChild(el('span', 'duo-part duo-b', ib));
		card.appendChild(icons);
		card.appendChild(el('div', 'card-name', c.name));
		card.appendChild(el('div', 'card-level card-new', `Связка: ${(c.partNames || []).join(' + ')} · Ур. ${ROMAN[c.level - 1] || c.level}`));
		card.appendChild(el('div', 'card-desc', c.desc || ''));
		card.appendChild(el('div', 'card-hint', '⇄ освобождает слот оружия'));
		card.appendChild(el('div', 'card-warn', '⚠ эти оружия не смогут эволюционировать'));
		card.addEventListener('click', () => this.onPick && this.onPick(i));
		return card;
	}

	// Evolution card: weapon + artifact → evolved weapon.
	evoCard(c, i) {
		const card = el('button', 'card card-evo');
		card.type = 'button';
		card.appendChild(el('span', 'card-key', String(i + 1)));
		card.appendChild(el('span', 'card-kind', 'эволюция'));
		const icons = el('div', 'card-icon duo-icons');
		icons.appendChild(el('span', 'duo-part duo-a', c.fromIcon || '?'));
		icons.appendChild(el('span', 'duo-main', c.icon || '?'));
		icons.appendChild(el('span', 'duo-part duo-b', c.reqIcon || '?'));
		card.appendChild(icons);
		card.appendChild(el('div', 'card-name', c.name));
		card.appendChild(el('div', 'card-level card-new', `Эволюция: ${c.fromName} + ${c.reqName}`));
		card.appendChild(el('div', 'card-desc', c.desc || ''));
		card.appendChild(el('div', 'card-warn', '⚠ оружие не сможет войти в связку'));
		card.addEventListener('click', () => this.onPick && this.onPick(i));
		return card;
	}

	// The weapon row flashes when a duo forms.
	flashWeapons() {
		const box = $('hud-weapons');
		box.classList.remove('duo-flash');
		void box.offsetWidth;
		box.classList.add('duo-flash');
	}

	hideOffer() {
		this.levelup.hidden = true;
		this.offerKey = '';
	}

	// Game over

	renderOver(msg, me, isHost) {
		this.lastOver = [msg, me, isHost];
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
			name.appendChild(heroMark(s.hero, s.color || '#90a4ae'));
			name.appendChild(el('span', '', s.name));
			tr.appendChild(name);
			tr.appendChild(el('td', '', HEROES[s.hero]?.name || '—'));
			tr.appendChild(el('td', 'num', String(s.level ?? '—')));
			tr.appendChild(el('td', 'num', String(s.kills | 0)));
			tr.appendChild(el('td', 'num', String(Math.round(s.dmg || 0))));
			body.appendChild(tr);
		}
		$('over-again').hidden = !isHost;
		const log = msg.log && typeof msg.log === 'object' ? msg.log : null;
		this.runLog = log;
		$('over-log').hidden = !log;
		$('over-runid').textContent = log ? `Лог #${log.id}` : '';
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
				const box = $('hud-weapons');
				fillIcons(box, w.map(([id, lvl]) => [weaponDef(id)?.icon || '?', lvlText(id, lvl), weaponDef(id)?.name || id, EVOS[id] ? 'hud-icon-evo' : DUOS[id] ? 'hud-icon-duo' : '']), `${w.length}/${MAX_WEAPONS}`, 'Слоты оружия');
				drawDuoLinks(box, w);
			}
		}
		const pKey = JSON.stringify(game.passives);
		if (this.cache.passives !== pKey) {
			this.cache.passives = pKey;
			const ps = Object.entries(game.passives);
			fillIcons($('hud-passives'), ps.map(([id, lvl]) => [PASSIVES[id]?.icon || '?', lvl, PASSIVES[id]?.name || id]), `${ps.length}/${MAX_PASSIVES}`, 'Слоты артефактов');
		}

		this.set('hud-syn', 'hidden', !(game.syn > 0));
		if (game.syn > 0) this.set('hud-syn', 'text', `Слаженность +${game.syn}%`);

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
				li.appendChild(heroMark(m.hero, m.color));
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
		if (boss && boss[2] !== undefined) this.set('hud-boss-name', 'text', ENEMIES[ENEMY_TYPES[boss[2]]]?.name || 'Босс');
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

// Player marker: hero portrait in the player's colour, or the old colour dot until the atlas loads.
function heroMark(hero, color) {
	const url = hero && sprites.ready ? sprites.portrait(hero, color, 0) : null;
	if (url) {
		const img = el('img', 'portrait portrait-sm');
		img.alt = '';
		img.src = url;
		return img;
	}
	const dot = el('span', 'dot');
	dot.style.background = color;
	dot.style.color = color;
	return dot;
}

function fillIcons(box, items, slots, slotsTitle) {
	box.textContent = '';
	if (slots) {
		const s = el('span', 'hud-slots', slots);
		s.title = slotsTitle;
		box.appendChild(s);
	}
	for (const [icon, lvl, title, cls] of items) {
		const d = el('div', cls ? `hud-icon ${cls}` : 'hud-icon', icon);
		d.title = title;
		d.appendChild(el('b', '', String(lvl)));
		box.appendChild(d);
	}
}

// Thin lines between owned weapons that form a duo: dim, pulsing at 2 + 2, glowing at 3 + 3.
function drawDuoLinks(box, w) {
	const icons = [...box.querySelectorAll('.hud-icon')];
	for (let i = 0; i < w.length; i++) {
		for (let j = i + 1; j < w.length; j++) {
			if (DUOS[w[i][0]] || DUOS[w[j][0]] || !DUO_BY_PAIR[duoKey(w[i][0], w[j][0])]) continue;
			const a = icons[i], b = icons[j];
			if (!a || !b) continue;
			const ax = a.offsetLeft + a.offsetWidth / 2, ay = a.offsetTop + a.offsetHeight + 3;
			const bx = b.offsetLeft + b.offsetWidth / 2, by = b.offsetTop + b.offsetHeight + 3;
			const len = Math.hypot(bx - ax, by - ay);
			const lo = Math.min(w[i][1], w[j][1]);
			const line = el('i', 'duo-link' + (lo >= 3 ? ' ready' : lo >= 2 ? ' warm' : ''));
			line.style.left = ax + 'px';
			line.style.top = ay + 'px';
			line.style.width = len + 'px';
			line.style.transform = `rotate(${Math.atan2(by - ay, bx - ax)}rad)`;
			line.title = DUOS[DUO_BY_PAIR[duoKey(w[i][0], w[j][0])]].name;
			box.appendChild(line);
		}
	}
}
