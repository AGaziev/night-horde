
# Токены доступа

Краткосрочные токены для внешнего доступа к развёрнутому приложению на BLACKHOLE-сервере. Два режима: `api-bearer` — JWT для HTTP-заголовка `Authorization`, `share-url` — ссылка для передачи получателю, аутентификация по куки.

## Операции

Скоуп: не требуется

- [Выпустить токен](./access-tokens/create.md) — `POST /v1/infra/servers/:id/access-tokens`
- [Обновить токен](./access-tokens/refresh.md) — `POST /v1/infra/servers/:id/access-tokens/:tokenId/refresh`
- [Список токенов](./access-tokens/list.md) — `GET /v1/infra/servers/:id/access-tokens`
- [Отозвать токен](./access-tokens/delete.md) — `DELETE /v1/infra/servers/:id/access-tokens/:tokenId`
- [Подписать ссылку на ресурс](./access-tokens/resource-url.md) — `POST /v1/infra/servers/:id/access-tokens/:tokenId/resource-url`

## Доступность

Раздел включается на стороне платформы, и на портале он может быть выключен. Признак до вызова — поле `available` блока `data.capabilities.servers.preview` в ответе [`GET /v1/me`](/docs/keys-auth/me):

| `available` | Что это означает |
|-------------|------------------|
| `true` | Все операции раздела включены; ограничения ключа проверяются отдельно |
| `false`, рядом приходит `reason: "FEATURE_DISABLED"` | Токены доступа этому ключу недоступны. Когда раздел выключен на платформе, каждая операция отвечает `503 FEATURE_DISABLED`; если выпуск прошёл предварительную проверку до отключения, свежая проверка внутри транзакции отвечает `403 FEATURE_DISABLED` |

Тот же признак приходит в блоке `data.infra.preview` — он есть в ответе и тогда, когда блока `data.capabilities` нет, потому что ключ не привязан к порталу. В блоке `data.deployment` у ключей Cowork поля `preview` нет вовсе, опираться на него как на единственный признак не стоит. Раздел включает администратор платформы, вызовом API это не делается.

Когда раздел выключен, ближайшая доступная проверка деплоя — шаги в массиве `data.steps[]` ответа [`POST /v1/infra/servers/:id/deploy`](/docs/infra/deploy/deploy), у каждого шага есть поле `status` со значениями `ok`, `warning` и `error`. Шаг `healthcheck` подтверждает, что приложение отвечает на своём порту. Шаг `tunnel_routing` подтверждает, что туннель Gateway ведёт на этот порт — у galaxy-приложения такого шага нет. Публичный маршрут с авторизацией на входе оба шага не проверяют, это остаётся свойством режима `api-bearer`.

## Сценарии

**E2E-проверка деплоя через публичный путь:**

Режим `api-bearer` позволяет убедиться, что запросы проходят через реальный маршрут `nginx → Gateway → туннель → приложение`. Вызов `exec + curl 127.0.0.1:3000` проверяет только localhost и не затрагивает Gateway-слой.

1. [`POST /access-tokens`](./access-tokens/create.md) с `mode: "api-bearer"`, `ttlSeconds: 600`.
2. Прогнать ключевые эндпоинты приложения с заголовком `Authorization: Bearer <token>`.
3. Если проверка идёт дольше 10 минут — [`POST /access-tokens/:tokenId/refresh`](./access-tokens/refresh.md) выдаёт свежий JWT для той же записи.
4. [`DELETE /access-tokens/:tokenId`](./access-tokens/delete.md) — отозвать после проверки.

Если Bearer возвращает 502, а `exec + curl 127.0.0.1:3000` проходит — проблема в Gateway или туннеле, а не в приложении.

`api-bearer` подтверждает, что запрос сделан владельцем ключа, но не создаёт сессию пользователя Битрикс24 — маршрут приложения, которому нужен проверенный администратор через `X-Vibe-Authorization` и `GET /v1/me`, под ним получит `currentUser: null`. Подробнее — [Выпустить токен](./access-tokens/create.md) и [Что приходит в приложение](/docs/infra/app-runtime).

**Ссылка для внешнего просмотра:**

1. [`POST /access-tokens`](./access-tokens/create.md) с `mode: "share-url"` и нужным `ttlSeconds`.
2. Передать поле `url` из ответа получателю — первый переход устанавливает куки, дальнейшие запросы работают без параметра `?s=`.
3. При необходимости: [`DELETE /access-tokens/:tokenId`](./access-tokens/delete.md) для досрочного отзыва.

## Смотрите также

- [Deploy API](/docs/infra/deploy)
- [Доступ и режимы](/docs/infra/access)
- [Инфраструктура](/docs/infra)
