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

function fixture(t, release = true) {
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
	git('tag', 'v35');
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
	const tokens = new Set();
	let tokenCount = 0;
	let sourceHash = '0'.repeat(64);
	let payload;
	const json = value => Response.json(value);
	return {
		calls, tokens,
		get payload() { return payload; },
		async fetch(url, { headers, method, body } = {}) {
			const { origin, pathname } = new URL(url);
			calls.push([method, pathname]);
			if (origin === appOrigin) {
				assert.equal(pathname, '/api/busy');
				assert(tokens.has(headers.Authorization?.slice('Bearer '.length)), 'live mock bearer');
				return json({ v: version, scheduled, playing, storage });
			}
			assert.equal(origin, 'https://vibecode.bitrix24.tech');
			assert.equal(headers['X-Api-Key'], credentials.VIBE_KEY);
			switch (`${method} ${pathname}`) {
				case `POST ${api}/access-tokens`: {
					assert.deepEqual(JSON.parse(body), { mode: 'api-bearer', ttlSeconds: 600 });
					const id = `token-${++tokenCount}`;
					tokens.add(id);
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
						version = 'v36';
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

function run(repo, mock, env = credentials) {
	return deployVibecode({ cwd: repo.cwd, sha: repo.sha, env, fetch: mock.fetch, pause: async () => {} });
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

test('foreign version, foreign sources, foreign candidate archive and scheduled start block deployment', async t => {
	const repo = fixture(t);
	for (const [options, expected] of [
		[{ version: 'v34' }, /проде/],
		[{ sourceId: 'v37' }, /исходник/],
		[{ version: 'v36', sourceId: 'v36' }, /архив/],
		[{ scheduled: 1 }, /запланирован/],
	]) {
		const mock = platform(options);
		await assert.rejects(run(repo, mock), expected);
		assert.equal(mock.payload, undefined);
		assert.equal(mock.tokens.size, 0);
	}
	assert.equal(remoteTag(repo), '');
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
