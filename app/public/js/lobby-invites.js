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
	let lobby, clock, load, sending = false, employees = [], slots = 0;
	const selected = new Set();

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

	function updateCount() {
		count.textContent = slots === 0 ? 'В комнате нет свободных мест.'
			: employees.length === 0 ? 'Все доступные сотрудники уже в комнате.'
			: `Выбрано ${selected.size} из ${Math.min(slots, employees.length)}`;
	}

	open.addEventListener('click', async () => {
		if (!lobby || dialog.open || sending) return;
		const code = lobby.code;
		load?.abort();
		load = new AbortController();
		const { signal } = load;
		selected.clear();
		search.value = '';
		searchField.hidden = true;
		list.replaceChildren();
		count.textContent = '';
		fields.disabled = true;
		status.textContent = 'Загружаем сотрудников…';
		dialog.showModal();
		try {
			const data = await request(url(code), { signal });
			if (signal.aborted) return;
			employees = data.employees;
			slots = data.slots;
			searchField.hidden = employees.length < 6;
			status.textContent = '';
			fields.disabled = false;
			showEmployees();
		} catch (error) {
			if (!signal.aborted) status.textContent = error.message;
		}
	});
	search.addEventListener('input', showEmployees);
	dialog.addEventListener('close', () => load?.abort());
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (!lobby || sending) return;
		sending = true;
		const minutes = Number(form.elements.minutes.value);
		fields.disabled = true;
		status.textContent = 'Запускаем отсчёт…';
		try {
			const { active, sent, failed } = await request(url(lobby.code), {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: [...selected], minutes }),
			});
			dialog.close();
			const delivery = sent || failed ? ` Отправлено ${sent}${failed ? `, не доставлено ${failed}` : ''}.` : '';
			toast((active ? 'Отсчёт запущен.' : 'Отсчёт остановлен.') + delivery);
		} catch (error) {
			if (dialog.open) status.textContent = error.message;
			else toast(error.message);
			fields.disabled = false;
		} finally {
			sending = false;
		}
	});
	cancel.addEventListener('click', () => net.send({ t: 'cancel-start' }));

	return {
		update(next, me) {
			const changedRoom = next?.code !== lobby?.code;
			lobby = next;
			const active = next?.startsAt != null;
			const isHost = !!next && next.host === me;
			if (changedRoom || !isHost || active) dialog.close();
			open.hidden = !net.invites || !isHost || active;
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
