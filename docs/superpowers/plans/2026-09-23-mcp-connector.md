# MCP-конектор Budvik для Claude і ChatGPT — план упровадження

> Для виконавця: цей план виконується покроково через superpowers:executing-plans
> або superpowers:subagent-driven-development. Кроки позначені `- [ ]`. Після
> затвердження план копіюється в `docs/superpowers/plans/2026-09-23-mcp-connector.md`.
>
> **Рекомендований спосіб виконання — Native** (я сам, задача за задачею, наприкінці
> одне незалежне рев'ю всієї гілки). Задачі 1→5 ідуть ланцюгом через інтерфейси, а
> кроки 8–9 (Railway, DNS, вхід у claude.ai/ChatGPT) однаково робимо разом.
> Subagent-driven тут дав би переважно зайві контексти.

## Контекст

Керівник хоче розмовляти з агентом у **claude.ai (Pro/Max)** і **ChatGPT (Plus/Pro)**
на своїй підписці: питати про продажі, борги, склад, логістику й отримувати
діаграми, графіки та залежності, побудовані з наших даних. Для цього потрібен
**віддалений MCP-сервер**, який обидва клієнти підключають як custom connector.

У нас уже є майже все, що потрібно: `query_db` помічника керівника — це
читальний SQL над 29 віртуальними видами з трьома шарами захисту (див.
[query-db.ts](src/lib/assistant/facts/query-db.ts)). Є й 16 готових зведень
ADMIN-інструментів з цифрами, звіреними з кабінетом ([tools/](src/lib/assistant/tools/)).
Уся ця логіка вже працює поза Next: її імпортують воркер і скрипти `tsx`.

MCP-сервер стає тонкою обгорткою над цим кодом плюс невеликий OAuth-сервер,
бо обидва клієнти на особистих тарифах пускають лише через OAuth.

**Рішення, погоджені з власником (23.09.2026):**
- доступ **лише ADMIN**, область видимості — уся фірма (як у помічника керівника);
- клієнти: Claude Pro/Max і ChatGPT Plus/Pro у режимі розробника;
- адреса — **свій піддомен** `mcp.budvik27.com` (CNAME на Railway).

**Goal:** claude.ai і ChatGPT підключаються до `https://mcp.budvik27.com/mcp`, адмін
входить своїм логіном сайту, модель читає дані Budvik і будує графіки.

**Architecture:** окремий сервіс Railway `budvik-mcp` (Express + `@modelcontextprotocol/sdk`
1.29, Streamable HTTP без сесій). У тому ж процесі працює OAuth 2.1 authorization server
на інтерфейсі `OAuthServerProvider` з SDK зі сховищем у Prisma. Вхід — форма
з email і паролем сайту, пускає лише роль ADMIN. Інструменти перевикористовують
`runReadOnlyQuery`, `VIEWS` і `ToolDef.run` ADMIN-зведень. Довільний SQL іде через
**окрему читальну роль Postgres**, бо зараз застосунок ходить у базу як superuser.

**Tech Stack:** Node 22, TypeScript, esbuild, Express (через SDK), `@modelcontextprotocol/sdk@^1.29`,
`zod@^4`, Prisma 6 / PostgreSQL (Railway), bcryptjs.

## Глобальні обмеження

- **1С не чіпаємо взагалі.** Сервер читає лише PostgreSQL сайту, правило «1С — лише читання» не порушується.
- `src/lib/mcp/**` не імпортує нічого з `next/*`, `next-auth` чи `@/lib/auth` (умова, щоб бандлитись у Node-сервіс). `resolveIdentity` не годиться: він тягне next.
- Міграцію Prisma на прод накочувати **руками** (`npm run db:migrate:prod`) тим самим рухом, що й деплой.
- Сервіс `budvik-mcp` окремий від `budvik-sync-worker`: деплой MCP не має перезапускати прийом з 1С.
- Хост не на Vercel. Челендж Vercel ріже не-браузерні клієнти, а OAuth-дискавері від Anthropic/OpenAI саме такі.
- Усі MCP-інструменти мають `annotations.readOnlyHint = true`. Жодного інструмента з `write: true` (`remind_me`), жодного `export_file` у версії 1.
- Токени та коди в базі лише як SHA-256, так само як `DeviceToken` ([device-token.ts](src/lib/track/device-token.ts)).
- Коментарі й документація українською, у стилі репозиторію (пояснювати «чому»). Коміти українською.
- Паралельні сесії ділять git index, тож комітити лише явні шляхи й перевіряти `git show --stat`.

## На що дивитись при перевірці (Review Focus)

1. **Чужий redirect_uri при реєстрації клієнта.** Сторонній сайт реєструє клієнта з редиректом на себе й виманює код. Очікувано: `/register` відмовляє (`invalid_client_metadata`) усьому, що не з білого списку. Тест у Task 3.
2. **Адміна понизили або видалили, а токен ще живий.** Очікувано: наступний виклик `/mcp` отримує 401, бо роль перевіряється на кожному запиті, а не лише при видачі токена. Тест у Task 3.
3. **Refresh-токен використали вдруге** (крадіжка або подвійне оновлення). Очікувано: `invalid_grant`, і вся родина токенів цього підключення відкликана. Тест у Task 3.
4. **Модель пише важкий, битий або «пишучий» SQL.** Очікувано: відповідь-помилка з підказкою (`isError: true`, код SQLSTATE), а не 500. На читальній ролі запис неможливий навіть повз сканер. Тести в Task 1 і Task 6.
5. **ChatGPT шле `/token` як form-urlencoded, а `/register` як JSON.** Очікувано: обидва розбираються. Повний OAuth-танець у Task 5.

---

## Файли

**Нові**
- `src/lib/mcp/oauth/tokens.ts` — генерація й хеш токенів, строки життя.
- `src/lib/mcp/oauth/redirects.ts` — білий список redirect_uri.
- `src/lib/mcp/oauth/signed.ts` — HMAC-підпис параметрів `/authorize` між GET і POST форми.
- `src/lib/mcp/oauth/provider.ts` — `BudvikOAuthProvider implements OAuthServerProvider` (Prisma).
- `src/lib/mcp/oauth/login.ts` — HTML сторінки входу й згоди та обробник POST.
- `src/lib/mcp/readonly-db.ts` — другий `PrismaClient` на `MCP_READONLY_DATABASE_URL`.
- `src/lib/mcp/instructions.ts` — інструкції сервера (словник бізнесу, правила графіків).
- `src/lib/mcp/tools.ts` — `describe_data`, `query_db`, адаптер ADMIN-зведень.
- `src/lib/mcp/server.ts` — `createMcpServer(ctx)`: низькорівневий `Server` з `tools/list` і `tools/call`.
- `src/lib/mcp/audit.ts` — запис `McpCall`, очищення старших за 90 днів.
- `mcp/index.ts` — HTTP-сервіс (Express), `mcp/railway.json`, `mcp/README.md`.
- `scripts/mcp/readonly-role.sql` — створення читальної ролі (вручну, по нашому Postgres).
- `scripts/check-mcp-oauth.mts`, `scripts/check-mcp-tools.mts`, `scripts/check-mcp-http.mts`, `scripts/check-mcp-readonly.mts`.
- `src/app/api/admin/mcp-grants/route.ts` + картка в `src/app/admin/profile/page.tsx` («Підключені AI-застосунки»).
- `docs/mcp-connector.md`.

**Змінені**
- `src/lib/assistant/facts/query-db.ts` — необов'язковий клієнт бази в `QueryOptions`.
- `prisma/schema.prisma` + нова міграція — `McpClient`, `McpAuthCode`, `McpToken`, `McpCall`.
- `package.json` — залежності й скрипти `mcp`, `mcp:build`.

---

### Task 1: Залежності і клієнт бази в `runReadOnlyQuery`

**Files:** Modify `package.json`, `src/lib/assistant/facts/query-db.ts:238-251,350-383`; Test `scripts/assistant-query-db.mts`.

**Interfaces:** Produces `QueryOptions = { timeoutMs?: number; maxRows?: number; db?: PrismaClient }`. `runInReadOnlyTx(text, timeoutMs, db = prisma)`. Поведінка без `db` незмінна.

- [ ] `npm i @modelcontextprotocol/sdk@^1.29 zod@^4` і перевірити, що `npm ls zod` дає одну 4.x.
- [ ] У `runInReadOnlyTx` додати третій параметр `db: PrismaClient = prisma` і замінити `prisma.$transaction` на `db.$transaction`. `runReadOnlyQuery` передає `opts.db`.
- [ ] Дописати в `scripts/assistant-query-db.mts` перевірку, що виклик з явним `db: prisma` дає ті самі рядки, що й без нього (`SELECT count(*) FROM staff`).
- [ ] `npx tsx --env-file=.env scripts/assistant-query-db.mts` → усе `ok`; `npx tsc --noEmit -p .` чисто.
- [ ] Коміт: `Помічник: query_db приймає клієнт бази (під читальну роль MCP)`.

### Task 2: Моделі Prisma для OAuth і журналу викликів

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/<ts>_mcp_oauth/migration.sql`.

**Interfaces:** Produces моделі (імена полів використовують Task 3–7):

```prisma
model McpClient {            // зареєстрований через DCR клієнт (claude.ai, ChatGPT, Claude Code)
  id            String   @id              // client_id, видаємо самі
  secret        String?                   // client_secret для confidential; PKCE + вхід — основний захист
  name          String?
  redirectUris  String[]
  metadata      Json                      // повна відповідь RFC 7591, SDK віддає її назад
  createdAt     DateTime @default(now())
  lastUsedAt    DateTime?
  codes         McpAuthCode[]
  tokens        McpToken[]
}
model McpAuthCode {
  id            String   @id @default(cuid())
  codeHash      String   @unique
  clientId      String
  client        McpClient @relation(fields: [clientId], references: [id], onDelete: Cascade)
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  redirectUri   String
  codeChallenge String
  scopes        String[]
  resource      String?
  expiresAt     DateTime
  usedAt        DateTime?
  familyId      String                    // спільний з токенами, виданими за цим кодом
  createdAt     DateTime @default(now())
}
enum McpTokenKind { ACCESS REFRESH }
model McpToken {
  id          String   @id @default(cuid())
  kind        McpTokenKind
  tokenHash   String   @unique
  familyId    String                      // одне підключення = одна родина; відкликання — по родині
  clientId    String
  client      McpClient @relation(fields: [clientId], references: [id], onDelete: Cascade)
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  scopes      String[]
  resource    String?
  expiresAt   DateTime
  usedAt      DateTime?                   // для REFRESH: коли обміняли (повтор = крадіжка)
  revokedAt   DateTime?
  lastUsedAt  DateTime?
  createdAt   DateTime @default(now())
  @@index([familyId])
  @@index([userId, kind])
}
model McpCall {
  id        String   @id @default(cuid())
  userId    String
  clientId  String?
  tool      String
  args      Json                          // для query_db — сам SQL
  ok        Boolean
  rows      Int?
  ms        Int
  error     String?
  createdAt DateTime @default(now())
  @@index([createdAt])
  @@index([userId, createdAt])
}
```
Додати зворотні зв'язки на `User`: `mcpAuthCodes McpAuthCode[]`, `mcpTokens McpToken[]`.

- [ ] Дописати моделі, `npx prisma migrate dev --name mcp_oauth --create-only`, прочитати SQL (без `CONCURRENTLY`, бо індекси на нових порожніх таблицях).
- [ ] Перевірити міграцію локально за схемою з пам'яті `local-migration-check` (HEAD-схема + нова міграція + `migrate diff` порожній).
- [ ] `npx prisma generate`, `npx tsc --noEmit -p .`.
- [ ] Коміт: `MCP: таблиці OAuth-клієнтів, кодів, токенів і журналу викликів`. **На прод поки не накочуємо, це крок Task 8.**

### Task 3: OAuth-сервер (провайдер SDK поверх Prisma)

**Files:** Create `src/lib/mcp/oauth/{tokens,redirects,signed,provider,login}.ts`; Test `scripts/check-mcp-oauth.mts`.

**Interfaces:**
- Consumes: моделі з Task 2; `bcryptjs`; `rateLimit(key, limit, windowSec)` з [rate-limit.ts](src/lib/shop/rate-limit.ts); `EMAIL_RE` з `src/lib/auth/credentials.ts`.
- Produces:
  - `tokens.ts`: `newToken(prefix: "bmcp_at" | "bmcp_rt" | "bmcp_code"): string`, `hashToken(t: string): string`, `ACCESS_TTL_S = 3600`, `REFRESH_TTL_S = 30*86400`, `CODE_TTL_S = 300`.
  - `redirects.ts`: `isAllowedRedirect(uri: string): boolean`.
  - `signed.ts`: `signParams(p: AuthorizeParams, now?: Date): string`, `verifyParams(s: string, now?: Date): AuthorizeParams | null` (HMAC-SHA256 на `MCP_STATE_SECRET`, TTL 10 хв); `AuthorizeParams = { clientId; redirectUri; codeChallenge; state?; scopes: string[]; resource?: string }`.
  - `provider.ts`: `class BudvikOAuthProvider implements OAuthServerProvider` з `authorizationResponseIssParameterSupported = true`; `verifyAccessToken(token)` → `AuthInfo` з `extras: { userId }`; `export async function issueCode(p: AuthorizeParams, userId: string): Promise<string>`.
  - `login.ts`: `renderLogin(res, p: AuthorizeParams, clientName: string | null, error?: string)`, `handleLoginPost(req, res)`.

Правила, які код має виконувати:
- **Білий список редиректів:** https з хостом `claude.ai`, `claude.com` (шлях `/api/mcp/auth_callback`), `chatgpt.com`, `chat.openai.com` (будь-який шлях: ChatGPT генерує свій callback на підключення), а також loopback `http://localhost:*` і `http://127.0.0.1:*` (для Claude Code). Усе інше при `registerClient` → `InvalidClientMetadataError`.
- **`authorize()`** не видає код: рендерить форму входу з назвою клієнта, **хостом редиректу** (вимога специфікації MCP) і прихованим полем `req = signParams(...)`.
- **`handleLoginPost`:**
  1. `verifyParams(req)` → інакше 400.
  2. Повторно перевірити клієнта й redirectUri.
  3. `rateLimit("mcp-login:"+ip+":"+email, 5, 900)`.
  4. Email `trim().toLowerCase()`; `bcrypt.compare`; `role === "ADMIN"`. Помилку показувати однаковою: «Невірний email або пароль, або немає доступу».
  5. `issueCode()` → 302 на `redirectUri?code=…&state=…&iss=<issuer>`.
- **`exchangeAuthorizationCode`:** код за хешем, того ж клієнта, не прострочений, `usedAt` порожній, той самий `redirectUri`. Позначити використаним. Повторне пред'явлення коду → відкликати родину. Видати access і refresh з тим самим `familyId`.
- **`exchangeRefreshToken`:** refresh живий і не використаний → позначити `usedAt` і видати **нову пару** (ротація, вимога для публічних клієнтів). Уже використаний → відкликати всю родину і кинути `InvalidGrantError` (саме `invalid_grant`, бо на ньому Claude робить повторний вхід).
- **`verifyAccessToken`:**
  - хеш знайдено, `kind=ACCESS`, не прострочений, не відкликаний;
  - `resource` порожній або збігається з `MCP_RESOURCE_URL`;
  - **користувач досі ADMIN** (join на `User`);
  - інакше `InvalidTokenError`. `lastUsedAt` оновлювати не частіше разу на хвилину.
- **`revokeToken`:** відкликає родину.
- **`scopes_supported`:** `["budvik.read", "offline_access"]` (Claude допише `offline_access` і отримає refresh).

- [ ] Написати `scripts/check-mcp-oauth.mts` у стилі [check-calendar-oauth.mts](scripts/check-calendar-oauth.mts) (`check(name, ok, got)` + `process.exit(1)`):
  - чисті перевірки: `isAllowedRedirect` для claude.ai/chatgpt.com/localhost:5173 → true, для `https://evil.com/cb`, `http://claude.ai/…` і `https://claude.ai.evil.com/…` → false; `signParams`/`verifyParams` (підробка, протухання через 11 хв);
  - перевірки з базою (`--env-file=.env`, локальна БД, тестовий ADMIN створюється й видаляється в `finally`):
    - реєстрація з чужим редиректом падає;
    - код → токени;
    - повтор коду → родина відкликана;
    - ротація refresh;
    - повтор refresh → `invalid_grant` і родина відкликана;
    - `verifyAccessToken` після `role = SALES` → `InvalidTokenError`.
- [ ] Запустити, переконатися, що падає (модулів ще немає). Реалізувати. Запустити → усе `ok`.
- [ ] Коміт: `MCP: OAuth-сервер — реєстрація клієнтів, вхід адміна, ротація токенів`.

### Task 4: Інструменти MCP над даними

**Files:** Create `src/lib/mcp/{readonly-db,instructions,tools,server,audit}.ts`; Test `scripts/check-mcp-tools.mts`.

**Interfaces:**
- Consumes: `runReadOnlyQuery(sql, { db, maxRows, timeoutMs })` (Task 1), `VIEWS`, `RULES`/`EXAMPLES` з [query.ts](src/lib/assistant/tools/query.ts) (**експортувати** їх звідти, щоб не дублювати), `TOOL_BY_NAME` з [tools/index.ts](src/lib/assistant/tools/index.ts), `kyivDate` з `@/lib/date/kyiv`, `rateLimit`.
- Produces: `type McpCtx = { userId: string; userName: string; clientId: string | null }`, `createMcpServer(ctx: McpCtx): Server`, `logCall(ctx, tool, args, result)`, `purgeOldCalls(days = 90)`.

Інструменти (усі з `readOnlyHint: true`, `openWorldHint: false`):
1. **`describe_data`** `{ views?: string[] }`. Без аргументів — список видів (`назва`, `про_що`) + `RULES`. З назвами — колонки й приклади (та сама `viewCard`, що в `query.ts`; експортувати її).
2. **`query_db`** `{ sql: string }`:
   - `runReadOnlyQuery(sql, { db: readonlyDb, maxRows: 500, timeoutMs: 15000 })`. 500 рядків замість 100, бо для графіків потрібні денні ряди за рік.
   - Відповідь: `structuredContent = { columns, rows, truncated, ms }` і текст (JSON рядків).
   - Помилка → `isError: true` з текстом `помилка/код/підказка`.
3. **Готові зведення** адаптером над `ToolDef`: `staff_now, team_overview, staff_profile, team_receivables, documents, shifts_report, drivers_report, drivers_today, site_report, stock_health, sync_health, money_flows, sales_analysis, search_clients, client_profile, product_search`.
   - `inputSchema = def.parameters` (це вже JSON Schema з латинськими ключами).
   - `description = def.description`.
   - `run` отримує `ToolContext = { userId, role: "ADMIN", kind: "ADMIN", scope: { repId: userId, repName: userName, company: true }, today: kyivDate(new Date()) }` — той самий, що будує роут помічника ([messages/route.ts:105-115](src/app/api/sales/assistant/threads/[id]/messages/route.ts)).
   - `ToolArgError` → `isError` з повідомленням.
   - Список явний (allowlist), а не «все з kinds ADMIN»: новий пишучий інструмент не має потрапити назовні сам собою.

Сервер — низькорівневий `Server` з SDK (`setRequestHandler(ListToolsRequestSchema | CallToolRequestSchema)`), бо схеми вже є JSON Schema, і `registerTool` із zod тут зайвий.

`instructions` сервера (українською, коротко):
- гроші в гривнях;
- дати за Києвом, колонка `day`;
- продажі = `real_sale`, повернення вже від'ємні;
- спершу готові зведення, `query_db` — для решти зрізів, агрегувати в SQL;
- числа лише з інструментів;
- для графіка: агрегат ≤ 500 рядків, потім діаграма (Claude — артефакт, ChatGPT — Python);
- підписи осей українською.

Обмеження частоти: `rateLimit("mcp:"+userId, 120, 60)` → `isError: «Забагато запитів, зачекайте хвилину»`. Кожен виклик пише `McpCall`, помилка запису журналу не валить відповідь.

- [ ] Написати `scripts/check-mcp-tools.mts`: `Client` із SDK ↔ `createMcpServer` через `InMemoryTransport.createLinkedPair()`, контекст реального ADMIN з локальної БД. Перевірити:
  - `tools/list` містить 18 інструментів, усі `readOnlyHint`, немає `remind_me`/`export_file`/`query_db` помічника з полем `describe`;
  - `describe_data` повертає 29 видів;
  - `query_db` з `SELECT day, SUM(total) … GROUP BY day` → рядки й `structuredContent`;
  - `query_db` з `UPDATE …` → `isError` із підказкою;
  - `team_overview {}` → непорожня відповідь;
  - `staff_profile { who: 123 }` → `isError`, а не виняток;
  - у `McpCall` з'явились рядки.
- [ ] Запустити → FAIL. Реалізувати. Запустити → PASS.
- [ ] Коміт: `MCP: інструменти — describe_data, query_db і готові зведення керівника`.

### Task 5: HTTP-сервіс `mcp/index.ts`

**Files:** Create `mcp/index.ts`, `mcp/railway.json`, `mcp/README.md`; Modify `package.json`; Test `scripts/check-mcp-http.mts`.

**Interfaces:** Consumes `BudvikOAuthProvider`, `handleLoginPost`, `createMcpServer`, `purgeOldCalls`. Env: `PORT`, `DATABASE_URL`, `MCP_READONLY_DATABASE_URL`, `MCP_ISSUER_URL` (напр. `https://mcp.budvik27.com`), `MCP_STATE_SECRET`.

Каркас:
```ts
const issuer = new URL(process.env.MCP_ISSUER_URL!);
const resource = new URL("/mcp", issuer);
const app = createMcpExpressApp({ host: "0.0.0.0" });
app.set("trust proxy", 1);                                   // Railway за проксі: IP для лімітів
app.get("/healthz", (_q, r) => r.json({ ok: true, service: "budvik-mcp" }));
app.use(mcpAuthRouter({ provider, issuerUrl: issuer, resourceServerUrl: resource,
  scopesSupported: ["budvik.read", "offline_access"], resourceName: "Budvik" }));
app.post("/login", express.urlencoded({ extended: false }), handleLoginPost);
const bearer = requireBearerAuth({ verifier: provider,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource) });   // 401 + WWW-Authenticate
app.post("/mcp", bearer, async (req, res) => {               // без сесій: сервер і транспорт на запит
  const ctx = await ctxFromAuth(req.auth!);
  const server = createMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.all("/mcp", (_q, r) => r.status(405).set("Allow", "POST").end());
setInterval(() => purgeOldCalls().catch(console.error), 24 * 3600_000).unref();
```
Метадані авторизаційного сервера мають містити `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported` з `"none"` і `registration_endpoint`. SDK це дає; перевірити тестом.

`package.json`:
- `"mcp": "tsx --env-file=.env mcp/index.ts"`;
- `"mcp:build": "esbuild mcp/index.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/mcp.cjs --external:@prisma/client"`.

`mcp/railway.json`:
- build `npm run worker:prepare && npm run mcp:build`;
- start `node dist/mcp.cjs`;
- healthcheck `/healthz`, 1 репліка.

- [ ] `scripts/check-mcp-http.mts <baseUrl>` — повний танець, як його робить Claude:
  1. `POST /mcp` без токена → 401 і `WWW-Authenticate` з `resource_metadata`;
  2. `GET /.well-known/oauth-protected-resource/mcp` → `resource` точно дорівнює `<base>/mcp`;
  3. `GET /.well-known/oauth-authorization-server` → S256, `none`, `registration_endpoint`;
  4. `POST /register` (JSON, redirect `https://claude.ai/api/mcp/auth_callback`) → `client_id`;
  5. `GET /authorize?...&code_challenge=…` → HTML з полем `req`;
  6. `POST /login` (form-urlencoded, `MCP_CHECK_EMAIL`/`MCP_CHECK_PASSWORD` із env) → 302 з `code` та `iss`;
  7. `POST /token` form-urlencoded → access і refresh;
  8. `Client` + `StreamableHTTPClientTransport` з Bearer → `tools/list`, `query_db`;
  9. refresh → нова пара; старий refresh → `invalid_grant`.
- [ ] `npm run mcp` у фоні + `npx tsx scripts/check-mcp-http.mts http://localhost:3002` → PASS.
- [ ] `npm run mcp:build && node dist/mcp.cjs` піднімається (бандл без `next/*`).
- [ ] Для ручної перевірки: `npx @modelcontextprotocol/inspector` на `http://localhost:3002/mcp`.
- [ ] Коміт: `MCP: HTTP-сервіс на Express — OAuth, /mcp без сесій, healthz`.

### Task 6: Читальна роль Postgres для довільного SQL

**Files:** Create `scripts/mcp/readonly-role.sql`, `scripts/check-mcp-readonly.mts`, `src/lib/mcp/readonly-db.ts`.

Чому: `runReadOnlyQuery` захищений сканером і `READ ONLY`, але зараз працює від superuser. Сервіс дивиться в інтернет, тож потрібен четвертий шар, де сама база не дає ні писати, ні читати секрети.

```sql
-- READ ONLY role for MCP. Run by hand against the SITE Postgres (not 1C).
CREATE ROLE budvik_mcp_ro LOGIN PASSWORD :'pwd' CONNECTION LIMIT 4;
ALTER ROLE budvik_mcp_ro SET default_transaction_read_only = on;
ALTER ROLE budvik_mcp_ro SET statement_timeout = '20s';
GRANT CONNECT ON DATABASE railway TO budvik_mcp_ro;
GRANT USAGE ON SCHEMA public TO budvik_mcp_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO budvik_mcp_ro;
-- secrets: tokens, codes, sessions
REVOKE SELECT ON "PasswordResetToken", "DeviceToken", "PushToken",
  "McpClient", "McpAuthCode", "McpToken", "RateLimit" FROM budvik_mcp_ro;
-- User: без password (перелік колонок — ті, що читає вид staff)
REVOKE SELECT ON "User" FROM budvik_mcp_ro;
GRANT SELECT (id, name, email, phone, role, "createdAt" /* + колонки з query-views.ts */) ON "User" TO budvik_mcp_ro;
```
Остаточний список `REVOKE` виписати після `grep -n "token\|secret\|password" prisma/schema.prisma`: календарні токени, OAuth Google тощо. `ALTER DEFAULT PRIVILEGES` навмисно не ставимо: нова таблиця не стає читабельною сама, її додають явно.

`readonly-db.ts`: `export const readonlyDb = new PrismaClient({ datasources: { db: { url: withPool(process.env.MCP_READONLY_DATABASE_URL!, 2) } } })`.

- [ ] `scripts/check-mcp-readonly.mts`:
  - для **кожного** з 29 видів виконати `SELECT * FROM <view> LIMIT 1` через `runReadOnlyQuery(..., { db: readonlyDb })` → жодного `42501 permission denied`;
  - прямий `$queryRawUnsafe('SELECT password FROM "User" LIMIT 1')` → 42501;
  - `INSERT INTO "RateLimit" …` → 25006 або 42501.
- [ ] Локально створити роль у dev-базі, прогнати перевірку, звузити гранти, поки все не `ok`.
- [ ] Коміт: `MCP: окрема читальна роль Postgres для довільного SQL`.

### Task 7: Картка «Підключені AI-застосунки» в профілі адміна

**Files:** Create `src/app/api/admin/mcp-grants/route.ts`; Modify `src/app/admin/profile/page.tsx` (+ клієнтський компонент поруч, у стилі сусідніх карток профілю).

- `GET` — активні родини токенів поточного адміна: клієнт (назва), коли підключено, останнє використання, кількість викликів за 7 днів з `McpCall`.
- `DELETE ?familyId=` — відкликати родину (`revokedAt = now()` для всіх токенів родини).
- Доступ: `requireRoles(req, ["ADMIN"])` з [identity.ts](src/lib/app/identity.ts). Це Next-бік, тут він доречний.
- Під карткою — посилання на `docs`-інструкцію і адреса конектора для копіювання.

- [ ] Реалізувати. Перевірити в браузері (Playwright): підключення видно, «Відключити» → наступний виклик MCP з того клієнта отримує 401.
- [ ] Коміт: `Профіль адміна: підключені AI-застосунки з відкликанням доступу`.

### Task 8: Розгортання

Робить людина разом зі мною; кожен крок перевіряється командою.

- [ ] **Міграція на прод:** `npm run db:migrate:prod` одразу перед деплоєм сервісу (Vercel сам не мігрує).
- [ ] **Роль:** згенерувати пароль і виконати `scripts/mcp/readonly-role.sql` на прод-Postgres Railway. Прогнати `check-mcp-readonly.mts` з прод-адресою.
- [ ] **Сервіс Railway:** у проєкті Budvik створити сервіс `budvik-mcp`. Settings → Config file → `/mcp/railway.json`. Змінні:
  - `DATABASE_URL=${{Postgres.DATABASE_URL}}`;
  - `MCP_READONLY_DATABASE_URL` (внутрішній хост `postgres.railway.internal`, користувач `budvik_mcp_ro`);
  - `MCP_ISSUER_URL=https://mcp.budvik27.com`;
  - `MCP_STATE_SECRET` (випадковий).
- [ ] `railway up --service budvik-mcp --detach` з кореня репозиторію (як воркер; `.railwayignore` не відрізає `mcp/`). Перевірити `/healthz`.
- [ ] **Домен:** Railway → Networking → Custom domain `mcp.budvik27.com` → CNAME у DNS `budvik27.com` → дочекатися сертифіката.
- [ ] `npx tsx scripts/check-mcp-http.mts https://mcp.budvik27.com` з тестовим ADMIN → PASS.

### Task 9: Підключення клієнтів, приймання, документація

- [ ] **Claude:** claude.ai → Settings → Connectors → Add custom connector → `https://mcp.budvik27.com/mcp` → вхід. Перевірити на вебі й у мобільному застосунку Claude.
- [ ] **ChatGPT:** Settings → Apps → Advanced → Developer mode → Create app → той самий URL, OAuth → вхід.
- [ ] **Приймальні сценарії** в обох клієнтах, кожну цифру звірити з кабінетом:
  1. «Продажі по торгових за вересень стовпчиками»;
  2. «Денна виручка за 90 днів з ковзною середньою»;
  3. «Залежність суми боргу від днів з останньої відвантаженої накладної — діаграма розсіювання»;
  4. «ABC по брендах, топ-15»;
  5. «Пробіг водіїв проти кількості точок за тиждень»;
  6. «Напиши в базу…» → модель не може (інструментів запису немає).
- [ ] Переглянути `McpCall` за день: помилки SQL, час, чи не впираються запити в 500 рядків.
- [ ] `docs/mcp-connector.md` (українською):
  - що це і навіщо;
  - адреса й підключення в обох клієнтах з кроками;
  - безпека (лише ADMIN, читальна роль, журнал, відкликання в профілі);
  - **приватність:** дані клієнтів ідуть в Anthropic/OpenAI, тож у налаштуваннях обох вимкнути «покращувати модель»;
  - змінні оточення, деплой, відкат (вимкнути сервіс Railway = конектор мертвий, сайт не зачеплено).
- [ ] Посилання з `docs/assistant.md` і `worker/README.md` (сусідній сервіс). Запис у пам'ять `mcp-connector.md`.
- [ ] Коміт: `Документація: MCP-конектор для Claude і ChatGPT`.

---

## Перевірка наскрізь

1. `npx tsx --env-file=.env scripts/assistant-query-db.mts` — старий `query_db` не зламано.
2. `scripts/check-mcp-oauth.mts`, `check-mcp-tools.mts`, `check-mcp-readonly.mts` — усе `ok`.
3. `npm run mcp` + `check-mcp-http.mts http://localhost:3002`, потім те саме на `https://mcp.budvik27.com`.
4. MCP Inspector: список інструментів, `query_db`, помилка на `UPDATE`.
5. Живі claude.ai і ChatGPT: сценарії з Task 9, цифри збігаються з кабінетом, графіки будуються.
6. Відкликання в профілі → клієнт отримує 401 і просить увійти знову.

## Свідомо поза версією 1

- `export_file` (Excel/PDF): файли віддаються з кукою сайту, MCP-клієнт їх не завантажить.
- Віджети ChatGPT Apps SDK і MCP Prompts з готовими «дашбордами». Додамо, якщо графіки моделей виявляться слабкими.
- Доступ торговим (область «свої клієнти»).
- Лістинг у каталозі конекторів Anthropic/OpenAI: це приватний конектор фірми.
