import { localDailyRecords } from './daily-records.js';
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
	let data, failed, scope, load, openLog, lastRow, daily = false;

	function render() {
		mine.setAttribute('aria-pressed', String(scope === 'mine'));
		recent.setAttribute('aria-pressed', String(scope === 'recent'));
		$('normal').setAttribute('aria-pressed', String(!daily));
		$('daily').setAttribute('aria-pressed', String(daily));
		$('best').hidden = true;
		list.replaceChildren();
		if (!data) {
			status.textContent = failed ? 'Не удалось загрузить историю. Откройте её ещё раз.' : 'Загружаем историю…';
			return;
		}
		if (scope === 'mine' && !data.personal && !daily) {
			status.textContent = 'Личная история доступна при входе через Битрикс24.';
			return;
		}
		const source = daily ? data.daily ?? { mine: [], recent: [], best: [] } : data;
		const rows = source[scope] ?? [];
		if (daily) {
			const best = data.personal ? source.best ?? [] : localDailyRecords();
			const box = $('best');
			box.hidden = false;
			const title = document.createElement('p');
			title.textContent = (data.personal ? 'Личные рекорды' : 'Рекорды этого браузера') + ' · последние 12 категорий. Сначала исход, затем время выживания и убийства.';
			const records = document.createElement('ul');
			for (const run of best.slice(0, 12)) {
				const item = document.createElement('li');
				item.textContent = `${run.completed ? '✓ Пройдено' : '◇ Попытка'} · ${run.daily.day} · правила v${run.daily.version ?? 1} · ${modeOf(run.mode).name} · ${run.daily.players} игр. · ${run.grade === 2 ? 'Владыка повержен' : run.win ? 'победа' : fmtTime(run.time)} · ${run.kills ?? 0} убийств`;
				records.append(item);
			}
			if (!best.length) title.textContent += ' Рекордов пока нет.';
			box.replaceChildren(title, records);
		}
		status.textContent = rows.length ? '' : daily && scope === 'mine' && !data.personal ? 'Полные личные логи доступны через Битрикс24; рекорды этого браузера показаны выше.' : 'Забегов пока нет.';
		for (const run of rows) {
			const row = document.createElement('li');
			const info = document.createElement('div');
			const result = document.createElement('strong');
			result.textContent = run.grade === 2 ? 'Владыка повержен' : run.win ? 'Победа' : 'Поражение';
			result.className = run.win ? 'run-history-win' : 'run-history-loss';
			const time = document.createElement('span');
			time.textContent = ` · ${modeOf(run.mode).name} · ${fmtTime(run.time)}` + (run.daily ? ` · ${run.daily.day} UTC · правила v${run.daily.version ?? 1} · ${run.daily.name} · ${run.daily.players} игр.` : '');
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
		daily = false;
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
	$('normal').addEventListener('click', () => { daily = false; render(); });
	$('daily').addEventListener('click', () => { daily = true; render(); });
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
