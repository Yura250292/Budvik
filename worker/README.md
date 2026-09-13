# Воркер обміну з 1С

Приймає дані від агента на сервері 1С і пише їх у Postgres. Живе на Railway поруч із базою.

## Навіщо він є

Агент штовхає дані **кожні 5 хвилин** — це ~5 500 HTTP-запитів на добу, кожен із яких на Vercel був платним викликом функції, що читала й писала базу через публічний інтернет (Vercel рахував час очікування, Railway — вихідний трафік). Воркер стоїть у приватній мережі Railway разом із Postgres: ні викликів, ні егресу.

Логіка не дублюється — і воркер, і маршрути Next викликають одні й ті самі функції з [`src/lib/sync-ingest/handlers.ts`](../src/lib/sync-ingest/handlers.ts).

## Що робить, крім прийому даних

Усе, що треба робити **за розкладом** або дивлячись на **відсутність** дії. На Vercel такого не могло існувати в принципі: функція живе лише під час запиту, а тут перевіряти треба саме те, чого не сталося. Кожна робота — окремий `setInterval` у [`index.ts`](index.ts), крок звичайно чверть години, а вікно годин вирішує сама функція.

| Що | Де логіка | Коли |
|---|---|---|
| Агент замовк | [`sync-ingest/alerts.ts`](../src/lib/sync-ingest/alerts.ts) | тиша понад 2 год |
| Трек не пишеться | [`track/silence.ts`](../src/lib/track/silence.ts) | тиша понад 25 хв під час зміни |
| **Нагадування закрити зміну** | [`shift/close-reminder.ts`](../src/lib/shift/close-reminder.ts) | пуш торговому о 15:00 і 18:00, якщо машина стоїть годину або трек мовчить |
| Автозакриття забутих змін | [`shift/auto-close.ts`](../src/lib/shift/auto-close.ts) | з 20:00 за зупинкою в треку |
| «Не закрив зміну» офісу | [`shift/late-alert.ts`](../src/lib/shift/late-alert.ts) | з 20:00 у Telegram |
| Перерахунок пробігу змін | [`shift/recount.ts`](../src/lib/shift/recount.ts) | раз на годину |
| Рух у табло команди | [`leaderboard/standings.ts`](../src/lib/leaderboard/standings.ts) | о 19:00, раз на добу |
| «Вийшла нова збірка» | [`app/update-nudge.ts`](../src/lib/app/update-nudge.ts) | 08:00–19:00, раз на версію |
| Ранкове зведення керівникові | [`assistant/digest.ts`](../src/lib/assistant/digest.ts) | о 8:00, раз на добу |
| Нагадування з помічника | [`assistant/facts/reminders.ts`](../src/lib/assistant/facts/reminders.ts) | за часом кожного |
| **Стрічка торгового** | [`rep-feed/notify.ts`](../src/lib/rep-feed/notify.ts) | кожні 5 хв; пуші 08:00–19:00, до 12 на день; оплати, проведені й зібрані накладні, повернення |
| Прибирання журналів обміну | [`sync-ingest/retention.ts`](../src/lib/sync-ingest/retention.ts) | о 3:00, раз на добу |

Кожну з них можна прогнати окремо скриптом із `scripts/` у режимі `--dry` — саме заради цього логіка живе в `src/lib`, а не у воркері.

## Змінні середовища

| Змінна | Навіщо |
|---|---|
| `DATABASE_URL` | **обов'язково через `postgres.railway.internal`** — заради цього все й затівалось |
| `SYNC_AGENT_ID`, `SYNC_AGENT_SECRET` | ті самі значення, що в `config.json` агента і на Vercel |
| `SITE_REVALIDATE_URL` | `https://www.budvik27.com/api/sync-ingest/revalidate` — шлях саме такий, бо у фаєрволі Vercel від бот-челенджу звільнено лише префікс `/api/sync-ingest` |
| `TELEGRAM_SKLAD_BOT_TOKEN`, `SYNC_ALERT_CHAT_ID` | сповіщення; без них воркер працює мовчки |
| `DIGEST_CHAT_ID` | куди слати ранкове зведення керівникові. Окремо від `SYNC_ALERT_CHAT_ID`: це лист керівникові, а не в робочий канал. Без змінної зведення просто не йде |
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
