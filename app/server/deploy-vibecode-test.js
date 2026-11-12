import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { deployVibecode } from '../../pm/deploy-vibecode.mjs';

const appOrigin = 'https://app-0fdbcfb656d3.vibecode.bitrix24.tech';
const api = '/v1/infra/servers/test-server';
const credentials = { VIBE_KEY: 'fake-key', SERVER_ID: 'test-server' };
const changelog = 'Новая версия игры.';

function fixture(t, release = true, previousSourceId = 'v35') {
	const root = mkdtempSync(join(tmpdir(), 'horde-deploy-test-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const cwd = join(root, 'work');
	const origin = join(root, 'origin');
	mkdirSync(cwd);
	function git(...args) {
		return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	}
	const versionFile = join(cwd, 'app/public/shared/content.js');
	git('init', '-b', 'main');
	git('config', 'user.name', 'Test');
	git('config', 'user.email', 'test@example.com');
	git('init', '--bare', origin);
	git('remote', 'add', 'origin', origin);
	mkdirSync(join(cwd, 'app/public/shared'), { recursive: true });
	mkdirSync(join(cwd, 'changelog'));
	writeFileSync(versionFile, "export const GAME_VERSION = 'v35';\n");
	git('add', '.');
	git('commit', '-m', 'v35');
	if (previousSourceId === 'v35') git('tag', 'v35');
	else git('tag', '-a', 'v35', '-m', `Vibecode source: ${previousSourceId}`);
	if (release) {
		writeFileSync(versionFile, "export const GAME_VERSION = 'v36';\n");
		writeFileSync(join(cwd, 'changelog/v36.txt'), changelog + '\n');
		git('add', '.');
		git('commit', '-m', 'v36');
	}
	git('push', 'origin', 'main', '--tags');
	const sha = git('rev-parse', 'HEAD');
	writeFileSync(join(cwd, 'app/untracked.txt'), 'not in source');
	return { cwd, git, sha };
}

function platform({ version = 'v35', sourceId = 'v35', playing = 0, scheduled = 0,
	success = true, storage = true, apply = true } = {}) {
	const calls = [];
	const tokens = new Map();
	const busy = { v: version, scheduled, playing, storage };
	let time = 0;
	let tokenCount = 0;
	let sourceHash = '0'.repeat(64);
	let payload;
	const json = value => Response.json(value);
	return {
		calls, tokens, busy,
		set sourceId(id) { sourceId = id; },
		advanceTime(delay) { time += delay; },
		get payload() { return payload; },
		async fetch(url, { headers, method, body } = {}) {
			const { origin, pathname } = new URL(url);
			calls.push([method, pathname]);
			if (origin === appOrigin) {
				assert.equal(pathname, '/api/busy');
				assert(tokens.get(headers.Authorization?.slice('Bearer '.length)) > time, 'live mock bearer');
				return json(busy);
			}
			assert.equal(origin, 'https://vibecode.bitrix24.tech');
			assert.equal(headers['X-Api-Key'], credentials.VIBE_KEY);
			switch (`${method} ${pathname}`) {
				case `POST ${api}/access-tokens`: {
					assert.deepEqual(JSON.parse(body), { mode: 'api-bearer', ttlSeconds: 600 });
					const id = `token-${++tokenCount}`;
					tokens.set(id, time + 600_000);
					return json({ success: true, data: { id, token: id } });
				}
				case `GET ${api}/sources`:
					return json({ success: true, data: {
						currentVersionId: sourceId,
						versions: [{ versionId: sourceId, sha256: sourceHash, deployStatus: 'success' }],
					} });
				case `POST ${api}/deploy`:
					payload = JSON.parse(body);
					if (success && apply) {
						busy.v = 'v36';
						sourceId = 'v37';
						sourceHash = createHash('sha256').update(Buffer.from(payload.source.content, 'base64')).digest('hex');
					}
					return json({ success, data: { source: { savedVersionId: sourceId } } });
				default:
					assert.equal(method, 'DELETE');
					assert(tokens.delete(pathname.split('/').at(-1)), 'revokes issued token');
					return new Response(null, { status: 204 });
			}
		},
	};
}

function run(repo, mock, env = credentials, onPause = () => {}) {
	let time = 0;
	return deployVibecode({
		cwd: repo.cwd, sha: repo.sha, env, fetch: mock.fetch,
		now: () => time,
		pause: async delay => {
			time += delay;
			mock.advanceTime(delay);
			onPause(time);
		},
	});
}

function remoteTag(repo) {
	return repo.git('ls-remote', '--tags', 'origin', 'refs/tags/v36^{}');
}

test('unchanged release skips without credentials or platform calls', async t => {
	const repo = fixture(t, false);
	const mock = platform();
	assert.match(await run(repo, mock, {}), /v35/);
	assert.deepEqual(mock.calls, []);
});

test('active match allows deployment of the tested app, with exact changelog and verified tag', async t => {
	const repo = fixture(t);
	const mock = platform({ playing: 1 });
	assert.match(await run(repo, mock), /v36/);
	assert.equal(mock.tokens.size, 0);
	assert.deepEqual(remoteTag(repo), `${repo.sha}\trefs/tags/v36^{}`);
	assert.equal(repo.git('for-each-ref', '--format=%(contents:subject)', 'refs/tags/v36'), 'Vibecode source: v37');
	const { source, ...body } = mock.payload;
	assert.deepEqual(body, {
		baseVersionId: 'v35',
		install: 'cd /opt/app && npm ci --omit=dev',
		start: 'cd /opt/app && node server/server.js',
		port: 3000,
		healthPath: '/health',
		dataDirs: ['/opt/data'],
		env: {
			NODE_ENV: 'production',
			VIBE_APP_KEY: credentials.VIBE_KEY,
			HORDE_VIBE_SERVER_ID: credentials.SERVER_ID,
			HORDE_APP_ORIGIN: appOrigin,
		},
		displayName: 'Ночная орда',
		changelog,
	});
	const archive = gunzipSync(Buffer.from(source.content, 'base64'));
	assert.equal(execFileSync('tar', ['-tf', '-'], { input: archive, encoding: 'utf8' }).trim(),
		'public/\npublic/shared/\npublic/shared/content.js');
	assert.equal(execFileSync('tar', ['-xOf', '-', 'public/shared/content.js'], { input: archive, encoding: 'utf8' }),
		"export const GAME_VERSION = 'v36';\n");

	repo.git('tag', '-d', 'v36');
	repo.git('push', 'origin', ':refs/tags/v36');
	await run(repo, mock);
	assert.deepEqual(remoteTag(repo), `${repo.sha}\trefs/tags/v36^{}`);
	assert.equal(mock.calls.filter(([, path]) => path.endsWith('/deploy')).length, 1);
	const previousCallCount = mock.calls.length;
	await run(repo, mock, {});
	assert.equal(mock.calls.length, previousCallCount);
});

test('foreign version, foreign sources and foreign candidate archive block deployment', async t => {
	const repo = fixture(t);
	for (const [options, expected] of [
		[{ version: 'v34' }, /проде/],
		[{ sourceId: 'v37' }, /исходник/],
		[{ version: 'v36', sourceId: 'v36' }, /архив/],
	]) {
		const mock = platform(options);
		await assert.rejects(run(repo, mock), expected);
		assert.equal(mock.payload, undefined);
		assert.equal(mock.tokens.size, 0);
	}
	assert.equal(remoteTag(repo), '');
});

test('a 30-minute scheduled start delays deployment until the active match with fresh tokens', async t => {
	const repo = fixture(t, true, 'v42');
	const mock = platform({ scheduled: 1, sourceId: 'v42' });
	await run(repo, mock, credentials, time => {
		assert.equal(mock.payload, undefined);
		if (time === 30 * 60_000) {
			mock.busy.scheduled = 0;
			mock.busy.playing = 1;
		}
	});
	const deployAt = mock.calls.findIndex(([method, path]) => method === 'POST' && path === `${api}/deploy`);
	const preflight = mock.calls.slice(0, deployAt);
	assert.deepEqual(preflight.at(-1), ['GET', '/api/busy']);
	assert.equal(preflight.filter(([, path]) => path === `${api}/sources`).length, 2);
	assert(preflight.filter(([method, path]) => method === 'POST' && path === `${api}/access-tokens`).length > 1);
	assert.equal(mock.payload.baseVersionId, 'v42');
	assert.equal(mock.calls.filter(([, path]) => path === `${api}/deploy`).length, 1);
	assert.equal(mock.tokens.size, 0);
	assert.equal(remoteTag(repo), `${repo.sha}\trefs/tags/v36^{}`);
});

test('a scheduled start that persists for 35 minutes times out without a deploy or tag', async t => {
	const repo = fixture(t);
	const mock = platform({ scheduled: 1 });
	const intervals = [];
	await assert.rejects(run(repo, mock, credentials, time => intervals.push(time)), /35 минут/);
	assert.equal(intervals[0], 10_000);
	assert.equal(intervals.at(-1), 35 * 60_000);
	assert.equal(mock.payload, undefined);
	assert.equal(mock.tokens.size, 0);
	assert.equal(remoteTag(repo), '');
});

test('a change during the wait blocks deployment', async t => {
	for (const [name, change, error] of [
		['game version', mock => { mock.busy.v = 'v36'; }, /проде/],
		['Vibecode source', mock => { mock.sourceId = 'v42'; }, /исходник/],
		['invalid count', mock => { mock.busy.scheduled = '0'; }, /состояние/],
		['main HEAD', (_, repo) => {
			repo.git('commit', '--allow-empty', '-m', 'new main');
			repo.git('push', 'origin', 'main');
			repo.git('checkout', '--detach', repo.sha);
		}, /origin\/main/],
	]) {
		await t.test(name, async t => {
			const repo = fixture(t);
			const mock = platform({ scheduled: 1 });
			let waited = false;
			await assert.rejects(run(repo, mock, credentials, () => {
				waited = true;
				mock.busy.scheduled = 0;
				change(mock, repo);
			}), error);
			assert.equal(waited, true);
			assert.equal(mock.payload, undefined);
			assert.equal(mock.tokens.size, 0);
			assert.equal(remoteTag(repo), '');
		});
	}
});

test('a start scheduled during preflight delays the POST', async t => {
	const repo = fixture(t);
	const mock = platform();
	const fetch = mock.fetch;
	let waited = false;
	mock.fetch = async (url, options) => {
		if (!waited && new URL(url).pathname === `${api}/sources` && mock.calls.some(([, path]) => path === '/api/busy')) {
			mock.busy.scheduled = 1;
		}
		return fetch(url, options);
	};
	await run(repo, mock, credentials, () => {
		assert.equal(mock.payload, undefined);
		mock.busy.scheduled = 0;
		waited = true;
	});
	assert.equal(waited, true);
	assert.equal(mock.calls.filter(([, path]) => path === `${api}/deploy`).length, 1);
});

test('an older tested commit cannot deploy after main advances', async t => {
	const repo = fixture(t);
	repo.git('commit', '--allow-empty', '-m', 'new main');
	repo.git('push', 'origin', 'main');
	repo.git('checkout', '--detach', repo.sha);
	const mock = platform();
	await assert.rejects(run(repo, mock), /origin\/main/);
	assert.deepEqual(mock.calls, []);
});

test('HTTP 200 with success false, wrong live version and disabled storage cannot create a tag', async t => {
	const repo = fixture(t);
	for (const [options, expected] of [
		[{ success: false }, /успешную/],
		[{ apply: false }, /\/api\/busy/],
		[{ storage: false }, /\/api\/busy/],
	]) {
		const mock = platform(options);
		await assert.rejects(run(repo, mock), expected);
		assert.equal(mock.tokens.size, 0);
		assert.equal(remoteTag(repo), '');
	}
});
