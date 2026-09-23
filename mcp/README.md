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
| `PORT` | ставить Railway |

## Локально

```bash
MCP_STATE_SECRET=dev npm run mcp                        # :3002, .env — ЛИШЕ локальна база
npx tsx --env-file=.env scripts/check-mcp-http.mts http://localhost:3002
npx @modelcontextprotocol/inspector                      # вручну: http://localhost:3002/mcp
```

## Деплой

Окремий сервіс `budvik-mcp` у проєкті Railway «Budvik», поруч із
`budvik-sync-worker` (його деплой MCP не зачіпає).

1. У налаштуваннях сервісу: **Config file** → `/mcp/railway.json`.
2. З кореня репозиторію: `railway up --service budvik-mcp --detach`.
3. Міграцію Prisma на прод накочувати руками (`npm run db:migrate:prod`) тим
   самим рухом.
4. Перевірка: `MCP_CHECK_EMAIL=… MCP_CHECK_PASSWORD=… npx tsx scripts/check-mcp-http.mts https://mcp.budvik27.com`.

**Відкат:** зупинити сервіс у Railway — конектор перестає працювати, сайт і
обмін з 1С не зачеплено.
