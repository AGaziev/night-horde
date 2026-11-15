import { HEROES, modeOf } from '/shared/content.js';
import { fmtTime } from './ui.js';
import { renderResults } from './results.js';
import { HORDE_RULESET, HORDE_SYNERGIES, hordeCardDef } from '/shared/horde-content.js';

const dateTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const $ = (part) => document.getElementById(part ? `run-history-${part}` : 'run-history');

export function historyResult(run, details = false) {
	if (run.ruleset === HORDE_RULESET) return run.win ? 'Герои победили' : 'Орда победила';
	if (run.grade === 2) return 'Владыка повержен';
	return run.win ? (details ? 'Ночь пережита' : 'Победа') : (details ? 'Орда победила' : 'Поражение');
}

const historyMode = (run) => run.ruleset === HORDE_RULESET ? 'Орда против героев' : modeOf(run.mode).name;

export function renderHordeHistory(container, log) {
	if (log?.ruleset !== HORDE_RULESET || !Array.isArray(log.team)) return false;
	container.replaceChildren();
	const line = (tag, text) => {
		const node = document.createElement(tag); node.textContent = text; container.append(node); return node;
	};
	const reasons = { boss: 'Босс повержен', time: 'Герои выжили 15 минут', wipe: 'Все герои пали',
		'director-left': 'Полководец покинул матч', 'heroes-left': 'Герои покинули матч' };
	line('p', `Матч без рейтинга · ${reasons[log.reason] || historyResult(log)} · ${fmtTime(log.time)}`);
	line('h4', `Полководец: ${log.director?.name || 'Неизвестен'}`);
	// Older asymmetric logs contain pack levels but no arsenal draft yet.
	const build = log.director?.build || { packs: log.director?.levels || {}, weapons: {}, artifacts: {} };
	for (const [kind, key, label] of [['pack', 'packs', 'Отряды'], ['weapon', 'weapons', 'Оружие'], ['artifact', 'artifacts', 'Артефакты']]) {
		const items = Object.entries(build[key] || {}).map(([id, level]) => `${hordeCardDef(kind, id)?.name || id} ${level} ур.`);
		line('p', `${label}: ${items.join(', ') || 'нет'}`);
	}
	const synergies = HORDE_SYNERGIES.filter((s) => log.director?.synergies?.includes(s.id));
	if (synergies.length) line('p', `Сочетания: ${synergies.map((s) => s.name).join(', ')}`);
	line('h4', 'Герои');
	for (const player of log.team) line('p', `${player.name} · ${HEROES[player.hero]?.name || player.hero} · ${player.level} ур.`);
	container.hidden = false;
	return true;
}

export function setupRunHistory() {
	const dialog = $('');
	const index = $('index');
	const mine = $('mine');
	const recent = $('recent');
	const list = $('list');
	const status = $('status');
	const details = $('details');
	const back = $('back');
	const logStatus = $('log-status');
	const card = $('card');
	const heading = $('result');
	const date = $('date');
	const download = $('download');
	let data, failed, scope, load, openLog, lastRow;

	function render() {
		mine.setAttribute('aria-pressed', String(scope === 'mine'));
		recent.setAttribute('aria-pressed', String(scope === 'recent'));
		list.replaceChildren();
		if (!data) {
			status.textContent = failed ? 'Не удалось загрузить историю. Откройте её ещё раз.' : 'Загружаем историю…';
			return;
		}
		if (scope === 'mine' && !data.personal) {
			status.textContent = 'Личная история доступна при входе через Битрикс24.';
			return;
		}
		const rows = data[scope];
		status.textContent = rows.length ? '' : 'Забегов пока нет.';
		for (const run of rows) {
			const row = document.createElement('li');
			const info = document.createElement('div');
			const result = document.createElement('strong');
			result.textContent = historyResult(run);
			result.className = run.ruleset === HORDE_RULESET ? '' : run.win ? 'run-history-win' : 'run-history-loss';
			const time = document.createElement('span');
			time.textContent = ` · ${historyMode(run)} · ${fmtTime(run.time)}`;
			const date = document.createElement('time');
			date.dateTime = run.at;
			date.textContent = dateTime.format(new Date(run.at));
			const heroes = document.createElement('div');
			heroes.className = 'muted small';
			heroes.textContent = run.players.map(({ hero }) => HEROES[hero]?.name ?? hero).join(', ');
			const button = document.createElement('button');
			button.className = 'btn btn-ghost btn-small';
			button.textContent = 'Итоги';
			button.setAttribute('aria-label', 'Итоги забега ' + run.id);
			button.addEventListener('click', () => showResults(run, button));
			info.append(result, time, date, heroes);
			row.append(info, button);
			list.append(row);
		}
	}

	async function showResults(run, button) {
		lastRow = button;
		index.hidden = true;
		details.hidden = false;
		renderResults(card, null);
		heading.textContent = historyResult(run, true);
		date.textContent = `${historyMode(run)} · ${dateTime.format(new Date(run.at))} · #${run.id}`;
		const url = `/api/runs/${encodeURIComponent(run.id)}`;
		download.href = `${url}.txt`;
		download.download = `забег-${run.id}.txt`;
		download.hidden = true;
		logStatus.textContent = 'Загружаем итоги…';
		back.focus();
		openLog = new AbortController();
		const { signal } = openLog;
		try {
			const response = await fetch(`${url}${run.ruleset === HORDE_RULESET ? '.json' : '.card'}`, { signal });
			if (!response.ok) throw new Error();
			const result = await response.json();
			if (signal.aborted) return;
			if (!(run.ruleset === HORDE_RULESET ? renderHordeHistory(card, result) : renderResults(card, result))) throw new Error();
			logStatus.textContent = '';
			download.hidden = false;
		} catch {
			if (!signal.aborted) logStatus.textContent = 'Не удалось загрузить итоги забега.';
		}
	}

	async function show() {
		if (dialog.open) return;
		data = null;
		failed = false;
		scope = 'mine';
		index.hidden = false;
		details.hidden = true;
		render();
		dialog.showModal();
		load = new AbortController();
		const { signal } = load;
		try {
			const response = await fetch('/api/runs/history', { signal });
			if (!response.ok) throw new Error();
			const rows = await response.json();
			if (signal.aborted) return;
			data = rows;
			if (!data.personal) scope = 'recent';
		} catch {
			if (signal.aborted) return;
			failed = true;
		}
		render();
	}

	for (const button of document.querySelectorAll('[data-open-run-history]')) button.addEventListener('click', show);
	mine.addEventListener('click', () => { scope = 'mine'; render(); });
	recent.addEventListener('click', () => { scope = 'recent'; render(); });
	back.addEventListener('click', () => {
		openLog?.abort();
		renderResults(card, null);
		details.hidden = true;
		index.hidden = false;
		lastRow?.focus();
	});
	dialog.addEventListener('close', () => {
		load?.abort();
		openLog?.abort();
		renderResults(card, null);
	});
	return dialog;
}
