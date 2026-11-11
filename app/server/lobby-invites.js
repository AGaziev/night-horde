import { bitrixUid, BASE_URL } from './storage.js';

const CACHE_MS = 20_000;
const startTime = new Intl.DateTimeFormat('ru-RU', {
	timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function createLobbyInvites({ key, serverId, origin, fetcher = fetch }) {
	if (!key || !serverId || !origin) return null;
	const app = new URL(origin);
	if (app.protocol !== 'https:') return null;
	const serverPath = '/infra/servers/' + encodeURIComponent(serverId);
	let employees, expiresAt = 0, loading;

	async function request(path, { authorization, body } = {}) {
		const headers = { 'X-Api-Key': key };
		if (authorization) headers.Authorization = authorization;
		if (body) headers['Content-Type'] = 'application/json';
		const res = await fetcher(BASE_URL + path, {
			method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body),
			signal: AbortSignal.timeout(5_000),
		});
		const json = await res.json();
		if (!res.ok || json.success !== true) throw new Error('Vibecode API');
		return json.data;
	}

	async function load() {
		const [server, access] = await Promise.all([request(serverPath), request(serverPath + '/access')]);
		if (server?.accessPolicy !== 'NAMED_USERS' || !Array.isArray(access?.users)) throw new Error('Unexpected access policy');
		const byId = new Map();
		for (const entry of access.users) {
			const id = bitrixUid(String(entry.userId));
			if (!id || byId.has(id)) continue;
			const name = typeof entry.userName === 'string' ? entry.userName.trim() : '';
			byId.set(id, { id, name: name || 'Сотрудник ' + id });
		}
		employees = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
		expiresAt = Date.now() + CACHE_MS;
		return employees;
	}

	return {
		list(fresh = false) {
			if (!fresh && employees && Date.now() < expiresAt) return Promise.resolve(employees);
			loading ??= load().finally(() => { loading = null; });
			return loading;
		},
		async send(ids, authorization, { code, startsAt, minutes, host }) {
			const url = new URL('/', app);
			url.searchParams.set('room', code);
			const name = host.replace(/[\[\]]/g, '');
			const when = startTime.format(startsAt) + ' мск';
			const message = `${name} зовёт в «Ночную орду». Старт через ${minutes} мин, в ${when}. [URL=${url.href}]Войти в лобби[/URL]. Код комнаты: ${code}.`;
			const results = await Promise.allSettled(ids.map((id) => request('/notifications', {
				authorization, body: { userId: Number(id), message },
			})));
			const sent = results.filter((r) => r.status === 'fulfilled' && Number.isInteger(r.value?.notificationId) && r.value.notificationId > 0).length;
			return { sent, failed: ids.length - sent };
		},
	};
}
