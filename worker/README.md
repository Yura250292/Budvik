# Воркер обміну з 1С

Приймає дані від агента на сервері 1С і пише їх у Postgres. Живе на Railway поруч із базою.

## Навіщо він є

Агент штовхає дані **кожні 5 хвилин** — це ~5 500 HTTP-запитів на добу, кожен із яких на Vercel був платним викликом функції, що читала й писала базу через публічний інтернет (Vercel рахував час очікування, Railway — вихідний трафік). Воркер стоїть у приватній мережі Railway разом із Postgres: ні викликів, ні егресу.

Логіка не дублюється — і воркер, і маршрути Next викликають одні й ті самі функції з [`src/lib/sync-ingest/handlers.ts`](../src/lib/sync-ingest/handlers.ts).

## Що робить, крім прийому даних

Стежить, чи не замовк агент (`alertAgentSilent` у Telegram). На Vercel такої перевірки не могло існувати: функція живе лише під час запиту, а тут перевіряти треба саме **відсутність** запитів.

## Змінні середовища

| Змінна | Навіщо |
|---|---|
| `DATABASE_URL` | **обов'язково через `postgres.railway.internal`** — заради цього все й затівалось |
| `SYNC_AGENT_ID`, `SYNC_AGENT_SECRET` | ті самі значення, що в `config.json` агента і на Vercel |
| `SITE_REVALIDATE_URL` | `https://www.budvik27.com/api/sync-ingest/revalidate` — шлях саме такий, бо у фаєрволі Vercel від бот-челенджу звільнено лише префікс `/api/sync-ingest` |
| `TELEGRAM_SKLAD_BOT_TOKEN`, `SYNC_ALERT_CHAT_ID` | сповіщення; без них воркер працює мовчки |
| `PORT` | Railway підставляє сам |

## Розгортання

Сервіс `budvik-sync-worker` у проєкті **Budvik**, домен `https://budvik-sync-worker-production.up.railway.app`. Публічний домен потрібен: агент приходить ззовні, з мережі клієнта.

Деплой — вивантаженням з робочої копії, як у `budvik-sklad-bot`:

```bash
railway up --service budvik-sync-worker --detach
```

Автодеплою з GitHub навмисно немає: інакше сервіс перезбирався б на кожен коміт сайту.

Параметри збірки задані в [`railway.json`](../railway.json) в корені, окремо в панелі нічого налаштовувати не треба. Головне там — `buildCommand`, що зводиться до `prisma generate`: якби лишився типовий, Railway побачив би скрипт `build` і збирав би на кожен деплой увесь Next. Що не вивантажується — у [`.railwayignore`](../.railwayignore).

Версія Node закріплена в [`.nvmrc`](../.nvmrc): без нього Nixpacks бере Node 18, який уже поза підтримкою. На Vercel цей файл не впливає — там версія береться з налаштувань проєкту.

`DATABASE_URL` заведено посиланням `${{Postgres.DATABASE_URL}}` — воно резолвиться у `postgres.railway.internal`, тобто в приватну мережу, заради якої все й затівалось.

Після деплою вписати домен воркера в `ingest.url` файлу `config.json` на сервері 1С (RDP).

## Локальний запуск

```bash
npx tsx --env-file=.env worker/index.ts
```

Перевірка живості: `curl localhost:3001/healthz`. Решта маршрутів вимагає підпису HMAC — його схема в [`src/lib/sync-ingest/auth.ts`](../src/lib/sync-ingest/auth.ts).

## Відкат

Повернути старий `ingest.url` (`https://www.budvik27.com`) у конфізі агента. Маршрути `/api/sync-ingest/*` на сайті лишаються робочими саме для цього.
