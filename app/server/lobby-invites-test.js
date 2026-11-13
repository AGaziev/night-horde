import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hub } from './game.js';
import { createLobbyInvites, inviteCapacity } from './lobby-invites.js';

test('отсчёт принадлежит хосту, виден вошедшему игроку, отменяется и запускает комнату один раз', () => {
	const messages = [];
	const hub = new Hub((pid, msg) => messages.push({ pid, ...msg }));
	hub.addPlayer(1, 'Хост');
	hub.addPlayer(2, 'Игрок');
	hub.handle(1, { t: 'create', hero: 'witch' });
	const room = hub.players.get(1).room;
	assert.equal(hub.scheduleStart(room, 2, 10_000), false);
	assert.equal(hub.scheduleStart(room, 1, 10_000), true);
	assert.equal(hub.scheduleStart(room, 1, 20_000), false);
	hub.handle(2, { t: 'join', code: room.code, hero: 'knight' });
	assert.equal(messages.findLast((m) => m.t === 'lobby' && m.pid === 2).startsAt, 10_000);
	hub.handle(2, { t: 'cancel-start' });
	assert.equal(room.startsAt, 10_000);
	hub.handle(1, { t: 'start' });
	assert.equal(room.state, 'lobby');
	hub.handle(1, { t: 'cancel-start' });
	assert.equal(room.startsAt, null);
	hub.tick(0, 10_000);
	assert.equal(room.state, 'lobby');
	assert.equal(hub.scheduleStart(room, 1, 20_000), true);
	assert.equal(hub.busy().scheduled, 1);
	hub.tick(0, 19_999);
	assert.equal(room.state, 'lobby');
	hub.tick(0, 20_000);
	hub.tick(0, 21_000);
	assert.equal(room.state, 'play');
	assert.equal(messages.filter((m) => m.t === 'start' && m.pid === 1).length, 1);
	assert.equal(hub.busy().scheduled, 0);
});

test('приглашённый может войти в комнату по коду после ухода хоста', () => {
	const hub = new Hub(() => {});
	hub.addPlayer(1, 'Хост');
	hub.addPlayer(2, 'Игрок');
	hub.handle(1, { t: 'create', hero: 'witch' });
	const room = hub.players.get(1).room;
	hub.scheduleStart(room, 1, 10_000);
	hub.handle(1, { t: 'leave' });
	hub.handle(2, { t: 'join', code: room.code, hero: 'knight' });
	hub.tick(0, 10_000);
	assert.equal(hub.players.get(2).room, room);
	assert.equal(room.state, 'play');
});

test('сотрудники берутся только из действующего списка доступа, доставка учитывается для каждого', async () => {
	let policy = 'NAMED_USERS';
	const calls = [];
	const portal = createLobbyInvites({
		key: 'test-key', serverId: 'test-server', origin: 'https://game.example',
		fetcher: async (url, request) => {
			const route = new URL(url).pathname;
			if (route.endsWith('/access')) {
				return Response.json({ success: true, data: { users: [
					{ userId: '101', userName: 'Аня' }, { userId: '102', userName: 'Борис' }, { userId: 'net_123', userName: 'Гость' },
				], departments: [] } });
			}
			if (route.endsWith('/me')) return Response.json({ success: true, data: {} });
			if (route.endsWith('/test-server')) return Response.json({ success: true, data: { accessPolicy: policy } });
			assert.equal(route, '/v1/notifications');
			assert.equal(request.headers.Authorization, 'Bearer vibe_session_test');
			const data = JSON.parse(request.body);
			calls.push(data);
			return Response.json(data.userId === 101
				? { success: true, data: { notificationId: 5 } }
				: { success: false, error: { code: 'NOTIFICATION_NOT_DELIVERED' } });
		},
	});
	assert.deepEqual(await portal.list(), [{ id: '101', name: 'Аня' }, { id: '102', name: 'Борис' }]);
	const results = await portal.send(['101', '102'], 'Bearer vibe_session_test', {
		code: 'TEST', startsAt: 10_000, minutes: 5, host: 'Хост',
	});
	assert.equal(results.sent, 1); assert.equal(results.failed, 1); assert.equal(results.unknown, 0);
	assert.deepEqual(calls.map(({ userId }) => userId), [101, 102]);
	assert.ok(calls.every(({ message }) => message.includes('https://game.example/?room=TEST') && message.includes('5 мин')));
	policy = 'OWNER_ONLY';
	await assert.rejects(portal.list(true));
});

test('владелец из /me доступен для приглашения без отдельной записи /access; весь непагинируемый список сохранён', async () => {
	const portal = createLobbyInvites({ key: 'test-key', serverId: 'test-server', origin: 'https://game.example', fetcher: async (url) => {
		const path = new URL(url).pathname;
		return Response.json({ success: true, data: path.endsWith('/me') ? { owner: { userId: '900', name: 'Владелец' } }
			: path.endsWith('/access') ? { users: Array.from({ length: 130 }, (_, i) => ({ userId: String(i + 1), userName: 'Сотрудник ' + i })), departments: [] }
			: { accessPolicy: 'NAMED_USERS' } });
	} });
	const employees = await portal.list();
	assert.equal(employees.length, 131);
	assert.deepEqual(employees.find((e) => e.id === '900'), { id: '900', name: 'Владелец' });
});

test('повтор частичной доставки не дублирует успешных и не повторяет неизвестный результат', async () => {
	const calls = []; let retry = false;
	const portal = createLobbyInvites({ key: 'test-key', serverId: 'test-server', origin: 'https://game.example', fetcher: async (url, req) => {
		const { userId } = JSON.parse(req.body); calls.push(userId);
		if (userId === 3) throw new Error('connection reset after request');
		return Response.json(userId === 1 || retry ? { success: true, data: { notificationId: userId + 10 } }
			: { success: false, error: { code: 'NOTIFICATION_NOT_DELIVERED' } }, { status: userId === 2 && !retry ? 422 : 201 });
	} });
	const info = { code: 'TEST', startsAt: 10_000, minutes: 5, host: 'Хост' };
	const first = await portal.send(['1', '2', '3'], 'Bearer vibe_session_test', info);
	assert.deepEqual(first.recipients.map((r) => [r.id, r.status]), [['1', 'sent'], ['2', 'failed'], ['3', 'unknown']]);
	assert.match(first.recipients[1].error, /получател/);
	assert.match(first.recipients[2].error, /неизвест/);
	retry = true;
	const second = await portal.send(['1', '2', '3'], 'Bearer vibe_session_test', info, first.recipients);
	assert.deepEqual(calls, [1, 2, 3, 2]);
	assert.equal(second.sent, 2); assert.equal(second.unknown, 1); assert.equal(second.failed, 0);
});


test('capacity respects room-specific limits and keeps PvE fallback', () => {
	assert.equal(inviteCapacity({ size: 4, maxMembers: 5 }, 8), 1);
	assert.equal(inviteCapacity({ size: 4 }, 8), 4);
	assert.equal(inviteCapacity({ size: 6, maxMembers: 5 }, 8), 0);
});

test('OAuth schema without owner stays usable and reports incomplete owner information', async () => {
	const portal = createLobbyInvites({ key: 'test-key', serverId: 'test-server', origin: 'https://game.example', fetcher: async (url) => {
		const path = new URL(url).pathname;
		return Response.json({ success: true, data: path.endsWith('/me') ? { type: 'oauth_app', app: { id: 'app', title: 'Game' }, currentUser: null }
			: path.endsWith('/access') ? { users: [{ userId: '2', userName: 'Игрок' }] } : { accessPolicy: 'NAMED_USERS' } });
	} });
	assert.deepEqual(await portal.list(), [{ id: '2', name: 'Игрок' }]);
	assert.match(portal.warning, /владельца/);
});
