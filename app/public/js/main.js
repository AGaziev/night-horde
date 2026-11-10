import { HEROES, ITEMS, ELITE_AFFIXES, DUOS, EVOS, PEAK_WARN, ALTAR_DEALS, MODES, DEFAULT_MODE, modeOf, START_HEROES, mergeAchStats, unlockedHeroes, unlockProgress } from '/shared/content.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { Game, P } from './game.js';
import { Renderer } from './render.js';
import { UI, rememberDuo, fmtTime } from './ui.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const store = {
	get(k) { try { return localStorage.getItem(k); } catch { return null; } },
	set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const net = new Net();
const ui = new UI();
const game = new Game(net);
const canvas = $('game');
const renderer = new Renderer(canvas);
const input = new Input(canvas, $('joystick'));
const sound = new Sound();
game.sound = sound;

// Hero unlocks live in this browser: totals of per-run stats the server sends in `over`.
// ?unlockall=1 opens everyone (debug, remembered); ?unlockall=0 turns it off.
const params = new URLSearchParams(location.search);
if (params.has('unlockall')) store.set('nh.unlockall', params.get('unlockall') === '1' ? '1' : '');
const unlockAll = store.get('nh.unlockall') === '1';
const readJson = (k) => { try { return JSON.parse(store.get(k) || '{}') || {}; } catch { return {}; } };
const ach = { stats: readJson('nh.ach') };
const unlocked = () => new Set(unlockAll ? Object.keys(HEROES) : unlockedHeroes(ach.stats));
const savedHero = store.get('nh.hero');

const state = {
	me: null,
	name: '',
	hero: HEROES[savedHero] && unlocked().has(savedHero) ? savedHero : START_HEROES[0],
	mode: MODES[store.get('nh.mode')] ? store.get('nh.mode') : DEFAULT_MODE,
	lobby: null,
	host: null,
	myReady: false,
	urlRoom: (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase(),
};

function goMenu() {
	game.stop();
	input.setEnabled(false);
	state.lobby = null;
	ui.show('menu');
	sound.setMode('menu');
	net.send({ t: 'list' });
}

function goGame() {
	if (ui.screen !== 'game') {
		ui.resetHud();
		ui.show('game');
	}
	input.setEnabled(true);
	sound.setMode('game');
}

function joinRoom(code) {
	code = String(code || '').trim().toUpperCase();
	if (!code) {
		ui.toast('Введите код комнаты');
		return;
	}
	net.send({ t: 'join', code, hero: state.hero, heroes: [...unlocked()] });
}

// Network events

net.on('status', ({ connected, transport }) => {
	ui.setNet(transport, net.ping, connected);
	ui.setConnecting(!connected);
});
net.on('ping', (ping) => ui.setNet(net.transport, ping, net.connected));

net.on('welcome', (msg) => {
	state.me = msg.pid;
	game.me = msg.pid;
	state.name = msg.name || state.name;
	const wanted = store.get('nh.name');
	if (wanted && wanted !== state.name) {
		net.send({ t: 'name', name: wanted });
		state.name = wanted;
	}
	$('menu-name').value = state.name;
	if (msg.room) return; // the server resends lobby/start for the room
	if (ui.screen === 'game' || ui.screen === 'lobby' || ui.screen === 'over') {
		ui.toast('Связь с комнатой потеряна', 'info');
	}
	goMenu();
	if (state.urlRoom) {
		joinRoom(state.urlRoom);
		state.urlRoom = '';
		history.replaceState(null, '', location.pathname);
	}
});

net.on('rooms', (msg) => {
	ui.renderRooms(msg.rooms, joinRoom);
});

net.on('lobby', (msg) => {
	game.stop();
	input.setEnabled(false);
	state.lobby = msg;
	state.host = msg.host;
	ui.showPause(false);
	if (MODES[msg.mode] && msg.host === state.me) {
		state.mode = msg.mode;
		store.set('nh.mode', msg.mode);
	}
	game.setLobbyPlayers(msg.players);
	if (ui.screen !== 'lobby') ui.show('lobby');
	sound.setMode('lobby');
	state.myReady = ui.renderLobby(msg, state.me);
	const mine = (msg.players || []).find((p) => p.pid === state.me);
	if (mine && HEROES[mine.hero]) state.hero = mine.hero;
});

// A win at dawn holds the field for the burn and the sunrise before the results screen.
const DAWN_HOLD_MS = 3200;
let overTimer = 0;

net.on('start', (msg) => {
	clearTimeout(overTimer);
	game.begin(msg);
	const len = +msg.len || modeOf(msg.mode).seconds;
	ui.modeText = `${modeOf(msg.mode).name} · до ${fmtTime(len)}`;
	goGame();
	ui.showPause(game.menuPause);
});

net.on('pause', (msg) => {
	if (!game.running) return;
	game.setPause(msg.on, msg.menu);
	ui.showPause(game.menuPause);
	input.setEnabled(!game.menuPause);
});

function togglePause(on = !game.menuPause) {
	if (ui.screen !== 'game' || !game.solo()) return;
	if (on && !ui.levelup.hidden) return; // the offer already holds the run
	net.send({ t: 'pause', v: on });
}
$('hud-pause').addEventListener('click', (e) => {
	togglePause(true);
	e.currentTarget.blur();
});
$('pause-resume').addEventListener('click', () => togglePause(false));
$('pause-quit').addEventListener('click', () => net.send({ t: 'quit' }));
addEventListener('keydown', (e) => {
	if (e.code !== 'Escape' || e.repeat) return;
	togglePause();
});
// A solo run pauses itself when the tab goes to the background.
document.addEventListener('visibilitychange', () => {
	if (document.hidden && !game.menuPause) togglePause(true);
});

net.on('s', (msg) => {
	// The server resends `start` on reconnect, so stray snapshots outside a run are ignored.
	if (game.running) {
		game.onSnapshot(msg);
		sound.snapshot(game);
	}
});

net.on('lvl', (msg) => {
	if (!game.running) return;
	game.offer = msg;
	if (ui.showOffer(msg) && msg.choices?.some((c) => c.rar === 3)) sound.legendary();
});

net.on('over', (msg) => {
	input.setEnabled(false);
	clearTimeout(overTimer);
	if (msg.win && game.dawnSeen && game.running) overTimer = setTimeout(() => showOver(msg), DAWN_HOLD_MS);
	else showOver(msg);
});

// Adds this run's stats to the browser's totals and returns heroes opened by it.
function takeAchievements(msg) {
	const mine = (Array.isArray(msg.stats) ? msg.stats : []).find((s) => s.pid === state.me);
	// The server resends `over` on reconnect: a run counts once.
	if (!mine?.ach || (msg.runId && store.get('nh.achRun') === msg.runId)) return [];
	if (msg.runId) store.set('nh.achRun', msg.runId);
	const before = unlocked();
	ach.stats = mergeAchStats(ach.stats, mine.ach);
	store.set('nh.ach', JSON.stringify(ach.stats));
	ui.setUnlocks(unlocked(), ach.stats);
	net.send({ t: 'heroes', heroes: [...unlocked()] });
	return unlockAll ? [] : [...unlocked()].filter((id) => !before.has(id));
}

function showOver(msg) {
	game.stop();
	ui.showPause(false);
	msg.unlockedNow ??= takeAchievements(msg);
	if (msg.unlockedNow.length) sound.legendary();
	if (msg.host !== undefined) state.host = msg.host;
	const stats = (Array.isArray(msg.stats) ? msg.stats : []).map((s) => ({ ...s, color: game.meta(s.pid).color }));
	ui.renderOver({ ...msg, stats }, state.me, state.host === state.me);
	ui.show('over');
	sound.setMode('over', msg.win);
}

net.on('err', (msg) => ui.toast(msg.msg || 'Ошибка'));

// Game events

game.onEvent = (kind, arg, arg2) => {
	switch (kind) {
		case 'boss':
			ui.setBossName(arg);
			ui.banner(`Явился ${arg || 'босс'}!`);
			break;
		case 'chest':
			ui.banner('Сундук! Всем — улучшение');
			break;
		case 'down':
			if (arg === state.me) ui.banner('Вы пали!');
			else ui.toast(`${game.meta(arg).name} пал — поднимите его!`, 'info');
			break;
		case 'up':
			if (arg === state.me) ui.toast('Вас подняли!', 'info');
			break;
		case 'item': {
			const def = ITEMS[arg2];
			if (!def) break;
			if (arg === state.me) ui.toast(`${def.name}: ${def.desc}`, 'info');
			else if (arg2 === 'rage' || arg2 === 'cracker' || arg2 === 'slowtime') ui.toast(`${game.meta(arg).name}: ${def.name}`, 'info');
			break;
		}
		case 'evo': {
			const name = EVOS[arg2]?.name || 'эволюция';
			if (arg === state.me) {
				ui.banner(`Эволюция: ${name}`);
				ui.flashWeapons();
			} else {
				ui.toast(`${game.meta(arg).name}: эволюция «${name}»`, 'info');
			}
			break;
		}
		case 'duo': {
			const name = DUOS[arg2]?.name || 'связка';
			if (arg === state.me) {
				const first = rememberDuo(arg2);
				ui.banner(first ? `Новая связка: ${name}` : `Связка: ${name}`);
				ui.flashWeapons();
			} else {
				ui.toast(`${game.meta(arg).name} открыл связку: ${name}`, 'info');
			}
			break;
		}
		case 'inv':
			ui.banner('Орда смыкается кольцом!');
			break;
		case 'peakw':
			ui.banner(`${arg.name} через ${PEAK_WARN} с`);
			ui.toast(arg.hint, 'info');
			break;
		case 'peak':
			ui.banner(`${arg.name}!`);
			break;
		case 'dawn':
			ui.banner('Рассвет! Ночь отступила');
			break;
		case 'evt': {
			// Wave 4 event: banner with the name, the hint as a toast (the streak goal and the altar deal filled in).
			ui.banner(arg.banner ?? arg.name, arg.id === 'gold' ? 'banner-gold' : '');
			let hint = arg.hint.replace('{n}', String(arg2)).replace('{t}', String(arg.dur ?? ''));
			const ev = game.event();
			if (arg.id === 'altar' && ev && ALTAR_DEALS[ev.a]) hint += `. Сделка «${ALTAR_DEALS[ev.a].name}»: ${ALTAR_DEALS[ev.a].desc}`;
			ui.toast(hint, 'info');
			break;
		}
		case 'evphase':
			if (arg.id === 'cursed') ui.banner(`Волна! Продержитесь ${arg.hold} с`);
			break;
		case 'evte':
			if (arg.done?.[arg2]) ui.toast(arg.done[arg2], 'info');
			break;
		case 'altar':
			if (arg === state.me) ui.banner(`Сделка: ${ALTAR_DEALS[arg2]?.name || 'алтарь'}`);
			else ui.toast(`${game.meta(arg).name} принял сделку алтаря`, 'info');
			break;
		case 'elite':
			ui.toast(`Элита: ${ELITE_AFFIXES[arg]?.name || '?'} — в награду сундук или золото`, 'info');
			break;
	}
};

function pick(i) {
	if (ui.screen !== 'game' || ui.levelup.hidden) return;
	if (game.pick(i)) {
		sound.card('pick');
		ui.hideOffer();
	}
}
ui.onPick = pick;
input.onDigit = pick;

function reroll() {
	if (ui.screen !== 'game' || ui.levelup.hidden) return;
	if (game.reroll()) sound.card('reroll');
}
function skip() {
	if (ui.screen !== 'game' || ui.levelup.hidden) return;
	if (game.skip()) {
		sound.card('skip');
		ui.hideOffer();
	}
}
ui.onReroll = input.onReroll = reroll;
ui.onSkip = input.onSkip = skip;

// DOM controls

ui.onHero = (id) => {
	if (!unlocked().has(id)) {
		ui.toast(`${HEROES[id].name} пока закрыт. ${unlockProgress(id, ach.stats)}`, 'info');
		return;
	}
	state.hero = id;
	store.set('nh.hero', id);
	net.send({ t: 'hero', hero: id });
	ui.selectHero(id, state.lobby?.players?.find((p) => p.pid === state.me)?.color || '#90a4ae');
};
ui.onMode = (id) => net.send({ t: 'mode', mode: id });
ui.buildHeroCards(state.hero);
ui.setUnlocks(unlocked(), ach.stats);

$('menu-name').addEventListener('change', (e) => {
	const name = e.target.value.trim().slice(0, 20);
	if (!name) return;
	state.name = name;
	store.set('nh.name', name);
	net.send({ t: 'name', name });
});
$('menu-create').addEventListener('click', () => net.send({ t: 'create', hero: state.hero, mode: state.mode, heroes: [...unlocked()] }));
$('menu-join').addEventListener('click', () => joinRoom($('menu-code').value));
$('menu-code').addEventListener('keydown', (e) => {
	if (e.key === 'Enter') joinRoom(e.target.value);
});
$('menu-refresh').addEventListener('click', () => net.send({ t: 'list' }));

$('lobby-ready').addEventListener('click', () => net.send({ t: 'ready', v: !state.myReady }));
$('lobby-start').addEventListener('click', () => net.send({ t: 'start' }));
$('lobby-leave').addEventListener('click', () => {
	net.send({ t: 'leave' });
	goMenu();
});
$('lobby-copy').addEventListener('click', () => copyLink());

$('over-again').addEventListener('click', () => net.send({ t: 'again' }));
$('over-menu').addEventListener('click', () => {
	net.send({ t: 'leave' });
	goMenu();
});

// Run log: summary lines on top, then the JSON (the same text as /api/runs/<id>.txt).
const runLogText = (log) => `${(Array.isArray(log.summary) ? log.summary : []).join('\n')}\n\n${JSON.stringify(log)}`;

$('over-copy').addEventListener('click', async () => {
	const log = ui.runLog;
	if (!log) return;
	if (await copyText(runLogText(log))) ui.toast(`Лог #${log.id} скопирован`, 'info');
	else ui.toast('Не удалось скопировать — скачайте .json');
});

$('over-download').addEventListener('click', () => {
	const log = ui.runLog;
	if (!log) return;
	const url = URL.createObjectURL(new Blob([JSON.stringify(log, null, 1)], { type: 'application/json' }));
	const a = document.createElement('a');
	a.href = url;
	a.download = `horde-run-${log.id}.json`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		let ok = false;
		try { ok = document.execCommand('copy'); } catch { ok = false; }
		ta.remove();
		return ok;
	}
}

async function copyLink() {
	const code = state.lobby?.code;
	if (!code) return;
	const link = `${location.origin}/?room=${encodeURIComponent(code)}`;
	let ok = false;
	try {
		await navigator.clipboard.writeText(link);
		ok = true;
	} catch {
		const ta = document.createElement('textarea');
		ta.value = link;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		try { ok = document.execCommand('copy'); } catch { ok = false; }
		ta.remove();
	}
	if (ok) ui.toast('Ссылка скопирована', 'info');
	else prompt('Скопируйте ссылку:', link);
}

// Sound controls

function renderSound(st) {
	const btn = $('snd-toggle');
	const off = st.muted;
	btn.textContent = off ? '🔇' : '🔊';
	btn.classList.toggle('off', off);
	btn.setAttribute('aria-label', off ? 'Включить звук' : 'Выключить звук');
	btn.setAttribute('aria-pressed', String(off));
	$('snd-music').value = Math.round(st.music * 100);
	$('snd-sfx').value = Math.round(st.sfx * 100);
}
sound.onChange = renderSound;
renderSound(sound.settings);

function toggleSoundPanel(open) {
	const panel = $('snd-panel');
	panel.hidden = open === undefined ? !panel.hidden : !open;
	$('snd-more').setAttribute('aria-expanded', String(!panel.hidden));
}
$('snd-toggle').addEventListener('click', (e) => {
	sound.toggleMute();
	e.currentTarget.blur();
});
$('snd-more').addEventListener('click', () => toggleSoundPanel());
for (const kind of ['music', 'sfx']) {
	const el = $('snd-' + kind);
	el.addEventListener('input', () => sound.setVolume(kind, el.value / 100));
	el.addEventListener('change', () => {
		if (kind === 'sfx') sound.ui();
		el.blur();
	});
}
addEventListener('pointerdown', (e) => {
	if (!$('snd').contains(e.target)) toggleSoundPanel(false);
});
addEventListener('keydown', (e) => {
	if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
	const t = e.target;
	if (t && ((t.tagName === 'INPUT' && t.type !== 'range') || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
	sound.toggleMute();
});

// Main loop

let last = performance.now();
function frame(now) {
	const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
	last = now;
	try {
		game.update(dt, input);
		renderer.draw(game, dt);
		if (ui.screen === 'game') ui.updateHud(game);
	} catch (err) {
		// Keep the loop alive on unexpected data.
		console.error(err);
	}
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

ui.setConnecting(true);
net.start();

// Debug handle for manual testing.
window.__nh = { net, game, ui, state, input, P, renderer, sound, ach, unlocked };
