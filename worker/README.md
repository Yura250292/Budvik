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
| `SITE_REVALIDATE_URL` | `https://www.budvik27.com/api/revalidate` |
| `TELEGRAM_SKLAD_BOT_TOKEN`, `SYNC_ALERT_CHAT_ID` | сповіщення; без них воркер працює мовчки |
| `PORT` | Railway підставляє сам |

## Розгортання

Окремий сервіс у проєкті **Budvik** з цього ж репозиторію:

- **Build command:** `npm ci && npm run worker:prepare` — не залишати типовий, інакше Railway запустить `next build` і збиратиме весь сайт на кожен деплой воркера;
- **Start command:** `npm run worker`;
- **Healthcheck path:** `/healthz` — навмисно не торкається бази, щоб падіння Postgres не перезапускало справний контейнер по колу;
- **Watch paths:** `worker/**`, `src/lib/sync-ingest/**`, `src/lib/prisma.ts`, `package.json` — інакше сервіс передеплоюється на кожен коміт сайту;
- **Networking:** потрібен публічний домен — агент приходить ззовні, з мережі клієнта.

Після деплою вписати новий домен у `ingest.url` файлу `config.json` на сервері 1С (RDP).

## Локальний запуск

```bash
npx tsx --env-file=.env worker/index.ts
```

Перевірка живості: `curl localhost:3001/healthz`. Решта маршрутів вимагає підпису HMAC — його схема в [`src/lib/sync-ingest/auth.ts`](../src/lib/sync-ingest/auth.ts).

## Відкат

Повернути старий `ingest.url` (`https://www.budvik27.com`) у конфізі агента. Маршрути `/api/sync-ingest/*` на сайті лишаються робочими саме для цього.
