import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hub } from './game.js';
import { createLobbyInvites } from './lobby-invites.js';

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
	assert.deepEqual(results, { sent: 1, failed: 1 });
	assert.deepEqual(calls.map(({ userId }) => userId), [101, 102]);
	assert.ok(calls.every(({ message }) => message.includes('https://game.example/?room=TEST') && message.includes('5 мин')));
	policy = 'OWNER_ONLY';
	await assert.rejects(portal.list(true));
});
