/**
 * Читальна роль MCP (budvik_mcp_ro): усі 29 видів query_db читаються, а
 * секрети й запис — ні, навіть повз сканер SQL.
 *
 * Роль — четвертий шар захисту довільного SQL (див. src/lib/mcp/readonly-db.ts):
 * тут перевіряємо саме його, тому ходимо в базу і через runReadOnlyQuery
 * (як MCP), і сирим $queryRawUnsafe (як нібито пройшло б повз сканер).
 *
 *   MCP_READONLY_DATABASE_URL=postgresql://budvik_mcp_ro:…@…/… \
 *     npx tsx --env-file=.env scripts/check-mcp-readonly.mts
 *
 * READ ONLY: єдині спроби запису (INSERT у RateLimit) мають упасти — у цьому
 * й суть перевірки. Nothing is written to the database.
 * Після кожної нової міграції, що додає таблицю, яку читає вид, — прогнати
 * знову (і перезапустити scripts/mcp/readonly-role.sql).
 */

import { VIEWS } from "../src/lib/assistant/facts/query-views";
import { describeDbError, runReadOnlyQuery } from "../src/lib/assistant/facts/query-db";
import { readonlyDb } from "../src/lib/mcp/readonly-db";

if (!process.env.MCP_READONLY_DATABASE_URL) {
  console.log("Задайте MCP_READONLY_DATABASE_URL — адресу бази під роллю budvik_mcp_ro.");
  process.exit(1);
}
process.env.ASSISTANT_QUERY_DB_COUNTER = "off";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got).slice(0, 160)}`);
  if (!ok) fails.push(name);
}

const db = readonlyDb();

/** Код SQLSTATE помилки або «ok», якщо запит пройшов. */
async function sqlstate(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    return describeDbError(e).code ?? `?: ${(e as Error).message.slice(0, 80)}`;
  }
}

/* ── Хто ми ─────────────────────────────────────────────────────────── */

const [me] = await db.$queryRawUnsafe<{ user: string; su: boolean; ro: string }[]>(
  "SELECT current_user AS user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su, current_setting('default_transaction_read_only') AS ro"
);
check("під роллю budvik_mcp_ro", me.user === "budvik_mcp_ro", me.user);
check("не superuser", me.su === false, me.su);
check("сесія за замовчуванням лише на читання", me.ro === "on", me.ro);

/* ── Усі види читаються ─────────────────────────────────────────────── */

const denied: string[] = [];
for (const v of VIEWS) {
  const r = await runReadOnlyQuery(`SELECT * FROM ${v.name} LIMIT 1`, { db, timeoutMs: 15_000, maxRows: 1 });
  if (!r.ok) denied.push(`${v.name}: ${r.code} ${r.error.slice(0, 60)}`);
}
check(`усі ${VIEWS.length} видів читаються`, denied.length === 0, denied.join("; ") || "усі");

/* ── Секрети не читаються навіть сирим SQL ──────────────────────────── */

const SECRETS: [string, string][] = [
  ["пароль користувача", 'SELECT password FROM "User" LIMIT 1'],
  ["User цілком (SELECT *)", 'SELECT * FROM "User" LIMIT 1'],
  ["токени скидання пароля", 'SELECT "tokenHash" FROM "PasswordResetToken" LIMIT 1'],
  ["токени пристроїв", 'SELECT "tokenHash" FROM "DeviceToken" LIMIT 1'],
  ["пуш-токени", 'SELECT token FROM "PushToken" LIMIT 1'],
  ["Google-календар (refresh)", 'SELECT "refreshTokenEnc" FROM "CalendarConnection" LIMIT 1'],
  ["токени MCP", 'SELECT "tokenHash" FROM "McpToken" LIMIT 1'],
  ["коди MCP", 'SELECT "codeHash" FROM "McpAuthCode" LIMIT 1'],
  ["секрети клієнтів MCP", 'SELECT secret FROM "McpClient" LIMIT 1'],
  ["гостьовий токен замовлення", 'SELECT "guestToken" FROM "Order" LIMIT 1'],
  ["токен посилання розсилки", 'SELECT "linkToken" FROM "ClientOutreach" LIMIT 1'],
];
for (const [label, sql] of SECRETS) {
  const code = await sqlstate(() => db.$queryRawUnsafe(sql));
  check(`${label} → 42501`, code === "42501", code);
}
check("несекретні колонки User читаються", (await sqlstate(() => db.$queryRawUnsafe('SELECT id, name, role FROM "User" LIMIT 1'))) === "ok", "ok");

/* ── Запис неможливий, навіть якщо зняти read only сесії ───────────── */

const ins = await sqlstate(() => db.$executeRawUnsafe(`INSERT INTO "RateLimit" ("key", "count", "windowAt") VALUES ('mcp-ro-probe', 1, now())`));
check("INSERT → відмова (25006 або 42501)", ins === "25006" || ins === "42501", ins);
const insRw = await sqlstate(() =>
  db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ WRITE");
    await tx.$executeRawUnsafe(`INSERT INTO "RateLimit" ("key", "count", "windowAt") VALUES ('mcp-ro-probe', 1, now())`);
  })
);
check("READ WRITE + INSERT → 42501 (прав на запис немає)", insRw === "42501", insRw);
const ddl = await sqlstate(() =>
  db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ WRITE");
    await tx.$executeRawUnsafe("CREATE TABLE mcp_ro_probe (x int)");
  })
);
check("CREATE TABLE → 42501", ddl === "42501", ddl);

await db.$disconnect();
console.log(fails.length ? `\nПРОВАЛЕНО ${fails.length}: ${fails.join("; ")}` : "\nУсе гаразд. Nothing was written to the database.");
process.exit(fails.length ? 1 : 0);
