/**
 * Проби query_db без моделі — десять пунктів «Перевірка M3» з плану.
 *
 * READ ONLY: усе, що йде в базу, — SELECT-и над видами; єдина не-SELECT
 * команда (UPDATE … WHERE false) існує саме для того, щоб довести, що
 * READ ONLY-транзакція її відкине з SQLSTATE 25006. Лічильник
 * assistant:queryDb вимкнено змінною середовища — проби не мають
 * домішуватись у бойову статистику. Nothing is written to the database.
 *
 *   npx tsx --env-file=.env scripts/assistant-query-db.mts
 *
 * Код виходу 1, якщо хоч одна перевірка впала. На кожен пункт — мс і
 * розмір JSON для моделі.
 */

import { prisma } from "../src/lib/prisma";
import { queryDbTool } from "../src/lib/assistant/tools/query";
import {
  buildQuery,
  describeDbError,
  runInReadOnlyTx,
  runReadOnlyQuery,
  validateSql,
} from "../src/lib/assistant/facts/query-db";
import { VIEWS } from "../src/lib/assistant/facts/query-views";
import { revenueByRep } from "../src/lib/analytics/facts";
import { periodOf } from "../src/lib/assistant/period";
import { shiftDay } from "../src/lib/analytics/period";
import { kyivDate } from "../src/lib/date/kyiv";
import { compact } from "../src/lib/assistant/format";
import { collectEntities } from "../src/lib/assistant/guards";
import type { ToolContext } from "../src/lib/assistant/types";

process.env.ASSISTANT_QUERY_DB_COUNTER = "off";

const SLOW_WARN_MS = 2000;
const SLOW_FAIL_MS = 5000;

type Row = Record<string, unknown>;
type ToolOut = Record<string, unknown>;

const failures: string[] = [];
const warnings: string[] = [];

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

/** Один пункт: мс, розмір, ok/FAIL; помилка — у список, а не в exit. */
async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(`ok    · ${name} · ${Date.now() - started} мс${detail ? ` · ${detail}` : ""}`);
  } catch (e) {
    const msg = (e as Error).message;
    failures.push(`${name}: ${msg}`);
    console.log(`FAIL  · ${name} · ${Date.now() - started} мс · ${msg}`);
  }
}

function slow(label: string, ms: number) {
  assert(ms < SLOW_FAIL_MS, `${label}: ${ms} мс — довше за ${SLOW_FAIL_MS}`);
  if (ms > SLOW_WARN_MS) warnings.push(`${label}: ${ms} мс (повільно, поріг ${SLOW_WARN_MS})`);
}

const ok = (r: Awaited<ReturnType<typeof runReadOnlyQuery>>, label: string) => {
  assert(r.ok, `${label}: ${r.ok ? "" : `${r.code ?? "?"} ${r.error}`}`);
  return r;
};

/* ── Контекст керівника ────────────────────────────────────────────────── */

const admin = await prisma.user.findFirst({
  where: { role: "ADMIN" },
  select: { id: true, name: true, role: true },
  orderBy: { createdAt: "asc" },
});
if (!admin) {
  console.error("У базі немає користувача з роллю ADMIN");
  process.exit(1);
}

const today = kyivDate(new Date());
const yesterday = shiftDay(today, -1);
const month = periodOf(today, { kind: "month", offset: 0 });
const weekAgo = shiftDay(today, -6);

const ctx: ToolContext = {
  userId: admin.id,
  role: admin.role,
  kind: "ADMIN",
  scope: { repId: admin.id, repName: admin.name ?? "", company: true },
  today,
};

const tool = (args: Record<string, unknown>) => queryDbTool.run(ctx, args) as Promise<ToolOut>;

console.log(`query_db · ${admin.name} · сьогодні ${today}, вчора ${yesterday}, місяць ${month.fromDay}…${month.toDay}`);
console.log(`видів: ${VIEWS.length}\n`);

/* ── 0. Кожен вид відкривається і його колонки збігаються з описом ─────── */

await check("0. усі види: SELECT * LIMIT 1 і колонки за описом", async () => {
  const notes: string[] = [];
  for (const v of VIEWS) {
    const started = Date.now();
    const r = ok(await runReadOnlyQuery(`SELECT * FROM ${v.name} LIMIT 1`, { timeoutMs: 15_000, maxRows: 1 }), v.name);
    const declared = v.columns.map((c) => c.name);
    if (r.rows.length > 0) {
      const actual = Object.keys(r.rows[0]);
      const missing = declared.filter((c) => !actual.includes(c));
      const extra = actual.filter((c) => !declared.includes(c));
      assert(missing.length === 0 && extra.length === 0, `${v.name}: опис ≠ SQL (нема ${missing.join(",") || "—"}; зайві ${extra.join(",") || "—"})`);
    } else {
      // Порожня таблиця (PickMark, Visit, CashHandover, Order, ClientMemory у проді):
      // явний перелік колонок з описом мусить пройти без 42703.
      ok(await runReadOnlyQuery(`SELECT ${declared.join(", ")} FROM ${v.name} LIMIT 0`, { maxRows: 1 }), `${v.name} (порожній, за описом)`);
      notes.push(`${v.name}=порожньо`);
    }
    const ms = Date.now() - started;
    slow(`вид ${v.name}`, ms);
    notes.push(`${v.name} ${ms}мс`);
  }
  return notes.join(", ");
});

/* ── 1. describe ───────────────────────────────────────────────────────── */

await check("1. describe [] → список, правила, приклади", async () => {
  const res = await tool({ describe: [] });
  const list = res["представлення"] as Array<Record<string, unknown>>;
  assert(Array.isArray(list) && list.length >= 25, `видів у списку ${list?.length}`);
  assert(Array.isArray(res["правила"]) && (res["правила"] as unknown[]).length === 5, "правил має бути 5");
  assert(Array.isArray(res["приклади"]) && (res["приклади"] as unknown[]).length === 3, "прикладів має бути 3");
  const size = compact(res).length;
  assert(size < 6000, `describe [] завеликий: ${size}`);
  return `${list.length} видів, ${size} символів`;
});

await check("1. describe ['documents','nope'] → колонки + помилка", async () => {
  const res = await tool({ describe: ["documents", "nope"] });
  const list = res["представлення"] as Array<Record<string, unknown>>;
  assert(list.length === 2, "має бути два записи");
  const cols = (list[0]["колонки"] as Array<{ назва: string }>).map((c) => c.назва);
  for (const need of ["day", "real_sale", "rep_id"]) assert(cols.includes(need), `у documents немає ${need}`);
  assert(Array.isArray(list[0]["приклади"]), "у documents мають бути приклади");
  assert(typeof list[1]["помилка"] === "string", "nope має віддати помилку");
  assert(Array.isArray(list[1]["доступні"]), "nope має віддати список доступних");
  return `${cols.length} колонок documents, ${compact(res).length} символів`;
});

await check("1. describe рядком «clients, products» і разом із sql", async () => {
  const res = await tool({ describe: "clients, products", sql: "SELECT COUNT(*) AS n FROM cash_handovers" });
  const list = res["представлення"] as Array<Record<string, unknown>>;
  assert(list.length === 2 && list.every((v) => Array.isArray(v["колонки"])), "обидва мають колонки");
  assert(Array.isArray(res["рядки"]) && typeof res["рядків"] === "number", "sql поруч із describe не виконано");
  return `${compact(res).length} символів`;
});

/* ── 2. Накладні Кулика за вчора ───────────────────────────────────────── */

await check("2. documents за вчора, rep ILIKE '%Кулик%'", async () => {
  const sql = `SELECT number, doc_type, client, total FROM documents WHERE day = '${yesterday}' AND rep ILIKE '%Кулик%' LIMIT 50`;
  const started = Date.now();
  const res = await tool({ sql });
  slow("п.2", Date.now() - started);
  assert(!("помилка" in res), `помилка: ${String(res["помилка"])} (${String(res["код"])})`);
  assert(typeof res["рядків"] === "number", "нема поля «рядків»");
  return `рядків ${res["рядків"]}, ${compact(res).length} символів`;
});

/* ── 3. Паритет з revenueByRep ─────────────────────────────────────────── */

await check("3. паритет documents ↔ revenueByRep за місяць", async () => {
  const expected = await revenueByRep(month.from, month.to);
  const started = Date.now();
  const r = ok(
    await runReadOnlyQuery(
      `SELECT doc_rep_id, SUM(total) AS amount, COUNT(*) FILTER (WHERE doc_type <> 'RETURN') AS docs
       FROM documents
       WHERE real_sale AND doc_rep_id IS NOT NULL AND day BETWEEN '${month.fromDay}' AND '${month.toDay}'
       GROUP BY 1`,
      { maxRows: 500 }
    ),
    "п.3"
  );
  slow("п.3", Date.now() - started);
  const got = new Map(r.rows.map((row) => [String(row.doc_rep_id), row]));
  assert(got.size === expected.length, `торгових: SQL ${got.size}, revenueByRep ${expected.length}`);
  let maxDelta = 0;
  for (const e of expected) {
    const row = got.get(e.repId);
    assert(row, `у SQL немає торгового ${e.repId}`);
    const delta = Math.abs(Number(row.amount) - e.amount);
    maxDelta = Math.max(maxDelta, delta);
    assert(delta < 1, `${e.repId}: SQL ${row.amount} ≠ ${e.amount}`);
    assert(Number(row.docs) === e.docs, `${e.repId}: документів SQL ${row.docs} ≠ ${e.docs}`);
  }
  const total = expected.reduce((s, e) => s + e.amount, 0);
  return `${expected.length} торгових, оборот ${Math.round(total)} ₴, max |Δ| ${maxDelta.toFixed(3)} ₴, ${r.ms} мс`;
});

/* ── 4. clients WHERE debt > 0 проти Prisma ────────────────────────────── */

let debtRows: Row[] = [];

await check("4. clients debt > 0 ↔ prisma.counterparty", async () => {
  const started = Date.now();
  const r = ok(
    await runReadOnlyQuery("SELECT client_id, name, debt, rep FROM clients WHERE debt > 0 ORDER BY debt DESC, client_id LIMIT 100", {
      maxRows: 100,
    }),
    "п.4 список"
  );
  slow("п.4", Date.now() - started);
  debtRows = r.rows;
  const cnt = ok(await runReadOnlyQuery("SELECT COUNT(*) AS n FROM clients WHERE debt > 0"), "п.4 count");
  const expectedCount = await prisma.counterparty.count({ where: { receivableBalance: { gt: 0 } } });
  assert(Number(cnt.rows[0].n) === expectedCount, `боржників SQL ${cnt.rows[0].n} ≠ Prisma ${expectedCount}`);
  const top = await prisma.counterparty.findMany({
    where: { receivableBalance: { gt: 0 } },
    orderBy: [{ receivableBalance: "desc" }, { id: "asc" }],
    take: 5,
    select: { id: true },
  });
  const topSql = r.rows.slice(0, 5).map((row) => String(row.client_id));
  assert(JSON.stringify(topSql) === JSON.stringify(top.map((t) => t.id)), "топ-5 боржників не збігається");
  return `боржників ${expectedCount}, топ-5 збігається, ${r.ms} мс`;
});

/* ── 5. Відмови ────────────────────────────────────────────────────────── */

await check("5. відмови сканера (без бази)", async () => {
  const bad: Array<[string, RegExp]> = [
    ['UPDATE "SyncState" SET value = value', /лапки|UPDATE/],
    ["UPDATE clients SET debt = 0", /SELECT або WITH/],
    ['SELECT * FROM "User"', /лапки/],
    ["WITH x AS (DELETE FROM clients) SELECT 1", /DELETE/],
    ["SELECT pg_sleep(20)", /pg_sleep/],
    ["SELECT 1; SELECT 2", /крапка з комою/],
    ["SELECT $1", /\$/],
    ["SELECT * FROM clients FOR UPDATE", /UPDATE/],
    ["SELECT * FROM pg_stat_activity", /pg_stat/],
    ["SELECT E'\\'' FROM clients", /escape/],
    ["SELECT name FROM clients WHERE name = 'abc", /літерал/],
    ["SELECT name /* коментар без кінця FROM clients", /коментар/],
    ["EXPLAIN SELECT 1", /SELECT або WITH/],
    ["SELECT * INTO t FROM clients", /INTO/],
  ];
  for (const [sql, re] of bad) {
    const c = validateSql(sql);
    assert(!c.ok, `мало б відмовити: ${sql}`);
    assert(re.test(c.error), `${sql} → «${c.error}» (очікували ${re})`);
  }
  // Через інструмент — помилка як дані, без походу в базу (ms = 0).
  const viaTool = await runReadOnlyQuery('UPDATE "SyncState" SET value = value WHERE false');
  assert(!viaTool.ok && viaTool.ms === 0, "UPDATE мав відпасти на сканері, без бази");
  const res = await tool({ sql: "DELETE FROM clients" });
  assert(typeof res["помилка"] === "string" && res["код"] === null, "інструмент має віддати помилку як дані");
  return `${bad.length} відмов`;
});

await check("5. дозволено: ILIKE '%set%', власний WITH, коментарі, FETCH FIRST, ; в кінці", async () => {
  const good = [
    "SELECT name FROM clients WHERE name ILIKE '%set%' LIMIT 1",
    "SELECT name FROM clients WHERE notes ILIKE '%drop table%' OR name = 'it''s' LIMIT 1;",
    `-- оборот по торгових
     WITH d AS (SELECT * FROM documents WHERE real_sale AND day >= '${month.fromDay}')
     SELECT rep, SUM(total) AS amount /* нетто */
     FROM d GROUP BY rep ORDER BY amount DESC
     FETCH FIRST 5 ROWS ONLY;`,
    "SELECT comment FROM cash_handovers LIMIT 1",
  ];
  for (const sql of good) {
    const c = validateSql(sql);
    assert(c.ok, `мало б пройти: ${sql} → ${c.ok ? "" : c.error}`);
    ok(await runReadOnlyQuery(sql), sql.slice(0, 40));
  }
  const c = validateSql(good[2]);
  assert(c.ok && c.views.includes("documents") && c.views.length === 1, "у власному WITH мав знайтись лише documents");
  return `${good.length} запитів`;
});

await check("5. потрійний cross join → 57014 за таймаутом", async () => {
  const started = Date.now();
  const r = await runReadOnlyQuery("SELECT COUNT(*) AS n FROM document_lines a, document_lines b, document_lines c", {
    timeoutMs: 3000,
  });
  const ms = Date.now() - started;
  assert(!r.ok, "декартів добуток мав упасти за часом");
  assert(r.code === "57014", `код ${r.code}: ${r.error}`);
  assert(ms >= 2500 && ms < 15_000, `таймаут спрацював за ${ms} мс`);
  assert(r.hint && /час/.test(r.hint), "підказка має бути про час");
  return `${ms} мс, підказка: ${r.hint}`;
});

await check("5. рівень бази: UPDATE … WHERE false → SQLSTATE 25006", async () => {
  let caught: unknown = null;
  try {
    await runInReadOnlyTx('UPDATE "SyncState" SET value = value WHERE false', 5000);
  } catch (e) {
    caught = e;
  }
  assert(caught, "READ ONLY-транзакція мала відкинути UPDATE");
  const d = describeDbError(caught);
  assert(d.code === "25006", `код ${d.code}: ${d.error}`);
  return `25006 · ${d.hint}`;
});

/* ── 6. Невідома колонка ───────────────────────────────────────────────── */

await check("6. SELECT nosuch FROM documents → 42703 + підказка describe", async () => {
  const res = await tool({ sql: "SELECT nosuch FROM documents LIMIT 1" });
  assert(typeof res["помилка"] === "string", "нема поля «помилка»");
  assert(res["код"] === "42703", `код ${String(res["код"])}`);
  assert(/describe/.test(String(res["підказка"])), "підказка має згадувати describe");
  const used = res["представлення_у_запиті"] as string[];
  assert(Array.isArray(used) && used.includes("documents"), "має назвати documents");
  return `${String(res["помилка"])}`;
});

/* ── 7. Типи ───────────────────────────────────────────────────────────── */

await check("7. типи: bigint, float, numeric, date, timestamp; JSON.stringify", async () => {
  const started = Date.now();
  const r = ok(
    await runReadOnlyQuery(
      `SELECT COUNT(*) AS n, SUM(total) AS s, AVG(lines) AS avg_lines, MIN(day) AS d, MIN(created_at) AS t,
              MAX(confirmed_at) AS ct, bool_or(from_1c) AS b, MIN(clock) AS clk
       FROM documents WHERE real_sale`
    ),
    "п.7"
  );
  slow("п.7", Date.now() - started);
  const row = r.rows[0];
  assert(typeof row.n === "number" && row.n > 0, `count → ${typeof row.n}`);
  assert(typeof row.s === "number", `sum → ${typeof row.s}`);
  assert(typeof row.avg_lines === "number", `avg(int) (numeric/Decimal) → ${typeof row.avg_lines}`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(String(row.d)), `min(day) → ${String(row.d)}`);
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(row.t)), `min(created_at) → ${String(row.t)}`);
  assert(row.ct === null || /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(String(row.ct)), `max(confirmed_at) → ${String(row.ct)}`);
  assert(row.b === true, "bool_or → boolean");
  assert(/^\d{2}:\d{2}$/.test(String(row.clk)), `clock → ${String(row.clk)}`);
  const json = JSON.stringify(r.rows);
  assert(json.length > 0, "JSON.stringify");
  return `n=${row.n}, s=${row.s}, d=${row.d}, t=${row.t}, ct=${row.ct}, ${r.ms} мс`;
});

await check("7. day для 1С і для сайту — одна й та сама київська доба", async () => {
  // Реалізація за вчора: через day і через межі kyivDayStart/kyivDayEnd мають дати одне число.
  const p = periodOf(today, { kind: "range", from: yesterday, to: yesterday });
  const viaDay = ok(
    await runReadOnlyQuery(`SELECT COUNT(*) AS n FROM documents WHERE real_sale AND doc_type <> 'RETURN' AND day = '${yesterday}'`),
    "п.7 day"
  );
  const viaPrisma = await prisma.salesDocument.count({
    where: { externalId: { not: null }, status: "CONFIRMED", docType: "REALIZATION", createdAt: { gte: p.from, lte: p.to } },
  });
  assert(Number(viaDay.rows[0].n) === viaPrisma, `за вчора: day ${viaDay.rows[0].n} ≠ Prisma ${viaPrisma}`);
  return `реалізацій за вчора ${viaPrisma}`;
});

/* ── 8. collectEntities ────────────────────────────────────────────────── */

await check("8. collectEntities на боржниках: client_id і числа", async () => {
  assert(debtRows.length > 0, "п.4 не дав рядків");
  const entities = collectEntities({ рядки: debtRows });
  assert(entities.numbers.size > 0, "числа не зібрано");
  if (entities.clients.size === 0) {
    warnings.push("п.8: client_id ще не в CLIENT_KEYS guards.ts — посилання на клієнтів із query_db зʼявляться після реєстрації");
    return `чисел ${entities.numbers.size}; client_id ОЧІКУЄ guards.ts`;
  }
  assert(entities.clients.size === debtRows.length, `client_id зібрано ${entities.clients.size} з ${debtRows.length}`);
  return `клієнтів ${entities.clients.size}, чисел ${entities.numbers.size}`;
});

/* ── 9. Час еталонних запитів ──────────────────────────────────────────── */

const REFERENCE: Array<[string, string]> = [
  ["products ILIKE піна", "SELECT sku, name, brand, price, stock_free, last_sale_day FROM products WHERE active AND name ILIKE '%піна%' ORDER BY stock_free DESC LIMIT 20"],
  [
    "document_lines по торгових за місяць (драбина)",
    `SELECT rep, SUM(amount) AS amount, SUM(quantity) AS qty FROM document_lines WHERE real_sale AND day BETWEEN '${month.fromDay}' AND '${month.toDay}' GROUP BY rep ORDER BY amount DESC LIMIT 20`,
  ],
  [
    "document_lines по брендах за місяць",
    `SELECT brand, SUM(amount) AS amount, SUM(amount - quantity * cost) FILTER (WHERE cost > 0) AS profit FROM document_lines WHERE real_sale AND day BETWEEN '${month.fromDay}' AND '${month.toDay}' GROUP BY brand ORDER BY amount DESC LIMIT 15`,
  ],
  [
    "document_lines піна по днях",
    `SELECT day, SUM(quantity) AS qty, SUM(amount) AS amount FROM document_lines WHERE real_sale AND product ILIKE '%піна%' AND day >= '${month.fromDay}' GROUP BY day ORDER BY day LIMIT 31`,
  ],
  [
    "payment_allocations за місяць",
    `SELECT rep, SUM(amount) AS collected, SUM(profit) AS profit FROM payment_allocations WHERE day BETWEEN '${month.fromDay}' AND '${month.toDay}' GROUP BY rep ORDER BY collected DESC LIMIT 20`,
  ],
  ["shifts за місяць", `SELECT name, COUNT(*) AS shifts, SUM(distance_km) AS km FROM shifts WHERE day BETWEEN '${month.fromDay}' AND '${month.toDay}' GROUP BY name ORDER BY km DESC LIMIT 20`],
  ["route_sheet_stops за тиждень", `SELECT driver, COUNT(*) AS stops, SUM(amount) AS amount FROM route_sheet_stops WHERE day BETWEEN '${weekAgo}' AND '${today}' AND NOT hidden GROUP BY driver ORDER BY stops DESC LIMIT 20`],
  ["rep_clients Кулика", "SELECT client, pinned, has_docs FROM rep_clients WHERE rep ILIKE '%Кулик%' ORDER BY client LIMIT 50"],
  ["clients по торгових", "SELECT rep, COUNT(*) AS clients, SUM(debt) AS debt FROM clients WHERE debt > 0 GROUP BY rep ORDER BY debt DESC LIMIT 20"],
  ["documents накладна за номером", "SELECT number, doc_type, status, client, total, lines FROM documents WHERE number LIKE '%6466' LIMIT 5"],
  ["stock_by_location по складах", "SELECT location, service, COUNT(*) AS items, SUM(available) AS pieces FROM stock_by_location WHERE available > 0 GROUP BY location, service ORDER BY pieces DESC LIMIT 20"],
  ["debt_snapshots останній день", "SELECT day, COUNT(*) AS clients, SUM(balance) AS balance FROM debt_snapshots GROUP BY day ORDER BY day DESC LIMIT 7"],
];

await check("9. еталонні запити < 2 с (провал > 5 с)", async () => {
  const times: string[] = [];
  for (const [label, sql] of REFERENCE) {
    const r = ok(await runReadOnlyQuery(sql), label);
    slow(label, r.ms);
    times.push(`${label} ${r.ms}мс/${r.rows.length}р`);
  }
  return times.join("; ");
});

/* ── Довідка: як виглядає зібраний запит ──────────────────────────────── */

const sample = validateSql("SELECT rep, SUM(total) AS amount FROM documents WHERE real_sale AND day = '2026-09-09' GROUP BY rep LIMIT 20");
if (sample.ok) {
  const built = buildQuery(sample.sql, sample.views, 100);
  console.log(`\nзібраний запит для documents: ${built.length} символів, CTE: ${(built.match(/AS NOT MATERIALIZED/g) ?? []).length}`);
}

/* ── Підсумок ──────────────────────────────────────────────────────────── */

console.log("");
for (const w of warnings) console.log(`УВАГА · ${w}`);
if (failures.length) {
  console.log(`\nПРОВАЛЕНО ${failures.length}:`);
  for (const f of failures) console.log(`  · ${f}`);
} else {
  console.log("Усі перевірки пройшли. Nothing was written to the database.");
}

await prisma.$disconnect();
process.exit(failures.length ? 1 : 0);
