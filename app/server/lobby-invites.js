import { bitrixUid, BASE_URL } from './storage.js';

const CACHE_MS = 20_000;
const DELIVERY_ERRORS = {
	NOTIFICATION_NOT_DELIVERED: 'Уведомление не создано. Проверьте, активен ли получатель на портале.',
	SCOPE_DENIED: 'У приложения нет права отправлять уведомления.',
	WRITE_BLOCKED_READONLY_KEY: 'Ключ приложения разрешает только чтение.',
	TOKEN_MISSING: 'Нет доступа к Битрикс24. Откройте игру из портала ещё раз.',
	RATE_LIMITED: 'Битрикс24 временно ограничил отправку. Повторите позже.',
};
export const inviteCapacity = (room, fallback) => Math.max(0, (room.maxMembers ?? fallback) - room.size);
export function inviteDelivery(recipients) {
	return { recipients, sent: recipients.filter((r) => r.status === 'sent').length,
		failed: recipients.filter((r) => r.status === 'failed').length,
		unknown: recipients.filter((r) => r.status === 'unknown').length };
}
const startTime = new Intl.DateTimeFormat('ru-RU', {
	timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function createLobbyInvites({ key, serverId, origin, fetcher = fetch }) {
	if (!key || !serverId || !origin) return null;
	const app = new URL(origin);
	if (app.protocol !== 'https:') return null;
	const serverPath = '/infra/servers/' + encodeURIComponent(serverId);
	let employees, warning = '', expiresAt = 0, loading;

	async function request(path, { authorization, body } = {}) {
		const headers = { 'X-Api-Key': key };
		if (authorization) headers.Authorization = authorization;
		if (body) headers['Content-Type'] = 'application/json';
		const res = await fetcher(BASE_URL + path, {
			method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body),
			signal: AbortSignal.timeout(5_000),
		});
		const json = await res.json();
		if (!res.ok || json.success !== true) {
			const error = new Error('Vibecode API');
			error.code = json.error?.code;
			error.rejected = res.status < 500 && json.success === false;
			throw error;
		}
		return json.data;
	}

	async function load() {
		// /access returns the complete, unpaginated explicit list. The key owner is implicit
		// in the gateway policy and (for personal keys) is documented separately in /me.
		const [server, access, identity] = await Promise.all([
			request(serverPath), request(serverPath + '/access'), request('/me').catch(() => null),
		]);
		if (server?.accessPolicy !== 'NAMED_USERS' || !Array.isArray(access?.users)) throw new Error('Unexpected access policy');
		const owner = server?.access?.via === 'collaborator' ? null : identity?.owner;
		warning = bitrixUid(owner?.userId) ? '' : server?.access?.via === 'collaborator'
			? 'Подключение разработчика не сообщает ID владельца сервера. Владелец появится здесь, если он есть в списке доступа приложения.'
			: identity?.type === 'oauth_app'
				? 'Подключение приложения не сообщает ID владельца сервера. Владелец появится здесь, если он есть в списке доступа приложения.'
				: 'Не удалось определить владельца сервера. Его может не быть в списке приглашений.';
		const byId = new Map();
		for (const entry of [...access.users, ...(owner ? [{ userId: owner.userId, userName: owner.name }] : [])]) {
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
		get warning() { return warning; },
		list(fresh = false) {
			if (!fresh && employees && Date.now() < expiresAt) return Promise.resolve(employees);
			loading ??= load().finally(() => { loading = null; });
			return loading;
		},
		async send(ids, authorization, { code, startsAt, batchId, minutes, host }, previous = []) {
			const url = new URL('/', app);
			url.searchParams.set('room', code);
			const name = host.replace(/[\[\]]/g, '');
			const when = startTime.format(startsAt) + ' мск';
			const message = `${name} зовёт в «Ночную орду». Старт через ${minutes} мин, в ${when}. [URL=${url.href}]Войти в лобби[/URL]. Код комнаты: ${code}.`;
			const known = new Map(previous.map((r) => [r.id, r]));
			const recipients = await Promise.all([...new Set(ids)].map(async (id) => {
				const before = known.get(id);
				// A lost response may hide a successful send; never create a second notification automatically.
				if (before && before.status !== 'failed') return before;
				try {
					const result = await request('/notifications', { authorization, body: {
						userId: Number(id), message, tag: `night-horde:${code}:${batchId ?? startsAt}:${id}`,
					} });
					if (Number.isInteger(result?.notificationId) && result.notificationId > 0) {
						return { id, status: 'sent', notificationId: result.notificationId };
					}
				} catch (error) {
					if (error.rejected) return { id, status: 'failed', error: DELIVERY_ERRORS[error.code] || 'Битрикс24 отклонил отправку. Повторите позже.' };
				}
				return { id, status: 'unknown', error: 'Результат доставки неизвестен. Проверьте уведомления у получателя; повтор не отправлен, чтобы избежать дубля.' };
			}));
			return inviteDelivery(recipients);
		},
	};
}
