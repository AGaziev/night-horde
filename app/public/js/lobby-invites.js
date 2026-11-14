import { fmtTime } from './ui.js';

const $ = (id) => document.getElementById(id);
const normalize = (name) => name.toLocaleLowerCase('ru').replaceAll('ё', 'е');

export function setupLobbyInvites(net, toast) {
	const open = $('lobby-invite');
	const dialog = $('lobby-invite-dialog');
	const form = $('lobby-invite-form');
	const fields = $('lobby-invite-fields');
	const list = $('lobby-invite-list');
	const search = $('lobby-invite-search');
	const searchField = $('lobby-invite-search-field');
	const status = $('lobby-invite-status');
	const count = $('lobby-invite-count');
	const countdown = $('lobby-countdown');
	const timer = $('lobby-countdown-time');
	const cancel = $('lobby-cancel-start');
	const start = $('lobby-start');
	let lobby, viewer, clock, load, sending = null, employees = [], slots = 0, generation = 0;
	let retryAt = null, retryBatchId = null;
	const selected = new Set();
	const employeeNames = new Map();
	const submit = form.querySelector('[type=submit]');

	function context() { return { generation, code: lobby.code, host: lobby.host, viewer }; }
	function current(request) {
		return request.generation === generation && request.code === lobby?.code
			&& request.host === lobby.host && request.viewer === viewer && lobby.host === viewer;
	}
	function invalidate() {
		generation++;
		load?.abort();
		sending = null;
		retryAt = null; retryBatchId = null;
		selected.clear();
		employees = [];
		employeeNames.clear();
	}

	function url(code) {
		return '/api/lobby/invites?' + new URLSearchParams({ sid: net.sid, room: code });
	}

	async function request(route, options) {
		const response = await fetch(route, options);
		const data = await response.json();
		if (!response.ok) throw new Error(data.error || 'Не удалось связаться с Битрикс24.');
		return data;
	}

	function showEmployees() {
		list.replaceChildren();
		const query = normalize(search.value.trim());
		for (const employee of employees) {
			if (query && !normalize(employee.name).includes(query)) continue;
			const label = document.createElement('label');
			const checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.checked = selected.has(employee.id);
			checkbox.disabled = !checkbox.checked && selected.size >= slots;
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) selected.add(employee.id);
				else selected.delete(employee.id);
				updateCount();
				for (const input of list.querySelectorAll('input')) {
					input.disabled = !input.checked && selected.size >= slots;
				}
			});
			label.append(checkbox, document.createTextNode(employee.name));
			list.append(label);
		}
		if (query && !list.childElementCount) list.textContent = 'Никого не нашли.';
		updateCount();
	}

	function showDelivery(data) {
		const byId = employeeNames;
		const lines = data.recipients.map((r) => `${byId.get(r.id) || 'Сотрудник ' + r.id}: ${r.status === 'sent' ? 'доставлено' : r.error}`);
		status.textContent = (data.active ? 'Отсчёт идёт. ' : 'Отсчёт остановлен. ') + lines.join(' ');
		retryAt = data.active ? data.startsAt : null;
		retryBatchId = data.active ? data.batchId : null;
		const failed = new Set(data.recipients.filter((r) => r.status === 'failed').map((r) => r.id));
		employees = employees.filter((e) => failed.has(e.id));
		selected.clear();
		for (const e of employees.slice(0, slots)) selected.add(e.id);
		fields.disabled = false;
		form.elements.minutes.disabled = retryAt !== null;
		submit.textContent = retryAt !== null ? 'Повторить недоставленные' : 'Запустить отсчёт';
		submit.disabled = failed.size === 0;
		showEmployees();
	}

	function updateCount() {
		count.textContent = slots === 0 ? 'В комнате нет свободных мест.'
			: employees.length === 0 ? 'Все доступные сотрудники уже в комнате.'
			: `Выбрано ${selected.size} из ${Math.min(slots, employees.length)}`;
	}

	open.addEventListener('click', async () => {
		if (!lobby || lobby.host !== viewer || dialog.open || sending) return;
		generation++;
		const requestContext = context();
		const code = requestContext.code;
		load?.abort();
		load = new AbortController();
		const { signal } = load;
		selected.clear();
		retryAt = null; retryBatchId = null;
		form.elements.minutes.disabled = false;
		submit.disabled = false;
		submit.textContent = 'Запустить отсчёт';
		search.value = '';
		searchField.hidden = true;
		list.replaceChildren();
		count.textContent = '';
		fields.disabled = true;
		status.textContent = 'Загружаем сотрудников…';
		dialog.showModal();
		try {
			const data = await request(url(code), { signal });
			if (signal.aborted || !current(requestContext) || !dialog.open) return;
			employees = data.employees;
			for (const employee of employees) employeeNames.set(employee.id, employee.name);
			slots = data.slots;
			searchField.hidden = employees.length < 6;
			status.textContent = data.warning || '';
			fields.disabled = false;
			if (data.delivery) showDelivery({ ...data.delivery, active: true, startsAt: data.startsAt, batchId: data.batchId });
			else if (data.startsAt !== null) {
				status.textContent = 'Отсчёт уже идёт. Дождитесь результата отправки или отмените отсчёт.';
				fields.disabled = true;
			} else showEmployees();
		} catch (error) {
			if (!signal.aborted && current(requestContext) && dialog.open) status.textContent = error.message;
		}
	});
	search.addEventListener('input', showEmployees);
	dialog.addEventListener('close', () => load?.abort());
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (!lobby || lobby.host !== viewer || sending) return;
		const requestContext = context();
		sending = requestContext;
		const minutes = Number(form.elements.minutes.value);
		fields.disabled = true;
		status.textContent = 'Запускаем отсчёт…';
		try {
			const data = await request(url(requestContext.code), {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: [...selected], minutes, startsAt: retryAt, batchId: retryBatchId }),
			});
			if (!current(requestContext) || !dialog.open) return;
			if (data.failed || data.unknown) {
				showDelivery(data);
			} else {
				dialog.close();
				toast((data.active ? 'Отсчёт запущен.' : 'Отсчёт остановлен.') + ` Доставлено ${data.sent}.`);
			}
		} catch (error) {
			if (current(requestContext) && dialog.open) {
				status.textContent = error.message;
				fields.disabled = false;
			}
		} finally {
			if (sending === requestContext) sending = null;
		}
	});
	cancel.addEventListener('click', () => net.send({ t: 'cancel-start' }));

	return {
		update(next, me) {
			const changedContext = next?.code !== lobby?.code || next?.host !== lobby?.host || me !== viewer;
			lobby = next;
			viewer = me;
			const active = next?.startsAt != null;
			const isHost = !!next && next.host === me;
			if (changedContext || !isHost) { invalidate(); dialog.close(); }
			open.hidden = !net.invites || !isHost;
			start.disabled = active;
			countdown.hidden = !active;
			cancel.hidden = !isHost;
			clearInterval(clock);
			if (active) {
				const deadline = performance.now() + Math.max(0, next.startsAt - next.serverNow);
				const draw = () => { timer.textContent = fmtTime(Math.max(0, Math.ceil((deadline - performance.now()) / 1000))); };
				draw();
				clock = setInterval(draw, 250);
			}
		},
	};
}
