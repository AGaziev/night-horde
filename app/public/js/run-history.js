import { HEROES, modeOf } from '/shared/content.js';
import { fmtTime } from './ui.js';
import { renderResults } from './results.js';

const dateTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const $ = (part) => document.getElementById(part ? `run-history-${part}` : 'run-history');

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
			result.textContent = run.grade === 2 ? 'Владыка повержен' : run.win ? 'Победа' : 'Поражение';
			result.className = run.win ? 'run-history-win' : 'run-history-loss';
			const time = document.createElement('span');
			time.textContent = ` · ${modeOf(run.mode).name} · ${fmtTime(run.time)}`;
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
		heading.textContent = run.grade === 2 ? 'Владыка повержен' : run.win ? 'Ночь пережита' : 'Орда победила';
		date.textContent = `${modeOf(run.mode).name} · ${dateTime.format(new Date(run.at))} · #${run.id}`;
		const url = `/api/runs/${encodeURIComponent(run.id)}`;
		download.href = `${url}.txt`;
		download.download = `забег-${run.id}.txt`;
		download.hidden = true;
		logStatus.textContent = 'Загружаем итоги…';
		back.focus();
		openLog = new AbortController();
		const { signal } = openLog;
		try {
			const response = await fetch(`${url}.card`, { signal });
			if (!response.ok) throw new Error();
			const result = await response.json();
			if (signal.aborted) return;
			if (!renderResults(card, result)) throw new Error();
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
