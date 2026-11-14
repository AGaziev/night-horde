import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { setTimeout as pauseFor } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { gzipSync } from 'node:zlib';
import { vibeBackend } from '../app/server/storage.js';

const platformOrigin = 'https://vibecode.bitrix24.tech';
const appOrigin = 'https://app-0fdbcfb656d3.vibecode.bitrix24.tech';
const versionPattern = /^v[1-9]\d*$/;
const versionFile = 'app/public/shared/content.js';
const requestTimeout = 30_000;
const deployTimeout = 20 * 60_000;
const scheduledWaitTimeout = 35 * 60_000;
const scheduledPollInterval = 10_000;
const busyTokenTtlSeconds = 600;
const busyTokenRenewAfter = 8 * 60_000;

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

function releaseSourceId(cwd, tag) {
	const [type, subject] = git(cwd, 'for-each-ref', '--format=%(objecttype)%09%(contents:subject)', `refs/tags/${tag}`)
		.toString().trim().split('\t');
	return type === 'tag' ? subject?.match(/^Vibecode source: (v[1-9]\d*)$/)?.[1] : undefined;
}

function previousRelease(cwd, sha) {
	const tags = git(cwd, 'tag', '--merged', sha, '--list', 'v*', '--sort=-version:refname').toString().split('\n');
	const tag = tags.find(tag => versionPattern.test(tag));
	if (!tag || gameVersion(cwd, `refs/tags/${tag}`) !== tag) {
		throw new Error('Последний релизный тег в проверенном коммите должен совпадать с GAME_VERSION своего коммита.');
	}
	return { tag, sourceId: releaseSourceId(cwd, tag) ?? tag };
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

	async function request(label, url, { method = 'GET', headers = keyHeader, body, timeout = requestTimeout } = {}) {
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
		async currentSource(timeout) {
			const result = await request('Исходники Vibecode', `${api}/sources`, { timeout });
			const { currentVersionId, versions } = result?.data ?? {};
			const source = Array.isArray(versions) && versions.find(source => source?.versionId === currentVersionId);
			if (result?.success !== true || !versionPattern.test(currentVersionId ?? '') || source?.deployStatus !== 'success') {
				throw new Error('Не удалось подтвердить текущий исходник успешной выкладки Vibecode.');
			}
			return source;
		},
		async withBusy(check) {
			const result = await request('Выпуск токена', `${api}/access-tokens`, {
				method: 'POST', body: { mode: 'api-bearer', ttlSeconds: busyTokenTtlSeconds },
			});
			const { id, token } = result?.data ?? {};
			if (typeof id !== 'string' || !id) throw new Error('Vibecode не вернул ID токена для отзыва.');
			try {
				if (result?.success !== true || typeof token !== 'string' || !token) {
					throw new Error('Vibecode не вернул токен для проверки прода.');
				}
				const headers = { Authorization: `Bearer ${token}` };
				return await check(
					timeout => request('/api/busy', `${appOrigin}/api/busy`, { headers, timeout }),
					(path, { body, timeout } = {}) => request('Проверка данных приложения', `${appOrigin}${path}`, {
						headers, method: body ? 'POST' : 'GET', body, timeout,
					}),
				);
			} finally {
				try {
					await request('Отзыв токена', `${api}/access-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
				} catch {
					console.warn('Vibecode не подтвердил отзыв токена. Токен действует не более 10 минут.');
				}
			}
		},
		async deploy({ archive, sourceId, changelog, sha }) {
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
						HORDE_DEPLOY_SHA: sha,
					},
					displayName: 'Ночная орда',
					changelog,
				},
			});
			const savedId = result?.data?.source?.savedVersionId;
			if (result?.success !== true || !versionPattern.test(savedId ?? '')) {
				throw new Error('Vibecode не подтвердил успешную выкладку и сохранение исходников.');
			}
			const steps = result?.data?.steps;
			if (!Array.isArray(steps) || !steps.some(step => step?.step === 'data_dirs' && step.status === 'ok')
				|| steps.some(step => step?.status !== 'ok' && ['data_dirs', 'env', 'platform_env', 'app_secrets', 'service_user', 'hardening', 'healthcheck', 'app_root'].includes(step?.step))) {
				throw new Error('Vibecode не подтвердил data_dirs или другой обязательный шаг запуска приложения.');
			}
			if (Array.isArray(result.warnings) && result.warnings.some(warning =>
				typeof warning === 'string' && /\b(?:NODE_ENV|VIBE_APP_KEY|HORDE_(?:DEPLOY_SHA|VIBE_SERVER_ID|APP_ORIGIN))\b/.test(warning))) {
				throw new Error('Vibecode сообщил предупреждение о переменных приложения.');
			}
			return savedId;
		},
	};
}

function releaseArchive(cwd, sha) {
	const timestamp = git(cwd, 'show', '-s', '--format=%cI', sha).toString().trim();
	const tar = git(cwd, 'archive', '--format=tar', `--mtime=${timestamp}`, `${sha}:app`);
	const archive = gzipSync(tar, { level: 9 });
	return { archive, sha256: createHash('sha256').update(archive).digest('hex') };
}

async function verifyProduction(client, version, sha, previousRun, progress, key, pause) {
	const nonce = randomUUID();
	const probeKey = 'deploy/probe.json';
	const signature = createHmac('sha256', key).update(`${sha}:${nonce}`).digest('hex');
	let ready;
	try {
		await progress.put(probeKey, JSON.stringify(nonce));
		ready = await client.withBusy(async (read, appRequest) => {
			for (let attempt = 0; attempt < 5; attempt++) {
				if (attempt > 0) await pause(3000);
				const status = await read().catch(() => null);
				if (status?.v !== version || status.storage !== true) continue;
				const proof = await appRequest('/api/deploy-status', { body: { nonce, signature } });
				if (proof?.sha !== sha || proof.archive !== true || proof.progress !== true
					|| await progress.get(probeKey) !== JSON.stringify(`ok:${nonce}`)) {
					throw new Error('Приложение не подтвердило запись архива и чтение/запись хранилища прогресса.');
				}
				if (previousRun) {
					const currentRun = await appRequest(`/api/runs/${previousRun.id}`);
					if (!isDeepStrictEqual(currentRun, previousRun)) {
						throw new Error('Приложение не подтвердило прежний архив забегов.');
					}
				}
				return true;
			}
			return false;
		});
	} catch {
		throw new Error('Не подтверждена сохранность данных: архив забегов или хранилище прогресса недоступны.');
	}
	if (!ready) throw new Error(`/api/busy не подтвердил ${version} с включённым хранилищем прогресса.`);
}

async function recoverRelease(cwd, sha, liveVersion, source, progress) {
	let receipt;
	try {
		receipt = JSON.parse(await progress.get(`deploy/releases/${liveVersion}.json`) || 'null');
	} catch {
		throw new Error('Не удалось прочитать запись о проверенной выкладке.');
	}
	const { ref, sha256, sourceId, version } = receipt ?? {};
	if (version !== liveVersion || sourceId !== source.versionId || sha256 !== source.sha256
		|| !/^[a-f0-9]{40}$/.test(ref ?? '')
		|| git(cwd, 'merge-base', ref, sha).toString().trim() !== ref
		|| gameVersion(cwd, ref) !== version || releaseArchive(cwd, ref).sha256 !== sha256) {
		throw new Error(`Не подтверждён проверенный коммит для ${liveVersion}: источник, архив или запись о выпуске не совпадают.`);
	}
	const tagRef = `refs/tags/${version}`;
	if (git(cwd, 'ls-remote', '--tags', 'origin', tagRef).toString().trim()) {
		git(cwd, 'fetch', '--no-tags', 'origin', `${tagRef}:${tagRef}`);
		if (git(cwd, 'rev-parse', `${tagRef}^{}`).toString().trim() !== ref || releaseSourceId(cwd, version) !== sourceId) {
			throw new Error(`Тег ${version} уже существует с другой привязкой.`);
		}
	} else {
		recordRelease(cwd, ref, version, sourceId);
	}
	return ref;
}

function hasScheduledStarts(busy, previousVersion) {
	if (busy?.v !== previousVersion) {
		throw new Error(`На проде ожидалась версия ${previousVersion}. Выкладка остановлена.`);
	}
	if (!Number.isSafeInteger(busy.scheduled) || busy.scheduled < 0) {
		throw new Error('/api/busy: состояние запланированных стартов неизвестно.');
	}
	return busy.scheduled > 0;
}

function assertReleaseSource(source, previous) {
	if (source.versionId !== previous.sourceId) {
		throw new Error(`Текущий исходник Vibecode не соответствует тегу ${previous.tag}. Выкладка остановлена.`);
	}
}

export async function deployVibecode({ cwd, sha, env, fetch = globalThis.fetch, pause = pauseFor,
	now = () => performance.now() }) {
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
	const { archive, sha256 } = releaseArchive(cwd, sha);
	const client = vibecodeClient(fetch, env);
	const progress = vibeBackend(env.VIBE_KEY, { fetchImpl: fetch });
	const source = await client.currentSource();
	const initial = await client.withBusy(read => read());
	if (initial?.v === previous.tag) assertReleaseSource(source, previous);
	let liveRelease = previous;
	if (versionPattern.test(initial?.v ?? '') && BigInt(initial.v.slice(1)) > BigInt(previous.tag.slice(1))) {
		if (initial.storage !== true) throw new Error('/api/busy: хранилище прогресса выключено.');
		const recovered = await recoverRelease(cwd, sha, initial.v, source, progress);
		if (initial.v === version) return `Выкладка ${version} уже подтверждена. Тег проверен для ${recovered}.`;
		if (BigInt(version.slice(1)) < BigInt(initial.v.slice(1))) {
			throw new Error(`GAME_VERSION ${version} старше уже выложенного релиза ${initial.v}.`);
		}
		liveRelease = { tag: initial.v, sourceId: source.versionId };
	}
	assertMainHead(cwd, sha);

	const deadline = now() + scheduledWaitTimeout;
	const remaining = () => {
		const ms = Math.ceil(deadline - now());
		if (ms <= 0) throw new Error('Не удалось дождаться завершения запланированных стартов за 35 минут.');
		return Math.min(ms, requestTimeout);
	};
	let savedId;
	let previousRun;
	while (savedId === undefined) {
		remaining();
		savedId = await client.withBusy(async (read, appRequest) => {
			const renewAt = now() + busyTokenRenewAfter;
			while (now() < renewAt) {
				const busy = await read(remaining());
				const scheduled = hasScheduledStarts(busy, liveRelease.tag);
				if (!scheduled) {
					const oldRuns = await appRequest('/api/runs', { timeout: remaining() });
					if (!Array.isArray(oldRuns?.runs)) throw new Error('Не удалось прочитать текущий архив забегов.');
					const archiveId = oldRuns.runs[0]?.id;
					if (oldRuns.runs.length && !/^[A-Z0-9]{6}$/.test(archiveId ?? '')) {
						throw new Error('В архиве забегов получен неизвестный идентификатор.');
					}
					previousRun = archiveId ? await appRequest(`/api/runs/${archiveId}`, { timeout: remaining() }) : null;
					if (archiveId && previousRun?.id !== archiveId) throw new Error('Не удалось прочитать запись архива забегов.');
					if (now() >= renewAt) break;
					const current = await client.currentSource(remaining());
					assertReleaseSource(current, liveRelease);
					const latest = await read(remaining());
					if (!hasScheduledStarts(latest, liveRelease.tag)) {
						remaining();
						assertMainHead(cwd, sha);
						return client.deploy({ archive, sourceId: current.versionId, changelog, sha });
					}
				}
				await pause(Math.min(scheduledPollInterval, remaining()));
			}
		});
	}
	await verifyProduction(client, version, sha, previousRun, progress, env.VIBE_KEY, pause);
	const deployed = await client.currentSource();
	if (deployed.versionId !== savedId || deployed.sha256 !== sha256) {
		throw new Error('Vibecode не подтвердил хеш архива проверенного коммита.');
	}
	const receiptKey = `deploy/releases/${version}.json`;
	const receipt = JSON.stringify({ ref: sha, sha256, sourceId: savedId, version });
	try {
		await progress.put(receiptKey, receipt);
		if (await progress.get(receiptKey) !== receipt) throw new Error();
	} catch {
		throw new Error('Не удалось сохранить подтверждение выкладки для восстановления тега.');
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
