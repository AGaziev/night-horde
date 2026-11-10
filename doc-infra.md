
# Инфраструктура

Создание и управление виртуальными серверами для деплоя приложений Битрикс24. Каждый сервер невидим из интернета по умолчанию (режим Black Hole) — доступ к приложению только через HTTPS-субдомен `app-{id}.vibecode.bitrix24.tech`. Управление сервером и деплой — через REST API без SSH.

**Скоуп:** `vibe:infra` · **Базовый URL:** `https://vibecode.bitrix24.tech/v1` · **Авторизация:** заголовок `X-Api-Key`

## Разделы документации

- [Провайдеры и каталоги](/docs/infra/providers) — список провайдеров, тарифов, регионов и образов ОС (4 эндпоинта).
- [Сколько стоит инфраструктура](/docs/infra/pricing) — из чего складывается стоимость сервера в Вайбах, как остановить списания и где смотреть расход.
- [Серверы](/docs/infra/servers) — создание, список, детали, правка имени и описания, удаление, лента событий сервера (8 эндпоинтов).
- [Жизненный цикл](/docs/infra/lifecycle) — старт, стоп, сон, пробуждение, режим работы, ремонт туннеля, статус провижининга (10 эндпоинтов).
- [Пробуждение по расписанию](/docs/infra/wake-schedules) — окна автоматического пробуждения спящего сервера по cron-расписанию (4 эндпоинта).
- [Библиотека расписаний работы](/docs/infra/work-schedules) — расписания для режима «по расписанию»: готовые и свои, общие на портал, и расписание, на котором рождаются новые машины (6 эндпоинтов).
- [Доступ и режимы](/docs/infra/access) — политика доступа, список пользователей/отделов, SSH-данные, режим BLACKHOLE↔OPEN (7 эндпоинтов).
- [Свой домен](/docs/infra/domain) — привязка собственного домена к приложению на сервере: DNS-записи, проверка, отвязка (4 эндпоинта).
- [Deploy API](/docs/infra/deploy) — выполнение команд, загрузка файлов, логи, деплой приложения, исход и список операций, исход операции из ленты сервера, порт, метрики, лок, рантаймы (11 эндпоинтов).
- [Токены доступа](/docs/infra/access-tokens) — краткосрочные токены для e2e-проверки и распространяемых ссылок (4 эндпоинта, раздел включается на стороне платформы).
- [Что приходит в приложение](/docs/infra/app-runtime) — Gateway подставляет `X-Vibe-Authorization: Bearer`, чтение данных пользователя через `/v1/me`, скелеты обработчика на Node/Python/Go.
- [Перенос приложения на свой сервер](/docs/infra/move-to-own-server) — что поменять в коде и адресе при переезде из кабинета на собственный сервер и как вернуться обратно.
- [Подписки на события портала](/docs/infra/event-subscriptions) — доставка событий Битрикс24 (`ONTASKADD` и подобных) в приложение через туннель, без опроса (3 эндпоинта).
- [Доставка вызовов действий и роботов](/docs/infra/bizproc-callbacks) — обработчик действия или робота на субдомене Black Hole: очередь вызовов, пробуждение спящего сервера, регистрация одиночным запросом.
- [Galaxy-приложение](/docs/infra/galaxy) — режим размещения «контейнер в общей галактике»: как отличить от обычного сервера (`kind`), жизненный цикл со сборкой при загрузке кода, стоимость за галактику.
- [Сон и пробуждение Galaxy-приложения](/docs/infra/galaxy-sleep) — что останавливается на время сна, какие поля показывают настоящее состояние и чем поднять приложение.
- [База данных приложения](/docs/infra/database) — SQLite-база Galaxy-приложения: схема, строки, SQL-запросы, копии базы и восстановление из копии (13 эндпоинтов).
- [Восстановление доступа к серверу](/docs/infra/server-access-recovery) — сервер работает, но новый ключ его не видит: пустой список, `404 NOT_FOUND`, смена управляющего ключа.

## Что важно знать сразу

1. **Порт приложения — всегда 3000.** Black Hole туннель проксирует ровно этот порт, менять его не нужно. Сервер — изолированное окружение: `:3000` внутри виртуальной машины никак не связан с портами вашей локальной машины.
2. **Deploy API — только для BLACKHOLE.** Все `/deploy`, `/exec`, `/upload`, `/logs` требуют серверов в режиме `BLACKHOLE` со статусом `CONNECTED` для агента туннеля. Для OPEN-серверов они вернут ошибку.
3. **`/deploy` и `/exec` отдают JSON по умолчанию.** Это безопасно для AI-агентов и MCP-клиентов — никаких дополнительных параметров запроса не нужно. Если вам действительно нужен потоковый ответ (вывод шагов деплоя в реальном времени в UI), передайте `?stream=true` — тогда вернётся SSE (Server-Sent Events). Раньше документация утверждала обратное (по умолчанию SSE, `?stream=false` для JSON) — это устарело и больше не соответствует поведению API.
4. **`accessPolicy` — это безопасность.** Смена политики с `OWNER_ONLY` на `PORTAL`/`AUTHENTICATED`/`PUBLIC` открывает приложение другим пользователям. **Никогда не меняйте `accessPolicy` без явного подтверждения пользователя.**
5. **Сервер — это чистая Ubuntu 24.04, рут-доступ включён.** Виртуальная машина создаётся из стандартного образа Ubuntu без предустановленного ПО (кроме агента туннеля). Агент работает от имени пользователя `root` — в `preStart`, `install` и командах `/exec` `sudo` не нужен. Исходящий интернет доступен без ограничений: `apt-get`, `curl`, `wget`, `pip` работают напрямую. Входящий трафик заблокирован кроме туннельного соединения. **Само приложение при этом запускается не от `root`, а под выделенной непривилегированной учётной записью** — это касается только процесса приложения, команды деплоя и `/exec` по-прежнему выполняются с правами администратора. Подробности и как отключить — [Деплой приложения](/docs/infra/deploy/deploy).
6. **Тариф Битрикс24 играет двойную роль.** Во-первых, REST API самого Битрикс24 доступен только на коммерческих тарифах портала — без этого не работают ни приложения, ни прокси `/v1/deals`, ни боты, ни любой другой вызов, который проксируется в Битрикс24. Во-вторых, поверх этого — создание серверов и деплой требуют доступа к платформе, а чем он открывается, зависит от региона портала: в России — активной подпиской BitrixGPT + Маркетплейс, в Казахстане и Узбекистане — платным или демо-тарифом Битрикс24, в Беларуси — платным или демо-тарифом Битрикс24 либо платной подпиской Битрикс24 Маркет Плюс. Когда доступ заканчивается, платформа усыпляет серверы портала и запрещает их пробуждение. AI Router работает независимо от тарифа Битрикс24 — он не проксирует в REST и доступен даже на бесплатных тарифах (BYOK бесплатно, платформенные модели тарифицируются с баланса Вайбкод). Подробности — в разделе «Тариф и доступ» ниже.
7. **Авторизация пользователя в приложении.** На каждом запросе **через Gateway** — то есть когда приложение открывают в браузере — он проставляет шесть заголовков с префиксом `X-Vibe-`: `Request-Id` всегда плюс `User-Id`, `User-Name`, `User-Role`, `Portal-Id`, `Authorization` (`Bearer vibe_session_<…>`) для аутентифицированного запроса. Браузер `Authorization`-токен не видит и не хранит — он живёт только между Gateway и app-сервером. Для быстрого идентификатора пользователя достаточно заголовка `X-Vibe-User-Id`. Полный контекст (скоупы, `capabilities`, тариф, информация о приложении) — одним вызовом `GET /v1/me` с серверным кэшированием. ID пользователя в ответе `/v1/me` — `data.currentUser.bitrixUserId`, домен портала — `data.portal`. У [внешнего API приложения](/docs/applications/external-api) путь другой, и заголовков личности на нём нет. Полная таблица заголовков, BFF-паттерн и скелеты обработчика на Node/Python/Go — [Что приходит в приложение](/docs/infra/app-runtime).
8. **Новая машина засыпает через 60 минут простоя.** Отдельная виртуальная машина создаётся с таймаутом простоя 60 минут. Исключение — портал, где администратор отметил расписание для новых машин: машина рождается на нём и работает в его окна, см. [Отметить расписание по умолчанию](/docs/infra/work-schedules/set-default). Простой считается по входящим запросам **к** приложению — обращениям к его HTTPS-субдомену. Запросы, которые приложение отправляет само наружу, таймер не сбрасывают, поэтому приложение, которое живёт постоянным опросом внешнего API, через час останавливается вместе с машиной. Допустимые значения таймаута и отключение авто-сна значением `null` — [Настроить авто-сон](/docs/infra/lifecycle/sleep).
9. **Создание серверов требует пользовательской сессии для ключей `vibe_app_`.** `POST /v1/infra/servers` проходит тарифную проверку, которой нужно знать, кто именно создаёт сервер. Для `vibe_api_` пользовательский контекст уже есть в самом ключе, для `vibe_app_` обязателен `Authorization: Bearer <session>` — без него ответ `401 UNAUTHENTICATED` с `error.hint`, указывающим на OAuth-авторизацию. Чтение и Deploy API на уже существующих серверах сессии не требуют — таблица «Авторизация эндпоинтов» ниже сводит все правила в одном месте.
10. **Что-то сломалось — начните с ленты событий сервера.** [`GET /v1/infra/servers/:id/activity`](/docs/infra/servers/activity) показывает недоставленные события портала, проблемы доставки боту, провалы выкладок, пробуждения и смены статуса за 30 дней.

## Быстрый старт

Три вызова — создание сервера и запуск приложения.

### curl — личный ключ

```bash
export VIBE_KEY="YOUR_API_KEY"

# 1. Создать сервер (автоматически в режиме Black Hole)
curl -X POST https://vibecode.bitrix24.tech/v1/infra/servers \
  -H "X-Api-Key: $VIBE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "bitrix-cloud",
    "name": "my-app",
    "plan": "bc-small",
    "region": "ru-central1-b",
    "image": "fd83esfomhq25p2ono90"
  }'

# 2. Отдельная виртуальная машина — дождаться готовности:
#    status=running И blackholeStatus=CONNECTED.
#    Galaxy-приложение (kind=GALAXY_APP в ответе шага 1) этого состояния
#    не достигает — переходите к шагу 3 сразу, см. примечание ниже.
curl -H "X-Api-Key: $VIBE_KEY" \
  https://vibecode.bitrix24.tech/v1/infra/servers/SERVER_ID

# 3. Задеплоить приложение (JSON — режим по умолчанию).
#    Пример ниже — для отдельной виртуальной машины: код берётся
#    по внешнему адресу. Galaxy-приложение принимает только встроенный
#    архив — "source": { "content": "<base64>" }, см. примечание ниже.
#    X-Skip-Source-Snapshot: деплой с внешнего URL при включённом
#    хранилище исходников, иначе 409 SNAPSHOT_REQUIRED (см. ниже).
curl -X POST "https://vibecode.bitrix24.tech/v1/infra/servers/SERVER_ID/deploy" \
  -H "X-Api-Key: $VIBE_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Skip-Source-Snapshot: deploy from external URL" \
  -d '{
    "source": { "url": "https://github.com/user/app/archive/main.tar.gz" },
    "runtime": "node24",
    "install": "cd /opt/app && npm install --production",
    "start": "cd /opt/app && node server.js",
    "port": 3000
  }'
```

Приложение доступно по адресу `https://app-{id}.vibecode.bitrix24.tech` — поле `appUrl` в ответе `/deploy`.

**Деплой с внешнего URL и хранилище исходников.** Когда на портале включено [хранилище исходников](/docs/source-storage), деплой с внешнего адреса — не из хранилища Вайбкод — возвращает `409 SNAPSHOT_REQUIRED`, чтобы история версий приложения не терялась. Заголовок `X-Skip-Source-Snapshot: <причина>` продолжает деплой без сохранения снимка. Чтобы снимок сохранился, сначала загрузите архив через `POST /v1/apps/:id/sources`, затем разверните его через `{ "source": { "versionId": "vN" } }`. Подробнее — [Хранилище исходников](/docs/source-storage).

### curl — OAuth-приложение

```bash
# То же самое, только добавляется заголовок Authorization: Bearer с токеном сессии
curl -X POST https://vibecode.bitrix24.tech/v1/infra/servers \
  -H "X-Api-Key: YOUR_APP_KEY" \
  -H "Authorization: Bearer USER_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "provider": "bitrix-cloud", "name": "my-app", "plan": "bc-small", "region": "ru-central1-b", "image": "fd83esfomhq25p2ono90" }'
```

> **Galaxy-приложение — другой контракт.** Если портал размещает приложения в галактиках, тот же `POST /v1/infra/servers` создаёт galaxy-приложение — контейнер на общем хосте. В ответе создания у него `kind` равен `GALAXY_APP`, а `createdVia` — `galaxy`. Такое приложение до `blackholeStatus: "CONNECTED"` не доходит: контейнер собирается загрузкой кода, поэтому шаг 2 для него отпадает, а код загружают **сразу после создания**. Источник кода при этом — встроенный архив в base64, поле `source.content`. Вариант `source.url` доступен там, где платформа включила для вас выкладку по ссылке (иначе `400 GALAXY_DEPLOY_CONTENT_ONLY`), и ведёт только в [хранилище исходников](/docs/source-storage) платформы (иначе `400 GALAXY_SOURCE_URL_NOT_ALLOWED`), а `source.versionId` на создании не принимается — сохранённую версию выкладывают вторым шагом, через `POST /v1/infra/servers/:id/deploy`. Поля `runtime` и `start` обязательны. Нужна именно отдельная виртуальная машина — передайте в теле создания поле `placement` равным `dedicated`. Полная модель, жизненный цикл, стоимость и отличия деплоя — [Galaxy-приложение](./infra/galaxy).

## Полный пример

Реалистичный сценарий на JavaScript — создание сервера, ожидание готовности, деплой, получение URL приложения.

```javascript
const VIBE_KEY = process.env.VIBE_KEY
const BASE = 'https://vibecode.bitrix24.tech/v1'

async function api(method, path, body = null, extraHeaders = {}) {
  const opts = { method, headers: { 'X-Api-Key': VIBE_KEY, ...extraHeaders } }
  if (body) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
  return res.json()
}

// 1. Выбрать провайдера, тариф, регион, образ
const { data: plans } = await api('GET', '/infra/providers/bitrix-cloud/plans')
const { data: regions } = await api('GET', '/infra/providers/bitrix-cloud/regions')
const { data: images } = await api('GET', '/infra/providers/bitrix-cloud/images')

const plan = plans.find(p => p.id === 'bc-small')
const region = regions.find(r => r.id === 'ru-central1-b')
const image = images[0]

// 2. Создать сервер (всегда в Black Hole)
const { data: server } = await api('POST', '/infra/servers', {
  provider: 'bitrix-cloud',
  name: 'my-crm-bot',
  plan: plan.id,
  region: region.id,
  image: image.id,
})
console.log(`Сервер создан: ${server.id}, субдомен: ${server.subdomain}`)

// 3. Отдельная виртуальная машина: ждать running и CONNECTED.
//    Galaxy-приложение (kind === 'GALAXY_APP') этого состояния не достигает —
//    для него шаг пропускается, код загружается сразу.
let info = server
if (server.kind === 'STANDALONE') {
  while (info.status !== 'running' || info.blackholeStatus !== 'CONNECTED') {
    await new Promise(r => setTimeout(r, 10000)) // 10 секунд между опросами
    const res = await api('GET', `/infra/servers/${server.id}`)
    info = res.data
    console.log(`status=${info.status}, blackhole=${info.blackholeStatus}`)
  }
}

// 4. Задеплоить приложение (JSON — режим по умолчанию).
//    Источник кода ниже — внешний адрес, это вариант для отдельной
//    виртуальной машины. Для galaxy-приложения (kind === 'GALAXY_APP')
//    источник только встроенный: source: { content: '<base64>' }.
//    Заголовок X-Skip-Source-Snapshot нужен при деплое с внешнего URL,
//    когда включено хранилище исходников — иначе 409 SNAPSHOT_REQUIRED.
const deploy = await api('POST', `/infra/servers/${server.id}/deploy`, {
  source: { url: 'https://github.com/user/app/archive/main.tar.gz' },
  runtime: 'node24',
  install: 'cd /opt/app && npm install --production',
  preStart: 'cd /opt/app && npx prisma migrate deploy',
  start: 'cd /opt/app && node server.js',
  port: 3000,
  env: { NODE_ENV: 'production' },
}, { 'X-Skip-Source-Snapshot': 'deploy from external URL' })

console.log(`Приложение живёт: ${deploy.data.appUrl}`)

// 5. Изменить таймаут простоя, если 60 минут по умолчанию не подходят.
//    Допустимые значения — 15, 30, 60, 240 и null, который отключает
//    авто-сон. Приложению с постоянным опросом нужен именно null:
//    исходящие запросы таймер простоя не сбрасывают.
await api('PATCH', `/infra/servers/${server.id}/sleep`, { sleepAfterMinutes: 240 })
```

## Справочник эндпоинтов

Справочник эндпоинтов раздела. Ссылки ведут на страницы с параметрами, примерами и кодами ошибок.

**Провайдеры и каталоги:**

| Метод | Путь | Описание |
|-------|------|----------|
| GET | [`/v1/infra/providers`](/docs/infra/providers/list) | Список облачных провайдеров |
| GET | [`/v1/infra/providers/:providerId/plans`](/docs/infra/providers/plans) | Тарифы провайдера |
| GET | [`/v1/infra/providers/:providerId/regions`](/docs/infra/providers/regions) | Регионы провайдера |
| GET | [`/v1/infra/providers/:providerId/images`](/docs/infra/providers/images) | Образы ОС |

**Серверы:**

| Метод | Путь | Описание |
|-------|------|----------|
| POST | [`/v1/infra/servers`](/docs/infra/servers/create) | Создать сервер (всегда Black Hole) |
| GET | [`/v1/infra/servers`](/docs/infra/servers/list) | Список ваших серверов |
| GET | [`/v1/infra/servers/:id`](/docs/infra/servers/get) | Детали сервера |
| GET | [`/v1/infra/servers/:id/activity`](/docs/infra/servers/activity) | Лента событий сервера |
| PATCH | [`/v1/infra/servers/:id`](/docs/infra/servers/update) | Обновить имя и описание |
| DELETE | [`/v1/infra/servers/:id`](/docs/infra/servers/delete) | Удалить сервер |

**Жизненный цикл:**

| Метод | Путь | Описание |
|-------|------|----------|
| POST | [`/v1/infra/servers/:id/start`](/docs/infra/lifecycle/start) | Запустить остановленный/спящий сервер |
| POST | [`/v1/infra/servers/:id/stop`](/docs/infra/lifecycle/stop) | Остановить работающий сервер |
| POST | [`/v1/infra/servers/:id/reboot`](/docs/infra/lifecycle/reboot) | Перезагрузить сервер |
| POST | [`/v1/infra/servers/:id/wake`](/docs/infra/lifecycle/wake) | Разбудить спящий сервер (асинхронно или блокирующе) |
| POST | [`/v1/infra/servers/:id/sleep-now`](/docs/infra/lifecycle/sleep-now) | Немедленно усыпить BLACKHOLE-сервер |
| PATCH | [`/v1/infra/servers/:id/sleep`](/docs/infra/lifecycle/sleep) | Настроить авто-засыпание |
| PATCH | [`/v1/infra/servers/:id/run-mode`](/docs/infra/lifecycle/run-mode) | Сменить режим работы: по простою, по расписанию или круглосуточно |
| POST | [`/v1/infra/servers/:id/refresh`](/docs/infra/lifecycle/refresh) | Запросить статус и IP у провайдера |
| POST | [`/v1/infra/servers/:id/repair`](/docs/infra/lifecycle/repair) | Восстановить туннель через serial console |
| GET | [`/v1/infra/servers/:id/repair-status`](/docs/infra/lifecycle/repair-status) | Прогресс восстановления туннеля |

**Пробуждение по расписанию:**

| Метод | Путь | Описание |
|-------|------|----------|
| GET | [`/v1/infra/servers/:id/wake-schedules`](/docs/infra/wake-schedules/list) | Список окон пробуждения и историю запусков |
| POST | [`/v1/infra/servers/:id/wake-schedules`](/docs/infra/wake-schedules/create) | Создать окно пробуждения |
| PATCH | [`/v1/infra/servers/:id/wake-schedules/:scheduleId`](/docs/infra/wake-schedules/update) | Обновить окно пробуждения |
| DELETE | [`/v1/infra/servers/:id/wake-schedules/:scheduleId`](/docs/infra/wake-schedules/delete) | Удалить окно пробуждения |

**Свой домен:**

| Метод | Путь | Описание |
|-------|------|----------|
| POST | [`/v1/infra/servers/:id/domain`](/docs/infra/domain/attach) | Привязать свой домен |
| GET | [`/v1/infra/servers/:id/domain`](/docs/infra/domain/get) | Получить домен и DNS-записи |
| POST | [`/v1/infra/servers/:id/domain/verify`](/docs/infra/domain/verify) | Проверить DNS-записи и включить домен |
| DELETE | [`/v1/infra/servers/:id/domain`](/docs/infra/domain/detach) | Отвязать домен |

**Библиотека расписаний работы:**

| Метод | Путь | Описание |
|-------|------|----------|
| GET | [`/v1/work-schedules`](/docs/infra/work-schedules/list) | Список расписаний портала |
| GET | [`/v1/work-schedules/:id`](/docs/infra/work-schedules/get) | Получить расписание |
| POST | [`/v1/work-schedules`](/docs/infra/work-schedules/create) | Создать своё расписание |
| PATCH | [`/v1/work-schedules/:id`](/docs/infra/work-schedules/update) | Обновить расписание |
| DELETE | [`/v1/work-schedules/:id`](/docs/infra/work-schedules/delete) | Удалить расписание |
| PUT | [`/v1/work-schedules/:id/default`](/docs/infra/work-schedules/set-default) | Отметить расписание, на котором рождаются новые машины |

**Доступ и режимы:**

| Метод | Путь | Описание |
|-------|------|----------|
| GET | [`/v1/infra/servers/:id/ssh`](/docs/infra/access/ssh) | SSH-данные (только для OPEN) |
| PATCH | [`/v1/infra/servers/:id/mode`](/docs/infra/access/mode) | Вернуть сервер в BLACKHOLE. OPEN включается в кабинете |
| PATCH | [`/v1/infra/servers/:id/access-policy`](/docs/infra/access/access-policy) | Политика доступа к приложению |
| GET | [`/v1/infra/servers/:id/access`](/docs/infra/access/access-list) | Список пользователей и отделов доступа |
| POST | [`/v1/infra/servers/:id/access`](/docs/infra/access/access-add) | Добавить пользователя или отдел |
| DELETE | [`/v1/infra/servers/:id/access/:accessId`](/docs/infra/access/access-delete) | Удалить запись доступа |
| GET | [`/v1/infra/servers/:id/b24-users`](/docs/infra/access/b24-users) | Поиск пользователей портала Битрикс24 |

**Deploy API:**

| Метод | Путь | Описание |
|-------|------|----------|
| POST | [`/v1/infra/servers/:id/exec`](/docs/infra/deploy/exec) | Выполнить команду (SSE или JSON) |
| POST | [`/v1/infra/servers/:id/upload`](/docs/infra/deploy/upload) | Загрузить файл (base64 или по URL) |
| GET | [`/v1/infra/servers/:id/logs`](/docs/infra/deploy/logs) | Логи сервиса (утилита `journalctl`) |
| POST | [`/v1/infra/servers/:id/deploy`](/docs/infra/deploy/deploy) | Полный деплой приложения |
| GET | [`/v1/infra/operations/:operationId`](/docs/infra/deploy/operation-status) | Исход выкладки или команды по идентификатору операции |
| GET | [`/v1/infra/servers/:id/operations`](/docs/infra/deploy/operations) | Последние операции выкладки и команд текущего ключа |
| GET | [`/v1/infra/servers/:id/operations/:operationId`](/docs/infra/deploy/server-operation) | Исход операции из ленты сервера по паре «сервер, идентификатор» |
| PATCH | [`/v1/infra/servers/:id/port`](/docs/infra/deploy/port) | Задать порт приложения |
| GET | [`/v1/infra/servers/:id/metrics`](/docs/infra/deploy/metrics) | Метрики активности туннеля |
| DELETE | [`/v1/infra/servers/:id/lock`](/docs/infra/deploy/lock) | Снять зависший лок операции |
| GET | [`/v1/infra/runtimes`](/docs/infra/deploy/runtimes) | Список доступных рантаймов |

**Токены доступа:**

| Метод | Путь | Описание |
|-------|------|----------|
| POST | [`/v1/infra/servers/:id/access-tokens`](/docs/infra/access-tokens/create) | Выпустить токен доступа (`api-bearer` или `share-url`) |
| POST | [`/v1/infra/servers/:id/access-tokens/:tokenId/refresh`](/docs/infra/access-tokens/refresh) | Выпустить свежий JWT для того же токена `api-bearer` |
| GET | [`/v1/infra/servers/:id/access-tokens`](/docs/infra/access-tokens/list) | Список токенов сервера |
| DELETE | [`/v1/infra/servers/:id/access-tokens/:tokenId`](/docs/infra/access-tokens/delete) | Отозвать токен |

**Подписки на события портала:**

| Метод | Путь | Описание |
|-------|------|----------|
| POST | [`/v1/infra/servers/:id/event-subscriptions`](/docs/infra/event-subscriptions) | Подписать сервер на событие портала (`event.bind` под OAuth-приложением) |
| GET | [`/v1/infra/servers/:id/event-subscriptions`](/docs/infra/event-subscriptions) | Список подписок + недавние доставки |
| DELETE | [`/v1/infra/servers/:id/event-subscriptions/:subId`](/docs/infra/event-subscriptions) | Снять подписку |

## Авторизация эндпоинтов

Все инфра-эндпоинты требуют заголовок `X-Api-Key`. Для ключей `vibe_app_` (привязка к OAuth-приложению) часть POST-операций дополнительно требует `Authorization: Bearer <session>` — без него ответ `401 UNAUTHENTICATED` с `error.hint`. Для ключей `vibe_api_` пользовательский контекст уже есть в самом ключе, отдельная сессия не нужна.

| Эндпоинт | `X-Api-Key` | `Authorization: Bearer` для `vibe_app_` | Когда требует Bearer |
|----------|:-----------:|:--------------------------------------:|----------------------|
| `GET /v1/infra/providers/*` | да | нет | — |
| `GET /v1/infra/servers`, `GET /v1/infra/servers/:id` | да | нет | — |
| `GET /v1/infra/servers/:id/logs`, `/metrics`, `/access`, `/b24-users`, `/ssh` | да | нет | — |
| `GET /v1/infra/runtimes` | да | нет | — |
| `GET /v1/infra/servers/:id/activity`, `GET /v1/infra/servers/:id/operations/:operationId` | да | нет | — |
| `POST /v1/infra/servers` (создать сервер) | да | **да** | Тарифная проверка: платформе нужно знать, кто именно создаёт сервер. |
| `POST /v1/infra/servers/:id/deploy`, `/exec`, `/upload` | да | нет | Достаточно скоупа `vibe:infra` на ключе. |
| `POST /v1/infra/servers/:id/start`, `/stop`, `/reboot`, `/wake`, `/sleep-now`, `/refresh`, `/repair`, `PATCH /sleep` | да | нет | — |
| `PATCH /v1/infra/servers/:id/run-mode`, `POST/PATCH/DELETE /v1/work-schedules` | да | нет | Пока режимы работы не включены для портала, ответ `400 RUN_MODE_UNAVAILABLE`. |
| `GET /v1/work-schedules`, `GET /v1/work-schedules/:id` | да | нет | Чтение доступно и до включения режимов. Ключу Cowork/Code библиотека закрыта целиком, включая чтение. |
| `PUT /v1/work-schedules/:id/default` | да | нет | Только ключ, владелец которого — администратор портала: ключ `vibe_app_` получает `403 ADMIN_ONLY` и с сессией. Пока режимы работы не включены для портала, ответ `400 RUN_MODE_UNAVAILABLE`. |
| `GET /v1/infra/servers/:id/wake-schedules` | да | нет | — |
| `POST /v1/infra/servers/:id/wake-schedules`, `PATCH .../wake-schedules/:scheduleId` | да | нет | Требует включённого пробуждения по расписанию на портале, иначе `403 WAKE_SCHEDULE_DISABLED`. Если на портале возможность включена, а сервер — приложение в галактике, приходит `403 WAKE_SCHEDULE_GALAXY_DISABLED`: для таких приложений её включают отдельно от обычных серверов. |
| `DELETE /v1/infra/servers/:id/wake-schedules/:scheduleId` | да | нет | Удаление окна этими условиями не ограничено — окно можно снять и после того, как пробуждение по расписанию отключили на портале или для приложений галактики. |
| `PATCH /v1/infra/servers/:id/mode`, `/access-policy`, `/port` | да | нет | — |
| `POST /v1/infra/servers/:id/access`, `DELETE /v1/infra/servers/:id/access/:accessId` | да | нет | — |
| `POST/GET /v1/infra/servers/:id/access-tokens`, `DELETE .../:tokenId`, `POST .../:tokenId/refresh` | да | нет | Раздел токенов доступа должен быть включён на платформе, иначе все четыре эндпоинта отвечают `503 FEATURE_DISABLED`. Проверка до вызова — `data.capabilities.servers.preview` в [`GET /v1/me`](/docs/keys-auth/me). |
| `POST/GET/DELETE /v1/infra/servers/:id/event-subscriptions` | да | нет | Сервер должен быть привязан к OAuth-приложению с `application_token`, иначе `400 NOT_OAUTH_APP`. |
| `PATCH /v1/infra/servers/:id` (имя и описание) | да | нет | — |
| `DELETE /v1/infra/servers/:id` | да | нет | — |
| `DELETE /v1/infra/servers/:id/lock` | да | нет | — |

Быстрая проверка до вызова: `GET /v1/me` → `data.capabilities.servers.create.available`. Для `vibe_app_` без сессии возвращается `false` с `reason: "SESSION_REQUIRED"` и подсказкой в `userMessage` — модель сразу видит, что нужно пройти OAuth-авторизацию, а не ловить `401` на самом `POST /v1/infra/servers`.

## Лимиты

| Лимит | Значение |
|-------|----------|
| Серверов на API-ключ | 100. В счёт идут только отдельные виртуальные машины, созданные этим ключом — приложения в галактике и сами машины-галактики в лимит не входят. Своё текущее значение и израсходованную часть смотрите в `GET /v1/me`: `data.infra.limits.max` и `data.infra.limits.used` |
| Операций Deploy API в минуту на пару «API-ключ и сервер» | 10 |
| Одновременных `exec`/`deploy` на сервер | 1 |
| Таймаут `exec` | 1–600 секунд (по умолчанию 300) |
| Размер тела со встроенным base64 (`upload content`, `deploy source.content`, `source` при создании сервера) | 96 МБ тела, около 72 МБ архива. Сверх потолка — `413 INLINE_SOURCE_TOO_LARGE` |
| Размер файла через `source.url` / `upload url` | 500 МБ |
| Размер архива сохранённой версии (`source.versionId`) | 500 МБ |
| Размер multipart-архива в `deploy` | 500 МБ, пока архив уходит в хранилище потоком. Иначе около 72 МБ — [условия](/docs/infra/deploy/deploy) |
| Частота запросов `/ssh` | до 10 в минуту |

Числа частоты в таблице — суммарный лимит платформы. Действующее для вашего ключа значение приходит в заголовке `x-ratelimit-limit`. Ограничение частоты запросов платформы — общее для всех V1-эндпоинтов, [см. раздел «Лимиты и оптимизация»](/docs/optimization).

## Статусы сервера

| Статус | Описание |
|--------|----------|
| `provisioning` | Виртуальная машина создаётся у провайдера (1–3 минуты) |
| `running` | Виртуальная машина запущена, IP назначен. Для туннеля нужен ещё `blackholeStatus: CONNECTED` |
| `sleeping` | Остановлен по таймеру сна или вручную. Просыпается при вызове `/deploy`/`/start`/`/wake`, а обращение к HTTPS-субдомену будит его на [условиях автоматического пробуждения](/docs/infra/lifecycle/wake) |
| `error` | Сервер не в рабочем состоянии: виртуальная машина удалена у провайдера, агент долго не подключается, внешний `externalId` отсутствует |
| `deleted` | Сервер удалён (пометка на удаление). Нельзя восстановить |

Поле `blackholeStatus` описывает состояние туннеля агента независимо от `status`:

| Значение | Описание |
|----------|----------|
| `NONE` | Агент ещё не подключался. У машины, созданной с нуля, — до первого подключения. В первом ответе создания `NONE`, при повторе с тем же `Idempotency-Key` приходит текущее значение. Заранее подготовленная машина может стать `CONNECTED` уже к первому `GET` |
| `CONNECTED` | Туннель активен, Deploy API доступен |
| `DISCONNECTED` | Агент был подключён, сейчас нет связи — попробуйте [`/repair`](/docs/infra/lifecycle/repair) |

Поле `kind` различает модель размещения: `STANDALONE` — отдельная виртуальная машина, `GALAXY_APP` — galaxy-приложение (контейнер в галактике), `GALAXY` — сама галактика (хост-носитель — её создаёт платформа, не пользователь). У galaxy-приложения `blackholeStatus` остаётся `NONE` до загрузки кода — оно не подключается само. Подробнее — [Galaxy-приложение](/docs/infra/galaxy).

Поле `runtimeStatus` — устаревшее, оставлено для совместимости. Для серверов, созданных после 2026-04-25 (когда параметр `runtime` был убран из [`POST /v1/infra/servers`](/docs/infra/servers/create)), всегда возвращается `null`. Рантайм теперь ставится на этапе [`POST /:id/deploy`](/docs/infra/deploy/deploy), а сигналом готовности служит сам успех шага `runtime` в ответе деплоя.

## Тариф и доступ

У инфраструктуры Вайбкод два уровня условий по доступу.

**Уровень 1 — REST API Битрикс24.** Сам Битрикс24 открывает REST API только на коммерческих тарифах портала. Это не про Вайбкод: на бесплатных тарифах Битрикс24 попросту не отдаёт REST-ответы. Значит, без коммерческого тарифа Битрикс24 не работают:

- Создание и публикация приложений — приложение регистрируется на портале через REST.
- REST-прокси: `/v1/deals`, `/v1/contacts`, `/v1/batch`, `/v1/bots`, `/v1/tasks` и все остальные сущности.
- Боты, чаты, задачи — всё, что проксирует в Битрикс24.

**Уровень 2 — Вайбкод-инфраструктура.** Сверх первого условия, создание серверов и деплой требуют активной подписки Маркетплейса на портале ЛИБО платного или демо-тарифа Битрикс24. Что из этого — разбирает абзац сразу под списком. Операции этого уровня:

- `POST /v1/infra/servers` — создание сервера.
- `POST /v1/infra/servers/:id/deploy` — деплой приложения.
- Создание агентов и управляемых ботов (они провижинят серверы под капотом).

**Чем открывается доступ, зависит от региона портала.** В России — активной подпиской BitrixGPT + Маркетплейс на портале. В Казахстане и Узбекистане — платным или демо-тарифом Битрикс24. В Беларуси доступ открывает любой из трёх путей: платный тариф Битрикс24, демо-тариф Битрикс24 или платная подписка Битрикс24 Маркет Плюс.

**Пробуждение отдельной виртуальной машины доступ при вызове не проверяет.** Когда доступ заканчивается, платформа сама усыпляет серверы портала и запрещает их пробуждение — тогда [`POST /v1/infra/servers/:id/wake`](/docs/infra/lifecycle/wake) отвечает `403 SERVER_WAKE_BLOCKED`. У galaxy-приложения пробуждение проходит через хост-галактику, и пока доступ закрыт, отказ приходит со статусом `402` и кодом проверки доступа: `MARKETPLACE_REQUIRED`, `BY_PAID_ONLY`, `KZ_PAID_ONLY` или `UZ_PAID_ONLY`.

**Что работает на любом тарифе Битрикс24, включая бесплатный:**

- AI Router — `POST /v1/chat/completions`, `POST /v1/audio/transcriptions`, `GET /v1/models`. Не проксирует в Битрикс24, напрямую ходит к провайдерам LLM. С BYOK-ключами — бесплатно, с платформенными моделями — тарифицируется с баланса Вайбкод.
- Базовые эндпоинты платформы: `GET /v1/me`, `GET /v1/feedback`, `GET /v1/guide` — для самоориентации AI-агента.

**Проверка до вызова:** `GET /v1/me` → поле `capabilities.servers.create.available`. Если `false` — поле `capabilities.servers.create.userMessage` содержит переведённое объяснение для пользователя.

**Принудительное обновление после повышения тарифа:** `GET /v1/me?refresh=tariff` — пропускает кэш, по умолчанию часовой, и запрашивает тариф у Битрикс24 заново.

**Доступ к серверам:** единственный признак — `capabilities.servers.create` в ответе `GET /v1/me` (см. выше). Если доступ закрыт, `POST /v1/infra/servers` вернёт `402` с кодом проверки доступа (см. «Коды ошибок» ниже). Если состояние подписки прочитать не удалось, приходит `403 PORTAL_SUBSCRIPTION_UNREADABLE` (см. «Коды ошибок» ниже). Чем управляется доступ, зависит от региона портала — разбор в «Тариф и доступ» выше.

**Заголовки ответа** инфра-эндпоинтов:

| Заголовок | Значение |
|-----------|----------|
| `X-Tariff-Checked-At` | ISO-timestamp последней УДАЧНОЙ сверки тарифа с Битрикс24, кэш до 1 часа. Неудачная попытка заголовок не выставляет: его отсутствие значит «достоверной сверки нет» |
| `X-Tariff-Is-Commercial` | `"true"` или `"false"` |

Коды ошибок проверки доступа перечислены в разделе «Коды ошибок» ниже.

## Windows / PowerShell и UTF-8

Кириллица в `displayName` и `description` сервера может превратиться в знаки вопроса (`?`), если запрос отправляется из Windows PowerShell без явной сериализации в UTF-8. Это не проблема отображения на стороне платформы — кириллические байты теряются ещё до отправки HTTP-запроса, на стороне клиента.

**Причина.** По умолчанию PowerShell перекодирует строку из параметра `-Body` у `Invoke-WebRequest` и `Invoke-RestMethod` в системную кодировку `windows-1251`, и кириллица теряется ещё до сборки запроса. Заголовок `Content-Type: charset=utf-8` здесь не помогает — к моменту его применения исходные байты уже потеряны.

**Решение.** Передавайте тело запроса массивом байтов UTF-8.

```powershell
# 1. Кодировка вывода консоли — на кодирование тела запроса не влияет
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 2. Собрать JSON и преобразовать его в массив UTF-8 байтов
$body = @{
  displayName = 'Уведомления клиентов'
  description = 'Бот отправляет уведомления по сделкам'
} | ConvertTo-Json -Compress

$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

# 3. Передать в -Body массив байтов, а не строку, и указать кодировку в Content-Type
Invoke-WebRequest `
  -Uri 'https://vibecode.bitrix24.tech/v1/infra/servers/SERVER_ID' `
  -Method PATCH `
  -Headers @{
    'X-Api-Key'    = 'YOUR_API_KEY'
    'Content-Type' = 'application/json; charset=utf-8'
  } `
  -Body $bytes
```

**Распространённые ошибки:**

- Сохранять `.ps1` с UTF-8 BOM — старые версии PowerShell могут не разобрать сам скрипт.
- Передавать в `-Body` строку `$body` вместо массива байтов `$bytes` — строка повторно перекодируется через системную кодировку.
- Полагаться только на `Content-Type: application/json; charset=utf-8` без `UTF8.GetBytes` — этот заголовок не восстанавливает потерянные байты, а лишь объявляет серверу заявленную кодировку тела.

Та же сериализация нужна везде, где вы передаёте отображаемое имя и описание: [создание сервера](/docs/infra/servers/create), [правка имени и описания](/docs/infra/servers/update) и [деплой приложения](/docs/infra/deploy/deploy) — оттуда эти значения попадают в карточку приложения в каталоге Битрикс24.

**Node.js (`fetch`) и Python (`requests`)** кодируют тело в UTF-8 сами, дополнительных шагов не требуется. Проблема специфична для PowerShell.

## Коды ошибок

### Ошибки инфраструктуры

| Код | HTTP | Описание |
|-----|------|----------|
| `NOT_FOUND` | 404 | Сервер не найден или привязан к другому API-ключу, и вы не состоите в его команде разработки |
| `SERVER_ROLE_FORBIDDEN` | 403 | Вы состоите в команде разработки сервера, но операция шире вашей роли. В `error.hint` приходят `yourRole`, `requiredRole`, отказанное действие и список открытых вам вызовов `allowedHere`. Разбор ролей — [Список серверов](/docs/infra/servers/list) |
| `INVALID_REQUEST` | 400 | Ошибка валидации (неверное имя, тариф, регион, образ) |
| `INFRA_NOT_PERMITTED` | 403 | Инфраструктура отключена на платформе или на портале |
| `SERVER_CREATION_DISABLED` | 403 | Создание серверов запрещено политикой портала |
| `MAX_SERVERS_REACHED` | 403 | Превышен лимит серверов на API-ключ |
| `NO_CREDENTIALS` | 404 | Провайдер не сконфигурирован на платформе |
| `SERVER_NOT_READY` | 409 | Сервер ещё создаётся, операция пока недоступна |
| `CONFLICT` | 409 | Сервер в статусе, из которого нельзя выполнить действие (например `start` работающего) |
| `PROVIDER_ERROR` | 502 | Облачный провайдер вернул ошибку |
| `VM_MISSING` | 422 | У записи нет `externalId`, и разбор облака не видит машину под облачным именем этого сервера — виртуальная машина не создана у провайдера или удалена извне. Сервер нужно заменить: удалить и создать новый. Адрес каждого шага `error.hint` называет, только если шаг доступен этому запросу, а для недоступного — причину отказа и что изменить |
| `VM_POINTER_LOST` | 422 | У записи нет `externalId`, но разбор облака видит машину под облачным именем этого сервера: связь потеряна, сама машина скорее всего работает и тарифицируется. Удалять сервер и создавать новый НЕ нужно — тогда машина останется работать вообще без записи. Сервер в `error` не переводится, обратитесь в поддержку за восстановлением связи |
| `PORT_RESTRICTED` | 400 | Порт 1–1023 (системные порты запрещены). Допустимы `0` (автоопределение) и `1024–65535` |
| `BLACKHOLE_ONLY` | 400 | Эндпоинт работает только для BLACKHOLE-серверов (актуально для `/sleep-now`, `/sleep`, `/metrics`) |
| `OPEN_MODE_DISABLED` | 403 | Запрос на переход в OPEN, пока режим выключен на уровне платформы |
| `DIRECT_NETWORK_CHANGE_REQUIRES_HUMAN` | 403 | Запрос на переход в OPEN через API: переключение выполняет человек в кабинете |
| `SAME_MODE` | 400 | Сервер уже в запрошенном режиме |
| `REPAIR_BLOCKED` | 409 | Восстановление туннеля заблокировано: сервер спит или в ошибке, и на нём стоит запрет на пробуждение (`preventWake=true`) |

### Ошибки Deploy API

| Код | HTTP | Описание |
|-----|------|----------|
| `SERVER_NOT_READY` | 409 | Сервер не готов к операции: не запущен, туннель не подключён, либо сервер числится подключённым, но у Gateway нет живого туннеля. В ответе — поле `hint` с причиной и следующим шагом. Платформа пытается восстановить туннель сама. Если это не удалось — разбудите сервер или вызовите [`/repair`](/docs/infra/lifecycle/repair) и повторите запрос |
| `EXEC_BUSY` | 409 | На сервере уже выполняется другая операция. Повторяйте по `Retry-After`; не помогает — гардированный [`POST /v1/infra/servers/:id/unstick`](/docs/infra/servers/unstick), который на живой операции без `force` отвечает `409`. Безусловное [`/lock`](/docs/infra/deploy/lock) — последний шаг, и только после независимо подтверждённого простоя. В галактике этим снимается только платформенный лок: если занятость держится, занят общий exec-канал хоста — повторяйте по `Retry-After`, при устойчивом отказе обращайтесь в поддержку |
| `COMMAND_TOO_LONG` | 400 | Команда `/exec` длиннее 10 000 символов. Большие данные и скрипты передавайте через [`/upload`](/docs/infra/deploy/upload) |
| `EXEC_TIMEOUT` | 200 | Превышен таймаут выполнения. Отказ приходит в теле ответа |
| `EXEC_FAILED` | 200 | Ошибка выполнения команды на агенте. Отказ приходит в теле ответа |
| `EXEC_NO_EXIT` | 200 | Поток `/exec` завершился, не прислав статус выхода: исход команды на сервере неизвестен. Отказ приходит в теле ответа, накопленный вывод — в `data`. Только на отдельной виртуальной машине (`kind: "STANDALONE"`) |
| `UPLOAD_PATH_DENIED` | 403 | Запрещённый путь для загрузки |
| `DEPLOY_FAILED` | 200 | Упал один из шагов деплоя — какой именно, указывает поле `error.step`. Отказ приходит в теле ответа |
| `DEPLOY_TIMEOUT` | 200 | Шлюз перестал ждать шаг деплоя, но исход операции неизвестен. Сначала прочитайте список операций и выполните read-only проверки из `error.hint`. Не повторяйте deploy вслепую |
| `DEPLOY_CONNECTION_TERMINATED` | 200 | Соединение с сервером оборвалось посреди деплоя, поэтому исход операции неизвестен. Сначала прочитайте список операций и выполните read-only проверки из `error.hint`. Не повторяйте deploy вслепую |
| `DEPLOY_TUNNEL_STALE` | 200 | У Gateway пропал живой туннель во время deploy, поэтому исход операции неизвестен. Сначала прочитайте список операций и выполните read-only проверки из `error.hint`. Не вызывайте `/repair` и не повторяйте deploy вслепую |
| `VALIDATION_ERROR` | 400 | Некорректное тело запроса Deploy API |

У [`/exec`](/docs/infra/deploy/exec) и [`/deploy`](/docs/infra/deploy/deploy) на отдельной виртуальной машине (`kind: "STANDALONE"`) соединение удерживается на всё время работы, поэтому статус `200` уходит до её начала. Отказ во время выполнения приходит телом ответа — признаком служит `success: false`, а не HTTP-статус. Проверять надо `success`, иначе провалившаяся команда будет принята за успешную. У galaxy-приложения (`kind: "GALAXY_APP"`) та же ошибка приходит со статусом `502` — HTTP-статусы `200` в таблице выше относятся к отдельной виртуальной машине. Исключение — `EXEC_BUSY`: занятость общего exec-канала хоста приходит как `409` с заголовком `Retry-After`, потому что это отказ «занято, повторите», а не сбой.

В потоковом режиме (`?stream=true`) отказ приходит SSE-событием `error` с полями `code` и `message` — так отдаёт `/exec` и деплой при исключении или обрыве транспорта. У деплоя провал отдельного **шага** приходит иначе — событием `step` со `status: "error"` и именем шага. Поля `success` в потоке нет.

### Ошибки проверки доступа и биллинга

| Код | HTTP | Описание |
|-----|------|----------|
| `INFRA_SCOPE_REQUIRED` | 403 | У ключа нет скоупа `vibe:infra`. Приходит на создании сервера и на окнах пробуждения |
| `INFRA_FORBIDDEN_FOR_COWORK_KEY` | 403 | Вызов сделан ключом Cowork/Code — он только для данных и в управляющий контур не ходит. Приходит на ЛЮБОМ методе семейства, кроме чтений (`GET`). В `error.details.requiredAction` лежит готовый порядок действий, в `error.details.deployableKeys` — обычные ключи владельца с правом деплоя, до пяти самых свежих. Служебного проектного ключа в этом списке не бывает, поэтому пустой список не означает «выписывать нечем». Выписать подходящий ключ — [Проектный ключ для деплоя](./cowork/deploy-key.md) |
| `WRITE_BLOCKED_READONLY_KEY` | 403 | Ключ в режиме только для чтения. Приходит на ЛЮБОЙ записи этого семейства, которой нет в списке исключений, — создание сервера, управление жизненным циклом (остановка, запуск, удаление, перезагрузка, сон, пробуждение, расписания) и прочие не-GET. Важно: перечень исключений задаётся в коде. Полный состав приходит в ответе [GET /v1/me](/docs/keys-auth/me) полем `writeRestriction.exceptions` и напечатан с разбором по группам на странице [Режим доступа](/docs/keys-auth/access-mode) — сверяйтесь там, здесь состав не повторяется. Крупными мазками в него входят доставка на уже свой сервер, создание приложения в режиме `READONLY` (`POST /v1/apps`) и два аварийных выхода, записью не являющихся, — отзыв собственного ключа и снятие залипшего лока (`DELETE /v1/infra/servers/{id}/lock` — он снимает backend-лок БЕЗУСЛОВНО и потому является вторым шагом, допустимым лишь после независимо подтверждённого простоя сервера). Поле `recoveryAction` ответа `EXEC_BUSY` указывает не на снятие лока, а на `POST /v1/infra/servers/{id}/unstick`. У разрешённой доставки два следствия за пределами сервера: деплой на спящий сервер поднимает машину и начинает расходовать баланс, а также заводит и обновляет карточку приложения в каталоге портала, которую видят все сотрудники. Иконка меняет картинку той же карточки. Порядок смены режима — [Режим доступа](/docs/keys-auth/access-mode) |
| `MARKETPLACE_REQUIRED` | 402 | На портале нет активной подписки BitrixGPT + Маркетплейс — оформите её, чтобы открыть создание серверов и деплой. Приходит только там, где доступ к платформе открывает подписка. На пробуждении этот код получает только galaxy-приложение |
| `PORTAL_SUBSCRIPTION_UNREADABLE` | 403 | Состояние подписки аккаунта прочитать не удалось: ключу разработчика не хватает прав на чтение лицензии. Покупка такой отказ не снимает, поэтому поле `error.details.requiredTariffs` пустое. Приложение нужно переподключить под главным администратором аккаунта. Приходит на создании сервера |
| `PORTAL_TARIFF_UNREADABLE` | 403 | Тариф аккаунта прочитать не удалось, поэтому какого тарифа не хватает, ответ не называет: поле `error.details.requiredTariffs` пустое, а кнопка ведёт в поддержку. Покупка тарифа отказ не снимает. Приходит на создании сервера |
| `BY_PAID_ONLY` | 402 | Доступ открывает платный или демо-тариф Битрикс24. Открывает его и платная подписка Битрикс24 Маркет Плюс — в Беларуси она продаётся |
| `KZ_PAID_ONLY` | 402 | Регион портала открывает доступ по тарифу: платный или демо-тариф Битрикс24, подписка в регионе не продаётся |
| `UZ_PAID_ONLY` | 402 | То же для региона UZ: платный или демо-тариф Битрикс24, подписка в регионе не продаётся |
| `COMMERCIAL_PLAN_REQUIRED` | 402 | Платформа не нашла запись портала, к которому привязан ключ, поэтому не может проверить доступ. Приходит на создании сервера |
| `TRIAL_PORTAL_LIMIT` | 402 | Превышен лимит серверов на портал для демо-доступа по подписке Маркетплейса (1 сервер на портал) |
| `PLAN_NOT_ALLOWED_ON_TRIAL` | 402 | Запрошенный план недоступен на демо-доступе по подписке Маркетплейса. Разрешённые планы перечислены в `error.details.allowedPlans` — набор различается, поэтому не зашивайте его в код. Поле `error.details.requestedPlan`, когда оно есть, повторяет отклонённый план |
| `ACCOUNT_FROZEN` | 402 | Баланс Вайбкод заморожен. Нужно пополнить |
| `BILLING_EXHAUSTED` | 402 | Баланс Вайбкод исчерпан. Пробуждение и деплой заблокированы |
| `SERVER_WAKE_BLOCKED` | 403 | Пробуждение заблокировано (не из-за биллинга: окончание доступа к платформе, административная блокировка, нарушения безопасности) |

### Системные ошибки

| Код | HTTP | Описание |
|-----|------|----------|
| `MISSING_API_KEY` | 401 | Не передан заголовок `X-Api-Key` |
| `INVALID_API_KEY` | 401 | Ключ не опознан: такой строки на платформе нет |
| `RATE_LIMITED` | 429 | Превышено ограничение частоты запросов. Ответ несёт заголовок `Retry-After` |
| `INTERNAL_ERROR` | 500 | Внутренняя ошибка сервера |

Полный справочник общих ошибок — [Ошибки](/docs/errors).

## Иконка приложения

Иконка приложения (SVG) показывается в каталоге Битрикс24 и как фавикон во вкладке браузера. Формат, требования и порядок (фавикон-`<link>` до деплоя, загрузка `POST /v1/infra/servers/:id/icon` после) — на отдельной странице [Иконка приложения](/docs/infra/app-icon).

## Рецепты

- [Загрузка дампа БД на сервер](/docs/recipes/db-dump-restore) — залить дамп и восстановить базу в фоне через `exec`.
- [Быстрый цикл выпуска](/docs/infra/deploy/fast-cycle) — сократить цикл правок без полного прогона всех шагов.

## Смотрите также

- [Обзор API](/docs/entity-api)
- [Лимиты и оптимизация](/docs/optimization)
- [Ключи и авторизация (`/v1/me`)](/docs/keys-auth)
- [Что приходит в приложение](/docs/infra/app-runtime)
