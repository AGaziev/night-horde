import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as pauseFor } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const platformOrigin = 'https://vibecode.bitrix24.tech';
const appOrigin = 'https://app-0fdbcfb656d3.vibecode.bitrix24.tech';
const versionPattern = /^v[1-9]\d*$/;
const versionFile = 'app/public/shared/content.js';
const deployTimeout = 20 * 60_000;

function git(cwd, ...args) {
	try {
		return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
	} catch {
		throw new Error(`Команда git ${args[0]} завершилась ошибкой.`);
	}
}

function gameVersion(cwd, ref) {
	const content = git(cwd, 'show', `${ref}:${versionFile}`).toString();
	const version = content.match(/^export const GAME_VERSION = '(v[1-9]\d*)';$/m)?.[1];
	if (!version) throw new Error(`GAME_VERSION в ${ref} должен быть в формате vN.`);
	return version;
}

function previousRelease(cwd, sha) {
	const tags = git(cwd, 'tag', '--merged', sha, '--list', 'v*', '--sort=-version:refname').toString().split('\n');
	const tag = tags.find(tag => versionPattern.test(tag));
	if (!tag || gameVersion(cwd, `refs/tags/${tag}`) !== tag) {
		throw new Error('Последний релизный тег в проверенном коммите должен совпадать с GAME_VERSION своего коммита.');
	}
	const [type, subject] = git(cwd, 'for-each-ref', '--format=%(objecttype)%09%(contents:subject)', `refs/tags/${tag}`)
		.toString().trim().split('\t');
	const sourceId = type === 'tag' && subject?.match(/^Vibecode source: (v[1-9]\d*)$/)?.[1];
	return { tag, sourceId: sourceId || tag };
}

function assertMainHead(cwd, sha) {
	const head = git(cwd, 'ls-remote', '--exit-code', 'origin', 'refs/heads/main').toString().split('\t')[0];
	if (head !== sha) throw new Error('origin/main уже обновился. Выкладку выполнит CI актуального коммита.');
}

function recordRelease(cwd, sha, version, sourceId) {
	git(cwd, '-c', 'user.name=github-actions[bot]',
		'-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
		'tag', '-a', version, sha, '-m', `Vibecode source: ${sourceId}`);
	try {
		git(cwd, 'push', 'origin', `refs/tags/${version}:refs/tags/${version}`);
	} catch (error) {
		git(cwd, 'tag', '-d', version);
		throw error;
	}
}

function vibecodeClient(fetch, { VIBE_KEY: key, SERVER_ID: serverId }) {
	if (!key || !/^[a-zA-Z0-9_-]+$/.test(serverId ?? '')) {
		throw new Error('Для релиза нужны GitHub Actions secrets VIBE_KEY и SERVER_ID.');
	}
	const api = `${platformOrigin}/v1/infra/servers/${serverId}`;
	const keyHeader = { 'X-Api-Key': key };

	async function request(label, url, { method = 'GET', headers = keyHeader, body, timeout = 30_000 } = {}) {
		let response;
		try {
			response = await fetch(url, {
				method, redirect: 'error', signal: AbortSignal.timeout(timeout),
				headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
				body: body ? JSON.stringify(body) : undefined,
			});
		} catch {
			throw new Error(`${label}: нет ответа от сервера.`);
		}
		if (!response.ok) {
			await response.body?.cancel().catch(() => {});
			throw new Error(`${label}: HTTP ${response.status}.`);
		}
		if (method === 'DELETE') {
			await response.body?.cancel().catch(() => {});
			return;
		}
		try {
			return await response.json();
		} catch {
			throw new Error(`${label}: не удалось прочитать JSON ответа.`);
		}
	}

	return {
		async currentSource() {
			const result = await request('Исходники Vibecode', `${api}/sources`);
			const { currentVersionId, versions } = result?.data ?? {};
			const source = Array.isArray(versions) && versions.find(source => source?.versionId === currentVersionId);
			if (result?.success !== true || !versionPattern.test(currentVersionId ?? '') || source?.deployStatus !== 'success') {
				throw new Error('Не удалось подтвердить текущий исходник успешной выкладки Vibecode.');
			}
			return source;
		},
		async withBusy(check) {
			const result = await request('Выпуск токена', `${api}/access-tokens`, {
				method: 'POST', body: { mode: 'api-bearer', ttlSeconds: 600 },
			});
			const { id, token } = result?.data ?? {};
			if (typeof id !== 'string' || !id) throw new Error('Vibecode не вернул ID токена для отзыва.');
			try {
				if (result?.success !== true || typeof token !== 'string' || !token) {
					throw new Error('Vibecode не вернул токен для проверки прода.');
				}
				return await check(() => request('/api/busy', `${appOrigin}/api/busy`, {
					headers: { Authorization: `Bearer ${token}` },
				}));
			} finally {
				try {
					await request('Отзыв токена', `${api}/access-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
				} catch {
					console.warn('Vibecode не подтвердил отзыв токена. Токен действует не более 10 минут.');
				}
			}
		},
		async deploy({ archive, sourceId, changelog }) {
			const result = await request('Выкладка Vibecode', `${api}/deploy`, {
				method: 'POST', timeout: deployTimeout,
				body: {
					source: { content: archive.toString('base64') },
					baseVersionId: sourceId,
					install: 'cd /opt/app && npm ci --omit=dev',
					start: 'cd /opt/app && node server/server.js',
					port: 3000,
					healthPath: '/health',
					dataDirs: ['/opt/data'],
					env: {
						NODE_ENV: 'production',
						VIBE_APP_KEY: key,
						HORDE_VIBE_SERVER_ID: serverId,
						HORDE_APP_ORIGIN: appOrigin,
					},
					displayName: 'Ночная орда',
					changelog,
				},
			});
			const savedId = result?.data?.source?.savedVersionId;
			if (result?.success !== true || !versionPattern.test(savedId ?? '')) {
				throw new Error('Vibecode не подтвердил успешную выкладку и сохранение исходников.');
			}
			return savedId;
		},
	};
}

async function verifyProduction(client, version, pause) {
	await client.withBusy(async read => {
		for (let attempt = 0; attempt < 5; attempt++) {
			if (attempt > 0) await pause(3000);
			const status = await read().catch(() => null);
			if (status?.v === version && status.storage === true) return;
		}
		throw new Error(`/api/busy не подтвердил ${version} с включённым хранилищем прогресса.`);
	});
}

export async function deployVibecode({ cwd, sha, env, fetch = globalThis.fetch, pause = pauseFor }) {
	if (!/^[a-f0-9]{40}$/.test(sha ?? '') || git(cwd, 'rev-parse', 'HEAD').toString().trim() !== sha) {
		throw new Error('Checkout не совпадает с проверенным SHA.');
	}
	const previous = previousRelease(cwd, sha);
	const version = gameVersion(cwd, sha);
	if (version === previous.tag) return `GAME_VERSION остался ${version}. Выкладка пропущена.`;
	if (BigInt(version.slice(1)) < BigInt(previous.tag.slice(1))) {
		throw new Error(`GAME_VERSION ${version} старше последнего релиза ${previous.tag}.`);
	}
	if (git(cwd, 'tag', '--list', version).toString().trim()) {
		throw new Error(`Тег ${version} уже занят вне проверенного коммита.`);
	}

	const changelog = git(cwd, 'show', `${sha}:changelog/${version}.txt`).toString().trim();
	if (!changelog || changelog.length > 2000) {
		throw new Error(`В changelog/${version}.txt нужен текст длиной от 1 до 2000 символов.`);
	}
	assertMainHead(cwd, sha);
	const timestamp = git(cwd, 'show', '-s', '--format=%cI', sha).toString().trim();
	const tar = git(cwd, 'archive', '--format=tar', `--mtime=${timestamp}`, `${sha}:app`);
	const archive = gzipSync(tar, { level: 9 });
	const sha256 = createHash('sha256').update(archive).digest('hex');

	const client = vibecodeClient(fetch, env);
	const source = await client.currentSource();
	const busy = await client.withBusy(read => read());
	if (busy?.v === version) {
		if (source.sha256 !== sha256) throw new Error(`На проде уже ${version} из другого архива.`);
		if (busy.storage !== true) throw new Error('/api/busy: хранилище прогресса выключено.');
		recordRelease(cwd, sha, version, source.versionId);
		return `Выкладка ${version} уже подтверждена. Тег восстановлен для ${sha}.`;
	}

	if (busy?.v !== previous.tag) throw new Error(`На проде ожидалась версия ${previous.tag}. Выкладка остановлена.`);
	if (source.versionId !== previous.sourceId) {
		throw new Error(`Текущий исходник Vibecode не соответствует тегу ${previous.tag}. Выкладка остановлена.`);
	}
	if (busy.scheduled !== 0) throw new Error('На проде есть запланированный старт или его состояние неизвестно.');
	assertMainHead(cwd, sha);

	const savedId = await client.deploy({ archive, sourceId: source.versionId, changelog });
	await verifyProduction(client, version, pause);
	const deployed = await client.currentSource();
	if (deployed.versionId !== savedId || deployed.sha256 !== sha256) {
		throw new Error('Vibecode не подтвердил хеш архива проверенного коммита.');
	}
	recordRelease(cwd, sha, version, savedId);
	return `Выкладка ${version} подтверждена. Тег записан для ${sha}.`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		console.log(await deployVibecode({ cwd: process.cwd(), sha: process.env.GITHUB_SHA, env: process.env }));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
