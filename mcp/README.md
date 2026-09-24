# MCP-сервіс Budvik (`budvik-mcp`)

Віддалений MCP-сервер, через який керівник підключає дані Budvik у
**claude.ai** і **ChatGPT** як custom connector і розмовляє з ними на своїй
підписці: продажі, борги, склад, логістика, графіки й залежності.

Повний опис — [docs/mcp-connector.md](../docs/mcp-connector.md). Тут — лише
як це запускати.

## Що всередині

| Шлях | Що робить |
|---|---|
| `GET /healthz` | живий чи ні (healthcheck Railway) |
| `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server` | метадані OAuth (RFC 9728 / 8414) |
| `POST /register` | реєстрація клієнта (DCR) — лише з редиректом на claude.ai, claude.com, chatgpt.com, chat.openai.com або localhost |
| `GET /authorize` → `POST /login` | сторінка входу: email і пароль сайту, пускає лише ADMIN |
| `POST /token`, `POST /revoke` | токени (ротація refresh), відкликання |
| `POST /mcp` | MCP (Streamable HTTP без сесій) з `Authorization: Bearer` |

Логіка — у `src/lib/mcp/` (без імпортів з `next/*`), тут лише HTTP-обв'язка.

## Змінні оточення

| Змінна | Значення |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — OAuth-таблиці, журнал, готові зведення |
| `MCP_READONLY_DATABASE_URL` | та сама база, користувач `budvik_mcp_ro` (див. `scripts/mcp/readonly-role.sql`); **без неї в проді сервіс не стартує** |
| `MCP_ISSUER_URL` | `https://mcp.budvik27.com` |
| `MCP_STATE_SECRET` | випадковий рядок (підпис форми входу) |
| `OSRM_URL` | той самий, що на Vercel — власний OSRM для `build_route`; без нього маршрути йдуть у публічний демо-OSRM, який лімітує й падає |
| `PORT` | ставить Railway |

Сервіс **відмовляється стартувати** (код 1, причина в лозі), якщо адреса
публічна, а `MCP_READONLY_DATABASE_URL` немає, або якщо `NODE_ENV=production`
без `MCP_ISSUER_URL` — перевірка `scripts/check-mcp-startup.mts`.

## Локально

```bash
MCP_STATE_SECRET=dev npm run mcp                        # :3002, .env — ЛИШЕ локальна база
npx tsx --env-file=.env scripts/check-mcp-http.mts http://localhost:3002
npx @modelcontextprotocol/inspector                      # вручну: http://localhost:3002/mcp
```

## Деплой

Окремий сервіс `budvik-mcp` у проєкті Railway «Budvik», поруч із
`budvik-sync-worker` (його деплой MCP не зачіпає).

1. `railway login`, потім з кореня репозиторію: **`bash scripts/mcp/deploy.sh`**.
   **Не `railway up` з кореня:** Railway для нових сервісів ігнорує `railway.json`
   (Config as Code застарів, шлях до конфігу через API вже не ставиться) і
   збирає весь сайт (`npm run build`) — 23.09.2026 перший деплой так і впав.
   Скрипт вивантажує знімок HEAD, у якому `build` = `mcp:build`, `start` =
   `node dist/mcp.cjs`. `mcp/railway.json` лишився як довідка про команди.
2. Міграцію Prisma на прод накочувати руками тим самим рухом (для MCP вона
   одна — `20260923160000_mcp_oauth`, накочена 23.09.2026).
3. Перевірка: `MCP_CHECK_EMAIL=… MCP_CHECK_PASSWORD=… npx tsx scripts/check-mcp-http.mts https://mcp.budvik27.com`.

Домен: `mcp.budvik27.com` — CNAME на `mjut9dfp.up.railway.app` у Cloudflare,
**без проксі (сіра хмарка)**: з проксі Railway не видасть сертифікат, а захист
Cloudflare різав би Claude/ChatGPT. Службова адреса Railway:
`budvik-mcp-production.up.railway.app`.

**Відкат:** зупинити сервіс у Railway — конектор перестає працювати, сайт і
обмін з 1С не зачеплено.
