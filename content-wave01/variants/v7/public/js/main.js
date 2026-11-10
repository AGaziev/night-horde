import { HEROES, ITEMS, ELITE_AFFIXES, DUOS, EVOS } from '/shared/content.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { Game, P } from './game.js';
import { Renderer } from './render.js';
import { UI, rememberDuo } from './ui.js';
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

const state = {
	me: null,
	name: '',
	hero: HEROES[store.get('nh.hero')] ? store.get('nh.hero') : 'knight',
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
	net.send({ t: 'join', code, hero: state.hero });
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
	game.setLobbyPlayers(msg.players);
	if (ui.screen !== 'lobby') ui.show('lobby');
	sound.setMode('lobby');
	state.myReady = ui.renderLobby(msg, state.me);
	const mine = (msg.players || []).find((p) => p.pid === state.me);
	if (mine && HEROES[mine.hero]) state.hero = mine.hero;
});

net.on('start', (msg) => {
	game.begin(msg);
	goGame();
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
	ui.showOffer(msg);
});

net.on('over', (msg) => {
	game.stop();
	input.setEnabled(false);
	if (msg.host !== undefined) state.host = msg.host;
	const stats = (Array.isArray(msg.stats) ? msg.stats : []).map((s) => ({ ...s, color: game.meta(s.pid).color }));
	ui.renderOver({ ...msg, stats }, state.me, state.host === state.me);
	ui.show('over');
	sound.setMode('over', msg.win);
});

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
	state.hero = id;
	store.set('nh.hero', id);
	net.send({ t: 'hero', hero: id });
	ui.selectHero(id, state.lobby?.players?.find((p) => p.pid === state.me)?.color || '#90a4ae');
};
ui.buildHeroCards(state.hero);

$('menu-name').addEventListener('change', (e) => {
	const name = e.target.value.trim().slice(0, 20);
	if (!name) return;
	state.name = name;
	store.set('nh.name', name);
	net.send({ t: 'name', name });
});
$('menu-create').addEventListener('click', () => net.send({ t: 'create', hero: state.hero }));
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
window.__nh = { net, game, ui, state, input, P, renderer, sound };
