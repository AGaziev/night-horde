import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { deployVibecode } from '../../pm/deploy-vibecode.mjs';

const appOrigin = 'https://app-0fdbcfb656d3.vibecode.bitrix24.tech';
const api = '/v1/infra/servers/test-server';
const credentials = { VIBE_KEY: 'fake-key', SERVER_ID: 'test-server' };
const changelog = 'Новая версия игры.';

function fixture(t, release = true, previousSourceId = 'v35', releaseVersion = 'v36') {
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
		writeFileSync(versionFile, "export const GAME_VERSION = '" + releaseVersion + "';\n");
		writeFileSync(join(cwd, 'changelog', releaseVersion + '.txt'), changelog + '\n');
		git('add', '.');
		git('commit', '-m', releaseVersion);
	}
	git('push', 'origin', 'main', '--tags');
	const sha = git('rev-parse', 'HEAD');
	writeFileSync(join(cwd, 'app/untracked.txt'), 'not in source');
	return { cwd, git, sha };
}

function platform({ version = 'v35', sourceId = 'v35', playing = 0, scheduled = 0,
	success = true, storage = true, apply = true, ready = true, preserve = true,
	archive = true, deployVersion = 'v36', steps = [{ step: 'data_dirs', status: 'ok' }] } = {}) {
	const calls = [];
	const tokens = new Map();
	const busy = { v: version, scheduled, playing, storage };
	let time = 0;
	let tokenCount = 0;
	let sourceHash = '0'.repeat(64);
	let payload;
	const objects = new Map();
	let liveSha;
	const archiveId = 'OLD123';
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
				assert(tokens.get(headers.Authorization?.slice('Bearer '.length)) > time, 'live mock bearer');
				if (pathname === '/api/runs') return json({ runs: [{ id: archiveId }] });
				if (pathname === '/api/runs/' + archiveId) return archive || !liveSha ? json({ id: archiveId }) : new Response(null, { status: 404 });
				if (pathname === '/api/deploy-status') {
					assert.equal(method, 'POST');
					const { nonce, signature } = JSON.parse(body);
					assert.match(signature, /^[a-f0-9]{64}$/);
					assert.equal(objects.get('deploy/probe.json'), JSON.stringify(nonce));
					if (preserve && ready) objects.set('deploy/probe.json', JSON.stringify(`ok:${nonce}`));
					return json({ sha: liveSha, archive: preserve, progress: ready, error: 'do not log fake-key' });
				}
				assert.equal(pathname, '/api/busy');
				return json(busy);
			}
			if (origin === 'https://fake-s3.example') {
				assert.equal(headers, undefined);
				return new Response(objects.get(decodeURIComponent(pathname.slice(1))));
			}
			assert.equal(origin, 'https://vibecode.bitrix24.tech');
			assert.equal(headers['X-Api-Key'], credentials.VIBE_KEY);
			if (pathname === '/v1/storage/objects/upload') {
				objects.set(body.get('key'), await body.get('file').text());
				return json({ success: true });
			}
			if (pathname.startsWith('/v1/storage/objects/')) {
				const key = pathname.slice('/v1/storage/objects/'.length);
				return objects.has(decodeURIComponent(key))
					? new Response(null, { status: 302, headers: { location: `https://fake-s3.example/${key}` } })
					: new Response(null, { status: 404 });
			}
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
						busy.v = deployVersion;
						liveSha = payload.env.HORDE_DEPLOY_SHA;
						sourceId = 'v37';
						sourceHash = createHash('sha256').update(Buffer.from(payload.source.content, 'base64')).digest('hex');
					}
					return json({ success, data: { source: { savedVersionId: sourceId }, steps } });
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
			HORDE_DEPLOY_SHA: repo.sha,
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
	assert.equal(mock.payload, undefined);
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


test('a failed tag push recovers the original tested commit after a docs-only main push', async t => {
	const repo = fixture(t);
	const mock = platform();
	const rejected = join(repo.cwd, '..', 'origin', 'hooks', 'pre-receive');
	writeFileSync(rejected, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
	await assert.rejects(run(repo, mock), /git push/);
	assert.equal(remoteTag(repo), '');

	rmSync(rejected);
	repo.git('commit', '--allow-empty', '-m', 'docs-only main advance');
	repo.git('push', 'origin', 'main');
	await run({ ...repo, sha: repo.git('rev-parse', 'HEAD') }, mock);
	assert.equal(remoteTag(repo), `${repo.sha}\trefs/tags/v36^{}`);
	assert.equal(mock.calls.filter(([method, path]) => method === 'POST' && path.endsWith('/deploy')).length, 1);
});

test('recovery accepts the correct upstream tag published after checkout', async t => {
	const repo = fixture(t);
	const mock = platform();
	await run(repo, mock);
	repo.git('tag', '-d', 'v36');
	await run(repo, mock);
	assert.equal(repo.git('rev-parse', 'v36^{}'), repo.sha);
	assert.equal(mock.calls.filter(([method, path]) => method === 'POST' && path.endsWith('/deploy')).length, 1);
});

test('a reverted GAME_VERSION cannot deploy over a newer verified live release', async t => {
	const repo = fixture(t, true, 'v35', 'v38');
	const rejected = join(repo.cwd, '..', 'origin', 'hooks', 'pre-receive');
	const versionFile = join(repo.cwd, 'app/public/shared/content.js');
	writeFileSync(rejected, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
	const mock = platform({ deployVersion: 'v38' });
	await assert.rejects(run(repo, mock), /git push/);
	rmSync(rejected);
	writeFileSync(versionFile, "export const GAME_VERSION = 'v36';\n");
	writeFileSync(join(repo.cwd, 'changelog/v36.txt'), changelog + '\n');
	repo.git('add', versionFile, 'changelog/v36.txt');
	repo.git('commit', '-m', 'revert the release version');
	repo.git('push', 'origin', 'main');

	await assert.rejects(run({ ...repo, sha: repo.git('rev-parse', 'HEAD') }, mock), /старше.*v38/);
	assert.equal(mock.calls.filter(([method, path]) => method === 'POST' && path.endsWith('/deploy')).length, 1);
});

test('a deployed runtime with no persistent archive or progress, or a warning in data_dirs, cannot be tagged on retry', async t => {
	for (const [name, options] of [
		['archive unavailable', { preserve: false }],
		['configured progress cannot be read or written', { ready: false }],
		['previous run disappeared', { archive: false }],
		['platform reports lost data-directory handoff', { steps: [{ step: 'data_dirs', status: 'warning', stdout: 'fake-key' }] }],
	]) {
		await t.test(name, async t => {
			const repo = fixture(t);
			const mock = platform(options);
			await assert.rejects(run(repo, mock), error => /данн|архив|хранилищ|data_dirs/.test(error.message) && !error.message.includes('fake-key'));
			await assert.rejects(run(repo, mock));
			assert.equal(remoteTag(repo), '');
			assert.equal(mock.calls.filter(([method, path]) => method === 'POST' && path.endsWith('/deploy')).length, 1);
		});
	}
});

test('the production HTTP handler verifies the archive and live storage with a signed challenge', { timeout: 10_000 }, async t => {
	const dir = mkdtempSync(join(tmpdir(), 'horde-deploy-status-test-'));
	const sha = 'a'.repeat(40);
	const nonce = randomUUID();
	const child = spawn(process.execPath, ['--input-type=module', '--eval', `
		import fs from 'node:fs';
		import http from 'node:http';
		import path from 'node:path';

		// Mount the production archive path in an isolated test directory.
		for (const name of ['existsSync', 'mkdirSync', 'readdirSync', 'mkdtempSync']) {
			const real = fs[name];
			fs[name] = (file, ...args) => {
				const root = ['/opt/data/runs', '/tmp/horde-runs'].find(root => file === root || file.startsWith(root + '/'));
				return real(root ? path.join(process.env.TEST_DIR, path.basename(root), file.slice(root.length)) : file, ...args);
			};
		}
		const listen = http.Server.prototype.listen;
		http.Server.prototype.listen = function () {
			return listen.call(this, 0, '127.0.0.1', () => process.send(this.address().port));
		};

		let value = JSON.stringify(process.env.TEST_NONCE);
		globalThis.fetch = async (url, options) => {
			const { origin, pathname } = new URL(url);
			if (origin === 'https://objects.test' && pathname === '/probe') return new Response(value);
			if (origin !== 'https://vibecode.bitrix24.tech' || options.headers['X-Api-Key'] !== process.env.VIBE_APP_KEY) {
				throw new Error('Unexpected storage request');
			}
			if (pathname === '/v1/storage/objects/deploy%2Fprobe.json') {
				return new Response(null, { status: 302, headers: { location: 'https://objects.test/probe' } });
			}
			if (pathname === '/v1/storage/objects/upload' && options.body.get('key') === 'deploy/probe.json'
				&& options.body.get('visibility') === 'PRIVATE') {
				value = await options.body.get('file').text();
				process.send(value);
				return Response.json({ success: true });
			}
			throw new Error('Unexpected storage request');
		};
		await import(${JSON.stringify(new URL('./server.js', import.meta.url).href)});
	`], {
		env: { PATH: process.env.PATH, NODE_ENV: 'production', VIBE_APP_KEY: credentials.VIBE_KEY, HORDE_DEPLOY_SHA: sha,
			TEST_DIR: dir, TEST_NONCE: nonce },
		stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
	});
	const exited = once(child, 'exit');
	t.after(async () => {
		child.kill();
		await exited;
		rmSync(dir, { recursive: true, force: true });
	});
	const [port] = await Promise.race([once(child, 'message'), exited.then(([code]) => { throw new Error(`server exited with ${code}`); })]);
	const post = signature => fetch(`http://127.0.0.1:${port}/api/deploy-status`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce, signature }),
	});
	assert.equal((await post('0'.repeat(64))).status, 403);
	const written = once(child, 'message');
	const signature = createHmac('sha256', credentials.VIBE_KEY).update(`${sha}:${nonce}`).digest('hex');
	const response = await post(signature);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { sha, archive: true, progress: true });
	const [stored] = await written;
	assert.equal(stored, JSON.stringify(`ok:${nonce}`));
	assert.deepEqual(readdirSync(join(dir, 'runs')), []);
	assert.equal((await post(signature)).status, 409);
});
