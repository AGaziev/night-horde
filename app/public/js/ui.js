// DOM screens, HUD, level-up panel, toasts.
import { ENEMIES, ENEMY_TYPES, HEROES, HERO_PERKS, WEAPONS, PASSIVES, MAX_PLAYERS, MAX_WEAPONS, MAX_PASSIVES, DUOS, DUO_BY_PAIR, duoKey, weaponDef, ROMAN, EVOS, EVO_BY_WEAPON, RARITIES, MODES, MODE_IDS, modeOf, modeLabel, UNLOCKS, unlockProgress, ALTAR_DEALS, OVERCLOCKS, EMBERS, forgeRecipe, ROLES, AFFINITY, AFFINITY_IDS, affinityOf } from '/shared/content.js';
import { HORDE_RULESET, HORDE_MAX_HEROES } from '/shared/horde-content.js';

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
// v22: duos the server knows for a portal user join the browser's list.
export function rememberDuos(ids) {
	if (!Array.isArray(ids) || !ids.length) return;
	const set = knownDuos();
	for (const id of ids) if (DUOS[id]) set.add(id);
	try { localStorage.setItem(DUO_STORE, JSON.stringify([...set])); } catch { /* private mode */ }
}
const CHEST_REVEAL_MS = 600; // boss chest: one card every 0.6 s
const lvlText = (id, lvl) => (EVOS[id] ? '★' : DUOS[id] ? ROMAN[lvl - 1] || String(lvl) : String(lvl));
import { drawHeroPreview } from './render.js';
import { sprites } from './sprites.js';
import { P, canBan } from './game.js';
import { renderResults } from './results.js';

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

// HUD pill of the active Wave 4 event; the phase changes what the group should do now.
function eventLabel(ev) {
	switch (ev.def.id) {
		case 'star': return ev.phase ? 'Осколок звезды' : 'Звезда падает';
		case 'altar': return `Алтарь: ${ALTAR_DEALS[ev.a]?.name ?? ''}`;
		case 'cursed': return ev.phase ? 'Продержитесь' : 'Проклятый сундук';
		case 'streak': return `Серия ${ev.a}/${ev.b}`;
		default: return ev.def.name;
	}
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

	banner(text, cls = '') {
		const b = $('banner');
		b.hidden = true;
		b.textContent = text;
		b.className = cls ? `banner ${cls}` : 'banner';
		void b.offsetWidth; // restart the CSS animation
		b.hidden = false;
		clearTimeout(this.bannerTimer);
		this.bannerTimer = setTimeout(() => { b.hidden = true; }, cls ? 3500 : 2700);
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
			if (r.ruleset === HORDE_RULESET) {
				li.appendChild(el('span', 'tag tag-mode', 'Орда · 15 мин'));
				li.appendChild(el('span', 'tag', `Герои ${r.heroCount ?? 0}/${HORDE_MAX_HEROES}`));
				li.appendChild(el('span', 'tag', r.directorPresent ? 'Орда занята' : 'Орда свободна'));
			} else {
				li.appendChild(el('span', 'tag tag-mode', modeOf(r.mode).short));
				li.appendChild(el('span', 'tag', `${r.players ?? '?'}/${MAX_PLAYERS}`));
			}
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
			const perk = HERO_PERKS[id];
			if (perk) card.appendChild(el('div', 'hero-trait', `★ ${perk.name}. ${perk.desc}`));
			if (h.traitDesc) card.appendChild(el('div', 'hero-trait', `★ ${h.traitDesc}`));
			const lock = el('span', 'hero-lock', '🔒');
			const cond = el('div', 'hero-cond');
			card.append(lock, cond);
			card.addEventListener('click', () => this.onHero && this.onHero(id));
			grid.appendChild(card);
			this.heroCards.set(id, { card, cv, img, lock, cond });
		}
		this.selectHero(selected, '#90a4ae');
	}

	// Locked heroes: padlock, the condition and the progress towards it.
	// v21: Lords slain so far (browser totals) — the crown next to the own name in the menu and the lobby.
	setLords(n) {
		this.lords = Math.max(0, n | 0);
		const c = $('menu-crown');
		c.hidden = !this.lords;
		c.textContent = this.lords ? `👑 ${this.lords}` : '';
		c.title = 'Владыка ночи повержен, раз: ' + this.lords;
		if (this.lastLobby) this.renderLobby(...this.lastLobby);
	}

	// v22: top 10 of the week (the server keeps everyone's best run); hidden while the storage is off.
	setBoard(on) {
		$('top').hidden = !on;
	}

	renderTop(msg) {
		const list = $('top-list');
		list.textContent = '';
		$('top-note').textContent = msg.week ? `Неделя ${msg.week.split('-W')[1]} · лучший забег каждого` : '';
		if (!Array.isArray(msg.rows)) {
			list.appendChild(el('li', 'empty', msg.off ? 'Рекорды недели сейчас недоступны' : 'Загрузка…'));
			return;
		}
		if (!msg.rows.length) {
			list.appendChild(el('li', 'empty', 'На этой неделе ещё никто не встретил рассвет — будьте первым'));
			return;
		}
		msg.rows.forEach((r, i) => {
			const li = el('li', r.me ? 'me' : '');
			li.appendChild(el('span', 'top-n', String(i + 1)));
			const mark = el('span', 'top-mark', r.lord ? '👑' : r.win ? '☀' : '✝');
			mark.title = r.lord ? 'Владыка повержен' : r.win ? 'Ночь пережита' : 'Отряд пал';
			li.appendChild(mark);
			const who = el('span', 'top-who', r.name);
			who.appendChild(el('small', '', `${HEROES[r.hero]?.name ?? ''}${r.players > 1 ? ` · отряд ${r.players}` : ''}`));
			li.appendChild(who);
			li.appendChild(el('span', 'top-res', `${MODES[r.mode]?.short ?? ''} ${fmtTime(r.time)} · ${r.kills}`));
			list.appendChild(li);
		});
	}

	setUnlocks(unlocked, stats) {
		for (const [id, { card, lock, cond }] of this.heroCards) {
			const open = unlocked.has(id);
			card.classList.toggle('locked', !open);
			card.setAttribute('aria-disabled', String(!open));
			lock.hidden = open;
			cond.hidden = open;
			if (open || !UNLOCKS[id]) continue;
			const u = UNLOCKS[id];
			cond.textContent = unlockProgress(id, stats);
			const bar = el('span', 'hero-cond-bar');
			const fill = el('i');
			fill.style.width = `${Math.min(100, ((+stats?.[u.stat] || 0) / u.need) * 100).toFixed(0)}%`;
			bar.appendChild(fill);
			cond.appendChild(bar);
			card.title = `Закрыт: ${u.text.toLowerCase()}`;
		}
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

	// v24 «Книга связок»: every duo, the known ones with names; the six affinity rules by roles.
	renderDuoBook() {
		const known = knownDuos();
		const key = [...known].sort().join(',');
		if (this.bookKey === key) return;
		this.bookKey = key;
		const ids = Object.keys(DUOS);
		$('duo-book-count').textContent = `${ids.filter((id) => known.has(id)).length} / ${ids.length}`;
		const grid = $('duo-book-grid');
		grid.textContent = '';
		for (const id of ids) {
			const D = DUOS[id], open = known.has(id);
			const cell = el('div', open ? 'duo-cell open' : 'duo-cell');
			cell.appendChild(el('div', 'duo-cell-icon', open ? D.icon : '?'));
			cell.appendChild(el('div', 'duo-cell-name', open ? D.name : 'не открыта'));
			cell.appendChild(el('div', 'duo-cell-parts', D.parts.map((p) => `${WEAPONS[p].icon} ${WEAPONS[p].name}`).join(' + ')));
			cell.title = open ? D.desc : 'Ещё не открыта: возьмите оба оружия до 3-го уровня';
			grid.appendChild(cell);
		}
		const aff = $('duo-book-aff');
		aff.textContent = '';
		for (const id of AFFINITY_IDS) {
			const A = AFFINITY[id];
			const li = el('li');
			li.appendChild(el('b', '', `${A.roles.map((r) => ROLES[r].icon).join(' + ')} ${A.name}`));
			li.appendChild(el('span', 'muted', ` — ${A.desc}`));
			aff.appendChild(li);
		}
		const roles = el('li', 'muted');
		roles.textContent = Object.entries(ROLES).map(([r, R]) => `${R.icon} ${R.name}: ${Object.values(WEAPONS).filter((W) => W.role === r).map((W) => W.name).join(', ')}`).join('; ');
		aff.appendChild(roles);
	}

	renderLobby(lobby, me) {
		this.lastLobby = [lobby, me];
		$('lobby-code').textContent = lobby.code || '—';
		const players = Array.isArray(lobby.players) ? lobby.players : [];
		const horde = lobby.ruleset === HORDE_RULESET;
		const heroes = players.filter((p) => p.role !== 'director');
		const director = players.find((p) => p.role === 'director');
		const mine = players.find((p) => p.pid === me);
		$('lobby-count').textContent = horde ? `${heroes.length}/${HORDE_MAX_HEROES} героев · ${director ? 1 : 0}/1 за орду` : `${players.length}/${MAX_PLAYERS}`;
		const list = $('lobby-players');
		list.textContent = '';
		let myReady = false;
		for (const p of players) {
			const li = el('li');
			const isDirector = horde && p.role === 'director';
			li.appendChild(isDirector ? el('span', 'director-mark', '☠') : heroMark(p.hero, p.color));
			li.appendChild(el('span', 'grow', p.name));
			const hero = HEROES[p.hero];
			if (isDirector) li.appendChild(el('span', 'tag tag-mode', 'За орду'));
			else if (hero) li.appendChild(el('span', 'tag', hero.name));
			if (p.pid === lobby.host) li.appendChild(el('span', 'tag tag-host', 'хост'));
			if (p.pid === me) li.appendChild(el('span', 'tag tag-me', 'вы'));
			if (p.pid === me && this.lords > 0) {
				const crown = el('span', 'tag tag-crown', `👑 ${this.lords}`);
				crown.title = 'Владыка ночи повержен, раз: ' + this.lords;
				li.appendChild(crown);
			}
			li.appendChild(el('span', p.ready ? 'tag tag-ready' : 'tag', p.ready ? '✓ готов' : 'не готов'));
			list.appendChild(li);
			if (p.pid === me) {
				myReady = !!p.ready;
				if (!isDirector) this.selectHero(p.hero, p.color);
			}
		}
		const isHost = lobby.host === me;
		this.renderRuleset(horde, isHost);
		$('lobby-pve-mode').hidden = horde;
		$('lobby-role-box').hidden = !horde;
		$('lobby-hero-box').hidden = horde && mine?.role === 'director';
		$('duo-book').hidden = horde && mine?.role === 'director';
		if (horde) this.renderRole(mine?.role || 'hero', director, heroes.length, me);
		this.renderMode(lobby.mode, isHost);
		this.renderDuoBook();
		const readyBtn = $('lobby-ready');
		readyBtn.textContent = myReady ? '✓ Готов' : 'Готов';
		readyBtn.classList.toggle('btn-on', myReady);
		$('lobby-start').hidden = !isHost;
		const rolesReady = !horde || (!!director && heroes.length >= 1 && heroes.length <= HORDE_MAX_HEROES);
		$('lobby-start').disabled = !rolesReady;
		const notReady = players.filter((p) => !p.ready).length;
		$('lobby-hint').textContent = !rolesReady ? 'Для начала нужен один игрок за орду и от 1 до 4 героев.' : isHost
			? (notReady ? `Не готовы: ${notReady}. Можно начать и так.` : 'Все готовы — начинайте!')
			: 'Игру запускает хост.';
		return myReady;
	}

	renderRuleset(horde, isHost) {
		const box = $('lobby-ruleset');
		if (!box.childElementCount) {
			for (const [id, name, desc] of [['pve', 'Вместе против ночи', 'Обычный забег против компьютерной орды'], [HORDE_RULESET, 'Орда против героев', 'Один игрок за орду против 1–4 героев · 15 минут']]) {
				const b = el('button', 'btn mode-btn');
				b.type = 'button'; b.dataset.ruleset = id; b.setAttribute('role', 'radio');
				b.append(el('b', '', name), el('span', '', desc));
				b.addEventListener('click', () => this.onRuleset?.(id));
				box.appendChild(b);
			}
		}
		for (const b of box.children) {
			const on = (b.dataset.ruleset === HORDE_RULESET) === horde;
			b.classList.toggle('selected', on); b.setAttribute('aria-checked', String(on)); b.disabled = !isHost;
		}
		$('lobby-ruleset-hint').textContent = horde ? 'Герои побеждают, убив босса или продержавшись 15 минут. Орда побеждает, если все герои падут.' : (isHost ? 'Правила выбирает хост комнаты.' : 'Правила игры выбирает хост.');
	}

	renderRole(role, director, heroCount, me) {
		const box = $('lobby-role');
		if (!box.childElementCount) {
			for (const [id, name, desc] of [['hero', 'Герой', 'Двигайтесь, собирайте опыт и улучшайте оружие'], ['director', 'За орду', 'Выбирайте отряды, места атаки и улучшения']]) {
				const b = el('button', 'btn mode-btn');
				b.type = 'button'; b.dataset.role = id; b.setAttribute('role', 'radio');
				b.append(el('b', '', name), el('span', '', desc));
				b.addEventListener('click', () => this.onRole?.(id));
				box.appendChild(b);
			}
		}
		for (const b of box.children) {
			const on = b.dataset.role === role;
			b.classList.toggle('selected', on); b.setAttribute('aria-checked', String(on));
			b.disabled = !on && (b.dataset.role === 'director' ? !!director && director.pid !== me : heroCount >= HORDE_MAX_HEROES);
		}
		$('lobby-role-hint').textContent = `${director ? `За орду: ${director.name}` : 'Место за орду свободно'} · героев ${heroCount}/${HORDE_MAX_HEROES}.`;
	}

	renderMode(mode, isHost) {
		const box = $('lobby-mode');
		const cur = modeOf(mode).id;
		if (!box.childElementCount) {
			for (const id of MODE_IDS) {
				const M = MODES[id];
				const b = el('button', 'btn mode-btn');
				b.type = 'button';
				b.dataset.mode = id;
				b.setAttribute('role', 'radio');
				b.appendChild(el('b', '', `${M.name} · ${Math.round(M.seconds / 60)} мин`));
				b.appendChild(el('span', '', id === 'lunch' ? 'Короткий забег на перерыв' : 'Пять боссов и рассвет'));
				b.addEventListener('click', () => this.onMode && this.onMode(id));
				box.appendChild(b);
			}
		}
		for (const b of box.children) {
			const on = b.dataset.mode === cur;
			b.classList.toggle('selected', on);
			b.setAttribute('aria-checked', String(on));
			b.disabled = !isHost;
		}
		$('lobby-mode-hint').textContent = isHost ? 'Режим видят все в комнате' : `Режим выбирает хост: ${modeLabel(cur)}`;
	}

	// Solo pause overlay.
	showPause(on) {
		$('pause').hidden = !on;
		if (on) {
			$('pause-sub').textContent = this.modeText || '';
			$('pause-resume').focus({ preventScroll: true });
		}
	}

	// Level-up panel

	// Returns true when a new set of cards was drawn (for the legendary sound).
	showOffer(offer) {
		if (offer?.closed || !Array.isArray(offer?.choices) || !offer.choices.length) {
			this.hideOffer();
			return false;
		}
		const choices = offer.choices;
		const key = choices.map((c) => `${c.kind}:${c.id}:${c.level}:${c.rar ?? ''}:${c.donor ?? ''}:${c.draft ?? ''}`).join('|') + JSON.stringify(offer.slots);
		const sl = Array.isArray(offer.slots) ? offer.slots : null;
		const pending = offer.pending | 0;
		$('levelup-pending').textContent = pending > 0 ? `(+${pending} в очереди)` : '';
		const rerolls = offer.rerolls | 0;
		$('levelup-rerolls').textContent = `(${rerolls})`;
		$('levelup-reroll').disabled = rerolls <= 0;
		$('levelup-skipxp').textContent = offer.skipXp ? `(+${offer.skipXp} опыта)` : '';
		const [wUsed, wMax, pUsed, pMax] = Array.isArray(offer.slots) ? offer.slots : [0, MAX_WEAPONS, 0, MAX_PASSIVES];
		$('levelup-slots').textContent = `Оружие ${wUsed}/${wMax} · Артефакты ${pUsed}/${pMax}`;
		// v20 «Изгнать»: charges on every card button, also when the same cards are sent again (a feather was picked up).
		const bans = offer.bans | 0;
		this.bans = bans;
		for (const b of document.querySelectorAll('#levelup-cards .card-ban')) this.banLabel(b, false);
		if (key === this.offerKey && !this.levelup.hidden) return false;
		this.offerKey = key;
		this.setBanMode(false);
		const box = $('levelup-cards');
		box.textContent = '';
		// Boss chest (`spin`): the cards are revealed one by one, CHEST_REVEAL_MS apart; a hidden card cannot be taken.
		for (const t of this.revealTimers ?? []) clearTimeout(t);
		this.revealTimers = [];
		const spin = !!offer.spin && choices.length > 0;
		const swap = choices[0]?.kind === 'swap';
		const forge = choices[0]?.kind === 'imprint';
		const now = performance.now();
		this.readyAt = choices.map((_, i) => (spin ? now + CHEST_REVEAL_MS * (i + 1) : 0));
		$('levelup-title-text').textContent = swap ? 'Алтарь: замена артефакта' : forge ? 'Кузня свойств' : spin ? 'Сундук босса!' : 'Новый уровень!';
		const known = knownDuos();
		const add = (card, c, i) => {
			const wrap = el('div', spin ? 'card-wrap card-veil' : 'card-wrap');
			wrap.appendChild(card);
			if (canBan(c)) {
				const b = el('button', 'card-ban');
				b.type = 'button';
				this.banLabel(b, false);
				b.addEventListener('click', () => {
					if (!this.cardReady(i) || !(this.bans > 0)) return;
					// Two taps: the first one arms the button, so a slip on a phone does not banish a card.
					if (!b.classList.contains('armed')) {
						for (const o of box.querySelectorAll('.card-ban.armed')) this.banLabel(o, false);
						this.banLabel(b, true);
						clearTimeout(this.banArmT);
						this.banArmT = setTimeout(() => this.banLabel(b, false), 3000);
						return;
					}
					this.onBan && this.onBan(i);
				});
				wrap.appendChild(b);
			}
			if (spin) {
				this.revealTimers.push(setTimeout(() => {
					wrap.classList.remove('card-veil');
					wrap.classList.add('card-reveal');
					this.onReveal && this.onReveal(i, c);
				}, CHEST_REVEAL_MS * (i + 1)));
			}
			box.appendChild(wrap);
		};
		choices.forEach((c, i) => {
			if (c.kind === 'swap') {
				const card = el('div', 'card card-evo');
				card.appendChild(el('div', 'card-icon', c.icon));
				card.appendChild(el('div', 'card-name', c.name));
				card.appendChild(el('div', 'card-desc', c.desc));
				const select = el('select', 'card-swap-select');
				select.setAttribute('aria-label', 'Какой артефакт отдать');
				select.appendChild(new Option('Какой артефакт отдать?', ''));
				for (const { id, name, level } of c.replace) select.appendChild(new Option(`${name} · ур. ${level}`, id));
				const replace = el('button', 'btn card-swap-button', 'Заменить');
				replace.type = 'button';
				replace.disabled = true;
				select.addEventListener('change', () => { replace.disabled = !select.value; });
				replace.addEventListener('click', () => this.onPick?.(i, select.value));
				card.append(select, replace);
				add(card, c, i);
				return;
			}
			if (c.kind === 'imprint') {
				const card = el('button', 'card card-evo');
				card.type = 'button';
				card.appendChild(el('span', 'card-key', String(i + 1)));
				card.appendChild(el('span', 'card-kind', 'кузня'));
				card.appendChild(el('div', 'card-icon', c.icon));
				card.appendChild(el('div', 'card-name', c.name));
				card.appendChild(el('div', 'card-level', `Кузня: ${c.carrierName} принимает свойство «${c.donorName}»`));
				card.appendChild(el('div', 'card-desc', c.desc));
				card.appendChild(el('div', 'card-warn', `«${c.donorName}» освобождает слот. Носитель сохраняет уровень, но больше не эволюционирует и не входит в связку.`));
				card.addEventListener('click', () => this.onPick?.(i));
				add(card, c, i);
				return;
			}
			if (c.kind === 'duo') {
				add(this.duoCard(c, i), c, i);
				return;
			}
			if (c.kind === 'evo') {
				add(this.evoCard(c, i), c, i);
				return;
			}
			if (c.kind === 'ovr') {
				add(this.ovrCard(c, i), c, i);
				return;
			}
			const R = RARITIES[c.kind === 'rare' && c.id === 'forge' ? 3 : c.rar];
			const card = el('button', (c.kind === 'rare' ? 'card card-rare' : c.kind === 'ember' ? 'card card-ember' : DUOS[c.id] ? 'card card-duo-up' : 'card') + (R ? ` rar rar-${R.id}` : ''));
			card.type = 'button';
			card.appendChild(el('span', 'card-key', String(i + 1)));
			const role = c.kind === 'weapon' ? ROLES[WEAPONS[c.id]?.role] : null; // v24: the role decides the affinity
			card.appendChild(el('span', 'card-kind', c.kind === 'weapon' ? (DUOS[c.id] ? 'связка' : 'оружие' + (role ? ` · ${role.icon} ${role.name}` : '')) : c.kind === 'passive' ? 'артефакт' : c.kind === 'rare' ? 'перековка' : c.kind === 'ember' ? 'угли' : ''));
			const def = c.kind === 'weapon' ? weaponDef(c.id) : c.kind === 'passive' ? PASSIVES[c.id] : null;
			card.appendChild(el('div', 'card-icon', c.icon || def?.icon || '?'));
			card.appendChild(el('div', 'card-name', c.name || def?.name || c.id));
			if (R) card.appendChild(el('div', 'card-rarity', R.name));
			if (c.kind === 'weapon' || c.kind === 'passive') {
				// A new pick costs a slot: show which one it takes.
				const slot = sl ? (c.kind === 'weapon' ? ` · слот ${sl[0] + 1}/${sl[1]}` : ` · слот ${sl[2] + 1}/${sl[3]}`) : '';
				const from = c.from ?? c.level - 1;
				const jump = c.level - from > 1 ? ` (+${c.level - from})` : '';
				card.appendChild(from <= 0
					? el('div', 'card-level card-new', 'Новое!' + (c.level > 1 ? ` Ур. ${c.level}` : '') + slot)
					: el('div', 'card-level', `Ур. ${jump ? `${from}→` : ''}${lvlText(c.id, c.level)}${jump}`));
			}
			card.appendChild(el('div', 'card-desc', c.desc || def?.desc || ''));
			if (c.kind === 'ember') card.appendChild(el('div', 'card-level', `×${c.level}`));
			if (c.draft) card.appendChild(el('div', 'card-hint card-hint-rec', c.draft === 'fit' ? '★ Для текущей сборки' : '↗ Другое направление'));
			if (c.rec) card.appendChild(el('div', 'card-hint card-hint-rec', c.rec === 2 ? '★ рекомендуем: оружия мало для середины забега' : '★ рекомендуем: одного оружия мало'));
			if (c.rerolls > 0) card.appendChild(el('div', 'card-hint', `🎲 +${c.rerolls} «Перебросить»`));
			// Weapons at 4–5 show what they evolve into.
			const evoId = c.kind === 'weapon' && c.level >= 4 ? EVO_BY_WEAPON[c.id] : null;
			if (evoId) card.appendChild(el('div', 'card-hint', `⚡ эволюция с «${PASSIVES[EVOS[evoId].requires].name}» на 5 ур.`));
			if (c.kind === 'passive') {
				const evo = Object.values(EVOS).find((E) => E.requires === c.id);
				if (evo && c.level === 1) card.appendChild(el('div', 'card-hint', `⚡ эволюция: ${WEAPONS[evo.from].name} 5 ур.`));
			}
			let hints = 0;
			if (c.forgeHint) {
				card.appendChild(el('div', 'card-hint', `⚒ кузня с «${c.forgeHint.withName}» на ${c.forgeHint.need} + ${c.forgeHint.need} ур.`));
				hints++;
			}
			for (const h of c.duoHints ?? (c.duoHint ? [c.duoHint] : [])) {
				const name = known.has(h.id) ? h.name : '???';
				card.appendChild(el('div', 'card-hint', `🔗 с «${h.withName}» → ${name} (нужно ${h.need} + ${h.need})`));
				hints++;
			}
			if (c.reactHint) {
				card.appendChild(el('div', 'card-hint card-hint-react', `💥 реакция «${c.reactHint.name}» с «${c.reactHint.withName}»${c.reactHint.ally ? ' союзника' : ''}`));
				hints++;
			}
			if (c.synHint) {
				card.appendChild(el('div', 'card-hint', `✦ с «${c.synHint.withName}»: ${c.synHint.desc}`));
				hints++;
			}
			// v24 affinity: one line, only while the card has room (a duo is worth more).
			if (c.affHint && hints < 3) {
				const A = AFFINITY[c.affHint.id];
				const line = el('div', 'card-hint card-hint-aff', `≈ сродство с «${c.affHint.withName}»: ${A.name}`);
				line.title = A.desc;
				card.appendChild(line);
			}
			if (c.pairHint) card.appendChild(el('div', 'card-hint card-hint-react', `✦ с «${c.pairHint.withName}»${c.pairHint.ally ? ' союзника' : ''}: ${c.pairHint.desc}`));
			card.addEventListener('click', () => this.onPick && this.onPick(i));
			add(card, c, i);
		});
		box.style.gridTemplateColumns = `repeat(${Math.max(1, choices.length)}, 1fr)`;
		this.levelup.hidden = false;
		return true;
	}

	// v20. Overclock card: the weapon's icon, the variant's name and its one-line description.
	ovrCard(c, i) {
		const card = el('button', 'card card-ovr');
		card.type = 'button';
		card.appendChild(el('span', 'card-key', String(i + 1)));
		card.appendChild(el('span', 'card-kind', 'разгон'));
		card.appendChild(el('div', 'card-icon', c.icon || WEAPONS[c.id]?.icon || '?'));
		card.appendChild(el('div', 'card-name', c.name || OVERCLOCKS[c.id]?.[c.v - 1]?.name || 'Разгон'));
		card.appendChild(el('div', 'card-level card-ovr-of', `Разгон: ${c.wName || WEAPONS[c.id]?.name || ''}`));
		card.appendChild(el('div', 'card-desc', c.desc || ''));
		card.appendChild(el('div', 'card-hint', '⚙ один разгон на оружие, до конца забега'));
		card.addEventListener('click', () => this.onPick && this.onPick(i));
		return card;
	}

	banLabel(b, armed) {
		b.classList.toggle('armed', armed);
		b.disabled = !(this.bans > 0);
		b.textContent = armed ? 'Точно убрать?' : `🚫 Изгнать (${this.bans | 0})`;
		b.title = 'Убрать эту карточку из выбора до конца забега (B, затем номер карточки)';
	}

	// B on the keyboard: the next card tap or digit banishes instead of picking.
	setBanMode(on) {
		this.banMode = !!on;
		this.levelup.classList.toggle('ban-mode', this.banMode);
		$('levelup-banhint').hidden = !this.banMode;
	}

	// False while a boss chest card is still face down.
	cardReady(i) {
		return !(this.readyAt?.[i] > performance.now());
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
		if (c.loseOvr?.length) card.appendChild(el('div', 'card-warn', `⚠ разгон «${c.loseOvr.join('», «')}» пропадёт`));
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
		if (c.loseOvr?.length) card.appendChild(el('div', 'card-warn', `⚠ разгон «${c.loseOvr.join('», «')}» пропадёт`));
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
		for (const t of this.revealTimers ?? []) clearTimeout(t);
		this.revealTimers = [];
		this.readyAt = [];
		this.setBanMode(false);
	}

	// Game over

	renderOver(msg, me, isHost) {
		this.lastOver = [msg, me, isHost];
		const title = $('over-title');
		// v21: grade 2 — the Lord is slain (gold), 1 — lived to the dawn, 0 — the group fell.
		const grade = msg.grade ?? (msg.win ? 1 : 0);
		const fin = msg.fin && typeof msg.fin === 'object' ? msg.fin : null;
		title.textContent = grade === 2 ? 'Владыка повержен' : msg.win ? 'Ночь пережита' : 'Орда победила';
		title.className = 'over-title ' + (grade === 2 ? 'gold' : msg.win ? 'win' : 'lose');
		const len = msg.len || modeOf(msg.mode).seconds;
		const left = fin && fin.hpLeft > 0 ? Math.max(1, Math.round(fin.hpLeft * 100)) : 0;
		let sub = `${modeOf(msg.mode).name} · ${msg.win ? 'Вы продержались' : 'Продержались'} ${fmtTime(msg.time)} из ${fmtTime(len)}`;
		if (grade === 2 && fin) sub = `${modeOf(msg.mode).name} · рассвет наступил на ${fmtTime(Math.max(0, len - msg.time))} раньше срока · бой ${Math.round(fin.sec)} с${fin.lastHit ? ` · последний удар: ${fin.lastHit}` : ''}`;
		else if (grade === 1 && fin) sub = `${modeOf(msg.mode).name} · Владыка ушёл в тень — у него оставалось ${left}% здоровья`;
		else if (fin) sub += ` · Владыке оставалось ${left}%`;
		$('over-sub').textContent = sub;
		const share = new Map((fin?.by ?? []).map((b) => [b.pid, b.share]));
		$('over-lord-th').hidden = !fin;
		const box = $('over-unlock');
		const fresh = Array.isArray(msg.unlockedNow) ? msg.unlockedNow.filter((id) => HEROES[id]) : [];
		box.hidden = !fresh.length;
		box.textContent = '';
		if (fresh.length) {
			box.appendChild(el('b', '', fresh.length > 1 ? 'Открыты новые герои!' : 'Открыт новый герой!'));
			const row = el('div', 'unlock-heroes');
			for (const id of fresh) {
				const it = el('span', 'unlock-hero');
				it.append(heroMark(id, HEROES[id].color), el('span', '', HEROES[id].name));
				row.appendChild(it);
			}
			box.appendChild(row);
			box.appendChild(el('div', 'muted small', 'Выберите его в лобби перед следующим забегом'));
		}
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
			if (fin) tr.appendChild(el('td', 'num', `${Math.round((share.get(s.pid) ?? 0) * 100)}%`));
			body.appendChild(tr);
		}
		// v23: the results card (group, awards, finale, a tab per player) replaces the plain table when the server sent one.
		this.card = msg.card && typeof msg.card === 'object' ? msg.card : null;
		this.cardColors = new Map(stats.map((s) => [s.pid, s.color || '#90a4ae']));
		const shown = renderResults($('over-card'), this.card, me, this.cardColors);
		$('over-table').hidden = shown;
		$('over-share').hidden = !shown;
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
		else if (prop === 'class') n.className = value;
	}

	updateHud(game) {
		const snap = game.latest();
		this.set('hud-time', 'text', fmtTime(game.view.tm));
		this.set('hud-mode', 'text', this.modeText || '');
		this.set('hud-pause', 'hidden', !game.solo());
		const pk = game.peak();
		// v21 finale: its own line instead of the peak's — the closing ring, then the time left until the dawn.
		const fin = game.finale();
		this.set('hud-peak', 'hidden', !pk && !fin);
		if (fin) {
			this.set('hud-peak', 'text', fin.phase === 1 ? `Тьма смыкается · ${Math.ceil(fin.left)} с` : (fin.phase === 4 ? 'Светает · ' : 'До рассвета ') + fmtTime(Math.ceil(fin.left)));
			this.set('hud-peak', 'class', 'hud-peak hud-fin' + (fin.phase >= 2 && fin.left <= 10 ? ' hud-last' : ''));
		} else {
			this.set('hud-peak', 'class', 'hud-peak');
			if (pk) this.set('hud-peak', 'text', `${pk.def.name} · ${Math.ceil(pk.left)} с`);
		}
		const ev = game.event();
		this.set('hud-event', 'hidden', !ev);
		if (ev) this.set('hud-event', 'text', `${eventLabel(ev)} · ${Math.ceil(ev.left)} с`);
		if (!snap) return;
		const op = snap.op;
		this.set('hud-outposts', 'hidden', !op);
		if (op) {
			const killed = op.posts.reduce((sum, post) => sum + post[3], 0);
			this.set('hud-outposts', 'text', op.status === 'closed' ? '⚑ Аванпосты закрыты · награда упущена'
				: op.status === 'won' ? `⚑ Аванпосты: ${op.cleared}/${op.total} · победа`
				: `⚑ Аванпосты: ${op.cleared}/${op.total} · охрана ${killed}/${op.guards}`);
		}
		this.set('hud-trophy', 'hidden', !game.hasVictoryBanner());

		this.set('hud-kills', 'text', String(snap.k));
		const row = snap.pMap.get(game.me);
		const support = snap.support?.find(([pid]) => pid === game.me)?.[1] ?? 0;
		this.set('hud-support', 'hidden', support <= 0);
		this.set('hud-support', 'text', `Метки: +${support.toLocaleString('ru-RU')} урона`);
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
				// v20: an overclocked weapon (4th field of a plain weapon) gets a violet frame, a mark and the variant in the title.
				fillIcons(box, w.map(([id, lvl, , oc, donor]) => {
					const O = WEAPONS[id] && oc ? OVERCLOCKS[id]?.[oc - 1] : null;
					const F = donor ? forgeRecipe(id, donor) : null;
					const role = ROLES[WEAPONS[id]?.role];
					// v24: affinities of this weapon with the other plain weapons, in the tooltip.
					const aff = w.map(([o]) => [o, affinityOf(id, o)]).filter(([, a]) => a).map(([o, a]) => `${AFFINITY[a].name} с «${WEAPONS[o].name}»`);
					const title = weaponTitle(id) + (O ? ` — разгон «${O.name}»: ${O.desc}` : '') + (F ? ` — кузня «${F.name}»: ${F.desc}` : '')
						+ (role ? `\n${role.icon} ${role.name}` : '') + (aff.length ? `\nСродство: ${aff.join(', ')}` : '');
					return [weaponDef(id)?.icon || '?', lvlText(id, lvl) + (F ? '⚒' : O ? '⚙' : ''), title,
						F || EVOS[id] ? 'hud-icon-evo' : DUOS[id] ? 'hud-icon-duo' : O ? 'hud-icon-ovr' : '', role?.icon];
				}), `${w.length}/${MAX_WEAPONS}`, 'Слоты оружия');
				drawDuoLinks(box, w);
			}
		}
		const pKey = JSON.stringify(game.passives);
		if (this.cache.passives !== pKey) {
			this.cache.passives = pKey;
			const ps = Object.entries(game.passives);
			fillIcons($('hud-passives'), ps.map(([id, lvl]) => [PASSIVES[id]?.icon || '?', lvl, PASSIVES[id] ? `${PASSIVES[id].name} — артефакт. ${PASSIVES[id].desc}` : id]), `${ps.length}/${MAX_PASSIVES}`, 'Слоты артефактов');
		}

		// v20: embers taken so far with their total effect.
		const eKey = JSON.stringify(game.embers ?? {});
		if (this.cache.embers !== eKey) {
			this.cache.embers = eKey;
			const parts = Object.entries(game.embers ?? {}).filter(([id, n]) => EMBERS[id] && n > 0).map(([id, n]) => emberText(id, n));
			const box = $('hud-embers');
			box.hidden = !parts.length;
			box.textContent = '';
			for (const [text, title] of parts) {
				const s = el('span', 'hud-ember', text);
				s.title = title;
				box.appendChild(s);
			}
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
		// The finale Lord: a mark at half hp (rage starts there), the bar turns red in rage.
		this.set('hud-boss', 'class', 'hud-boss' + (boss && fin && fin.phase >= 2 ? ' fin' : '') + (boss && fin && boss[0] <= boss[1] / 2 ? ' rage' : ''));
		if (boss && boss[2] !== undefined) this.set('hud-boss-name', 'text', ENEMIES[ENEMY_TYPES[boss[2]]]?.name || 'Босс');
		if (boss) this.set('hud-boss-fill', 'width', `${Math.max(0, Math.min(100, (boss[0] / (boss[1] || 1)) * 100)).toFixed(1)}%`);
	}

	resetHud() {
		this.cache = Object.create(null);
		$('hud-weapons').textContent = '';
		$('hud-passives').textContent = '';
		$('hud-allies').textContent = '';
		$('hud-embers').hidden = true;
		$('hud-boss').hidden = true;
		$('hud-down').hidden = true;
		$('hud-outposts').hidden = true;
		$('hud-trophy').hidden = true;
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

// «♦×6 +30%»: ember icon, how many were taken and what they add up to.
function emberText(id, n) {
	const E = EMBERS[id];
	const v = E.value * n;
	const total = E.stat === 'maxHp' ? `+${Math.round(v)}` : `${v < 0 ? '−' : '+'}${Math.round(Math.abs(v) * 100)}%`;
	return [`${E.icon}×${n} ${total}`, `${E.name} ×${n}: ${E.desc.replace(/^[+−-]?[\d.,]+%?/, total)}`];
}

// HUD hint of a weapon slot: says it is a weapon, so a shield-like icon (Ward) is not taken for armour.
function weaponTitle(id) {
	const W = weaponDef(id);
	if (!W) return id;
	const d = W.desc.replace(/^Оружие:\s*/, '');
	return `${W.name} — оружие. ${d[0].toUpperCase()}${d.slice(1)}`;
}

function fillIcons(box, items, slots, slotsTitle) {
	box.textContent = '';
	if (slots) {
		const s = el('span', 'hud-slots', slots);
		s.title = slotsTitle;
		box.appendChild(s);
	}
	for (const [icon, lvl, title, cls, badge] of items) {
		const d = el('div', cls ? `hud-icon ${cls}` : 'hud-icon', icon);
		d.title = title;
		d.appendChild(el('b', '', String(lvl)));
		if (badge) d.appendChild(el('i', 'hud-role', badge));
		box.appendChild(d);
	}
}

// Thin lines between owned weapons that form a duo: dim, pulsing at 2 + 2, glowing at 3 + 3.
// v24: with four partners per weapon only the two best pairs (highest lower level) get a line.
function drawDuoLinks(box, w) {
	const icons = [...box.querySelectorAll('.hud-icon')];
	const pairs = [];
	for (let i = 0; i < w.length; i++) {
		for (let j = i + 1; j < w.length; j++) {
			// A weapon carrying an imprint (5th field, Кузня) joins no duo.
			if (w[i][4] || w[j][4] || DUOS[w[i][0]] || DUOS[w[j][0]] || !DUO_BY_PAIR[duoKey(w[i][0], w[j][0])]) continue;
			pairs.push([i, j, Math.min(w[i][1], w[j][1]), w[i][1] + w[j][1]]);
		}
	}
	pairs.sort((x, y) => y[2] - x[2] || y[3] - x[3]);
	for (const [i, j] of pairs.slice(0, 2)) {
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
