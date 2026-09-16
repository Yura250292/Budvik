/**
 * Знімок фундаменту даних: контакти, свої, згоди, глибина історії реалізацій.
 *
 * READ ONLY. Усі запити — SELECT у READ ONLY-транзакції (база сама відхилить
 * будь-який запис). Єдине, що скрипт пише, — JSON-знімок на диск:
 * scripts/backup-data-foundation-<дата>.json. Nothing is written to the database.
 *
 *   npx tsx --env-file=.env scripts/report-data-foundation.mts
 *
 * Навіщо. Два рішення спираються на ці числа: (1) чи є кому писати — живі
 * мобільні, згоди, свої серед «втрачених»; (2) бекфіл реалізацій 2024–2025
 * (docs/1c-backfill-2024.md) — прогнати ДО і ПІСЛЯ й порівняти. Оборот 2026 по
 * торгових мусить лишитися тим самим до гривні: бекфіл дописує історію, а не
 * переписує поточний рік.
 *
 * Нові колонки (isInternal, згоди, primaryPhoneE164) і таблиця
 * CounterpartyContact на проді можуть бути ще без міграції — тоді відповідні
 * метрики пропускаються з позначкою, а решта звіту працює.
 */

import { existsSync, writeFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { SOURCE_FILTER } from "../src/lib/analytics/facts";
import { ANALYTICS_SINCE_DAY } from "../src/lib/analytics/since";
import { isInternalCounterparty, nameKey } from "../src/lib/rep-feed/internal";
import { firstValidE164, primaryMobileE164 } from "../src/lib/phone";
import { kyivDate } from "../src/lib/date/kyiv";

const DAY_MS = 86_400_000;
const STAFF_ROLES = ["ADMIN", "MANAGER", "SALES", "DRIVER", "WAREHOUSE"];

type Tx = Prisma.TransactionClient;

const report: Record<string, unknown> = { generatedAt: new Date().toISOString(), analyticsSinceDay: ANALYTICS_SINCE_DAY };
const notes: string[] = [];

const uah = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(n).toLocaleString("uk-UA").replace(/ /g, " ");
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");
const n = (v: unknown) => Number(v ?? 0);

async function columnExists(tx: Tx, table: string, column: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function tableExists(tx: Tx, table: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = ${table}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

await prisma.$transaction(
  async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;

    const has = {
      isInternal: await columnExists(tx, "Counterparty", "isInternal"),
      consent: await columnExists(tx, "Counterparty", "marketingConsent"),
      primaryPhone: await columnExists(tx, "Counterparty", "primaryPhoneE164"),
      contacts: await tableExists(tx, "CounterpartyContact"),
    };
    report.schema = has;
    if (!has.isInternal) notes.push("Counterparty.isInternal немає — свої відсіяні евристикою за назвою (rep-feed/internal.ts), а не ознакою");
    if (!has.consent) notes.push("Counterparty.marketingConsent немає — розподіл згод пропущено");
    if (!has.primaryPhone) notes.push("Counterparty.primaryPhoneE164 немає — метрику пропущено");
    if (!has.contacts) notes.push("таблиці CounterpartyContact немає — контакти з 1С пропущено");

    // ── Контрагенти й контакти ───────────────────────────────────────────
    const [base] = await tx.$queryRaw<Array<Record<string, number>>>`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE type::text IN ('CUSTOMER', 'BOTH'))::int AS customers,
        COUNT(*) FILTER (WHERE "isActive")::int AS active,
        COUNT(*) FILTER (WHERE "externalId" IS NOT NULL)::int AS "from1C",
        COUNT(*) FILTER (WHERE phone IS NOT NULL AND btrim(phone) <> '')::int AS "withPhone",
        COUNT(*) FILTER (WHERE email IS NOT NULL AND btrim(email) <> '')::int AS "withEmail"
      FROM "Counterparty"
    `;
    const counterparties: Record<string, unknown> = { ...base };

    if (has.primaryPhone) {
      const [row] = await tx.$queryRaw<Array<{ c: number }>>`
        SELECT COUNT(*)::int AS c FROM "Counterparty" WHERE "primaryPhoneE164" IS NOT NULL
      `;
      counterparties.withPrimaryPhoneE164 = row.c;
    }

    // Мобільний рахуємо тією ж функцією, що й обмін контактів: поле phone
    // лежить так, як його набрали в 1С, і SQL-регуляркою його не розібрати.
    const phones = await tx.$queryRaw<Array<{ phone: string; type: string }>>`
      SELECT phone, type::text AS type FROM "Counterparty" WHERE phone IS NOT NULL AND btrim(phone) <> ''
    `;
    let mobile = 0;
    let mobileCustomers = 0;
    let validAny = 0;
    for (const p of phones) {
      if (firstValidE164(p.phone)) validAny++;
      if (primaryMobileE164(p.phone)) {
        mobile++;
        if (p.type !== "SUPPLIER") mobileCustomers++;
      }
    }
    counterparties.phoneValidUa = validAny;
    counterparties.phoneMobileParsable = mobile;
    counterparties.phoneMobileParsableCustomers = mobileCustomers;
    report.counterparties = counterparties;

    if (has.contacts) {
      report.contactsByKindSource = await tx.$queryRaw`
        SELECT kind, source, COUNT(*)::int AS rows, COUNT(DISTINCT "counterpartyId")::int AS counterparties
        FROM "CounterpartyContact"
        GROUP BY 1, 2
        ORDER BY 3 DESC
      `;
    }

    if (has.consent) {
      report.consent = await tx.$queryRaw`
        SELECT "marketingConsent" AS consent, COALESCE("marketingConsentSource", '—') AS source,
               COUNT(*)::int AS counterparties,
               COUNT(*) FILTER (WHERE "marketingOptOutAt" IS NOT NULL)::int AS "optedOut"
        FROM "Counterparty"
        GROUP BY 1, 2
        ORDER BY 3 DESC
      `;
      report.preferredChannel = await tx.$queryRaw`
        SELECT COALESCE("preferredChannel", '—') AS channel, COUNT(*)::int AS counterparties
        FROM "Counterparty" GROUP BY 1 ORDER BY 2 DESC
      `;
    }

    // ── Свої ─────────────────────────────────────────────────────────────
    const staff = await tx.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM "User" WHERE role::text IN (${Prisma.join(STAFF_ROLES)})
    `;
    const staffKeys = new Set(staff.map((s) => nameKey(s.name)).filter((k) => k.split(" ").length >= 2));

    const flagCol = has.isInternal ? Prisma.sql`c."isInternal"` : Prisma.sql`false`;
    const reasonCol = has.isInternal ? Prisma.sql`c."internalReason"` : Prisma.sql`NULL::text`;

    // Один прохід по всіх контрагентах: остання реалізація, нетто-оборот із
    // межі аналітики і за всю історію. SOURCE_FILTER — той самий, що в КПІ.
    const perClient = await tx.$queryRaw<
      Array<{
        id: string;
        name: string;
        type: string;
        flagged: boolean;
        reason: string | null;
        lastRealizationAt: Date | null;
        revenueSince: number;
        revenueAll: number;
        receivable: number | null;
      }>
    >`
      WITH d AS (
        SELECT s."counterpartyId" AS id,
               MAX(s."createdAt") FILTER (WHERE s."docType" = 'REALIZATION') AS "lastRealizationAt",
               COALESCE(SUM(s."totalAmount") FILTER (WHERE s."createdAt" >= ${new Date(`${ANALYTICS_SINCE_DAY}T00:00:00Z`)}), 0)::float AS "revenueSince",
               COALESCE(SUM(s."totalAmount"), 0)::float AS "revenueAll"
        FROM "SalesDocument" s
        WHERE ${SOURCE_FILTER} AND s."counterpartyId" IS NOT NULL
        GROUP BY 1
      )
      SELECT c.id, c.name, c.type::text AS type, ${flagCol} AS flagged, ${reasonCol} AS reason,
             d."lastRealizationAt", COALESCE(d."revenueSince", 0)::float AS "revenueSince",
             COALESCE(d."revenueAll", 0)::float AS "revenueAll",
             c."receivableBalance"::float AS receivable
      FROM "Counterparty" c
      LEFT JOIN d ON d.id = c.id
    `;

    const internalOf = (r: (typeof perClient)[number]) =>
      has.isInternal ? r.flagged : isInternalCounterparty(r.name, staffKeys);

    const internal = perClient.filter(internalOf).sort((a, b) => b.revenueSince - a.revenueSince);
    report.internal = {
      basis: has.isInternal ? "Counterparty.isInternal" : "евристика за назвою",
      count: internal.length,
      revenueSince: internal.reduce((s, r) => s + r.revenueSince, 0),
      list: internal.map((r) => ({
        id: r.id,
        name: r.name,
        reason: r.reason,
        revenueSince: Math.round(r.revenueSince),
        lastRealization: r.lastRealizationAt?.toISOString().slice(0, 10) ?? null,
        receivable: r.receivable,
      })),
    };

    // ── Давність останньої реалізації (без своїх і постачальників) ───────
    const now = Date.now();
    const buckets = [
      { key: "≤30", max: 30 },
      { key: "31–60", max: 60 },
      { key: "61–90", max: 90 },
      { key: "91–180", max: 180 },
      { key: "181–365", max: 365 },
      { key: ">365", max: Infinity },
    ];
    const recency = new Map<string, { clients: number; revenueSince: number; revenueAll: number; receivable: number }>();
    for (const key of [...buckets.map((b) => b.key), "never"]) {
      recency.set(key, { clients: 0, revenueSince: 0, revenueAll: 0, receivable: 0 });
    }
    for (const r of perClient) {
      if (r.type === "SUPPLIER" || internalOf(r)) continue;
      let key = "never";
      if (r.lastRealizationAt) {
        const days = Math.floor((now - r.lastRealizationAt.getTime()) / DAY_MS);
        key = buckets.find((b) => days <= b.max)!.key;
      }
      const acc = recency.get(key)!;
      acc.clients++;
      acc.revenueSince += r.revenueSince;
      acc.revenueAll += r.revenueAll;
      acc.receivable += r.receivable ?? 0;
    }
    report.recencyExclInternal = Object.fromEntries(recency);
    report.counterpartiesWithRealization = perClient.filter((r) => r.lastRealizationAt).length;

    // ── Реалізації: глибина й помісячно ──────────────────────────────────
    report.realizationSpan = await tx.$queryRaw`
      SELECT s."docType"::text AS "docType", MIN(s."createdAt") AS min, MAX(s."createdAt") AS max, COUNT(*)::int AS docs
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
      GROUP BY 1
    `;

    // Мітки 1С — київський настінний час, збережений як UTC, тож місяць
    // береться прямо з createdAt, без зсуву поясу.
    const byMonth = await tx.$queryRaw<
      Array<{ month: string; realizations: number; returns: number; net: number; clients: number }>
    >`
      SELECT to_char(date_trunc('month', s."createdAt"), 'YYYY-MM') AS month,
             COUNT(*) FILTER (WHERE s."docType" = 'REALIZATION')::int AS realizations,
             COUNT(*) FILTER (WHERE s."docType" = 'RETURN')::int AS returns,
             SUM(s."totalAmount")::float AS net,
             COUNT(DISTINCT s."counterpartyId") FILTER (WHERE s."docType" = 'REALIZATION')::int AS clients
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
      GROUP BY 1
      ORDER BY 1
    `;
    report.realizationsByMonth = byMonth;

    // Статуси за роками — усі реалізації з 1С, не лише проведені: бекфіл
    // тягне й непроведені (DRAFT), і їх треба бачити окремо.
    report.realizationStatusByYear = await tx.$queryRaw`
      SELECT to_char(s."createdAt", 'YYYY') AS year, s.status::text AS status, COUNT(*)::int AS docs
      FROM "SalesDocument" s
      WHERE s."externalId" IS NOT NULL AND s."docType" = 'REALIZATION'
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;

    report.docsMissingLinksByYear = await tx.$queryRaw`
      SELECT to_char(s."createdAt", 'YYYY') AS year, s."docType"::text AS "docType",
             COUNT(*)::int AS docs,
             COUNT(*) FILTER (WHERE s."counterpartyId" IS NULL)::int AS "noCounterparty",
             COUNT(*) FILTER (WHERE s."salesRepId" IS NULL)::int AS "noSalesRep"
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;

    report.unmatchedDiscrepancies = await tx.$queryRaw`
      SELECT field, COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE NOT resolved)::int AS unresolved,
             COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '30 days')::int AS "last30d"
      FROM "SyncDiscrepancy"
      WHERE field IN ('UNMATCHED_PRODUCT', 'UNMATCHED_SALES_REP')
      GROUP BY 1
      ORDER BY 1
    `;

    // Оборот 2026 по торгових помісячно — контроль бекфілу: ДО і ПІСЛЯ
    // числа мусять збігтися до гривні.
    report.revenueByRepMonth2026 = await tx.$queryRaw`
      SELECT COALESCE(u.name, '(без торгового)') AS rep, s."salesRepId" AS "repId",
             to_char(date_trunc('month', s."createdAt"), 'YYYY-MM') AS month,
             COUNT(*) FILTER (WHERE s."docType" = 'REALIZATION')::int AS realizations,
             ROUND(SUM(s."totalAmount")::numeric, 2)::float AS net
      FROM "SalesDocument" s
      LEFT JOIN "User" u ON u.id = s."salesRepId"
      WHERE ${SOURCE_FILTER}
        AND s."createdAt" >= TIMESTAMP '2026-01-01' AND s."createdAt" < TIMESTAMP '2027-01-01'
      GROUP BY 1, 2, 3
      ORDER BY 1, 3
    `;
  },
  { timeout: 300_000, maxWait: 20_000 }
);

report.notes = notes;

const date = kyivDate(new Date());
let path = `scripts/backup-data-foundation-${date}.json`;
// ДО і ПІСЛЯ бекфілу легко припадають на один день — другий знімок не затирає перший.
if (existsSync(path)) path = path.replace(".json", `-${new Date().toISOString().slice(11, 16).replace(":", "")}.json`);
writeFileSync(path, JSON.stringify(report, null, 2));

// ── Друк ─────────────────────────────────────────────────────────────────
const cp = report.counterparties as Record<string, number>;
console.log("Фундамент даних — знімок", report.generatedAt);
for (const note of notes) console.log(`  ⚠ ${note}`);

console.log("\nКонтрагенти");
console.log(`  усього ${cp.total}, покупців (CUSTOMER/BOTH) ${cp.customers}, активних ${cp.active}, з 1С ${cp.from1C}`);
console.log(`  телефон заповнено ${cp.withPhone} (${pct(cp.withPhone, cp.total)}), валідний UA ${cp.phoneValidUa}, мобільний розбирається ${cp.phoneMobileParsable} (не постачальників ${cp.phoneMobileParsableCustomers})`);
if (cp.withPrimaryPhoneE164 !== undefined) console.log(`  primaryPhoneE164 ${cp.withPrimaryPhoneE164}`);
console.log(`  email ${cp.withEmail} (${pct(cp.withEmail, cp.total)})`);
if (report.contactsByKindSource) console.table(report.contactsByKindSource);
if (report.consent) console.table(report.consent);

const internal = report.internal as { basis: string; count: number; revenueSince: number; list: Array<Record<string, unknown>> };
console.log(`\nСвої (${internal.basis}): ${internal.count}, оборот з ${ANALYTICS_SINCE_DAY}: ${uah(internal.revenueSince)} ₴`);
for (const r of internal.list.slice(0, 25)) {
  console.log(`  ${String(r.name).slice(0, 50).padEnd(50)} ${uah(r.revenueSince as number).padStart(12)}  ост. ${r.lastRealization ?? "—"}  ${r.reason ?? ""}`);
}
if (internal.list.length > 25) console.log(`  … ще ${internal.list.length - 25}`);

console.log(`\nДавність останньої реалізації (без своїх і постачальників), оборот нетто з ${ANALYTICS_SINCE_DAY}:`);
const rec = report.recencyExclInternal as Record<string, { clients: number; revenueSince: number; revenueAll: number; receivable: number }>;
for (const [key, v] of Object.entries(rec)) {
  console.log(`  ${key.padEnd(8)} ${String(v.clients).padStart(6)} клієнтів  ${uah(v.revenueSince).padStart(14)} ₴  (уся історія ${uah(v.revenueAll)} ₴, борг ${uah(v.receivable)} ₴)`);
}
console.log(`  з реалізацією хоч раз: ${report.counterpartiesWithRealization}`);

console.log("\nГлибина документів (SOURCE_FILTER)");
console.table(report.realizationSpan);
console.log("Помісячно: реалізації / повернення / нетто / клієнтів");
for (const m of report.realizationsByMonth as Array<Record<string, unknown>>) {
  console.log(`  ${m.month}  ${String(m.realizations).padStart(5)}  ${String(m.returns).padStart(4)}  ${uah(n(m.net)).padStart(14)}  ${String(m.clients).padStart(5)}`);
}
console.log("\nСтатуси реалізацій з 1С за роками");
console.table(report.realizationStatusByYear);
console.log("Документи без контрагента / торгового за роками");
console.table(report.docsMissingLinksByYear);
console.log("Розбіжності зіставлення");
console.table(report.unmatchedDiscrepancies);

console.log("Оборот 2026 по торгових (нетто, ₴)");
const revRows = report.revenueByRepMonth2026 as Array<{ rep: string; month: string; net: number }>;
const months = [...new Set(revRows.map((r) => r.month))].sort();
const reps = [...new Set(revRows.map((r) => r.rep))].sort();
console.log(`  ${"торговий".padEnd(28)}${months.map((m) => m.slice(2).padStart(12)).join("")}`);
for (const rep of reps) {
  const cells = months.map((m) => uah(revRows.find((r) => r.rep === rep && r.month === m)?.net ?? 0).padStart(12));
  console.log(`  ${rep.slice(0, 28).padEnd(28)}${cells.join("")}`);
}

console.log(`\nЗнімок: ${path}`);
console.log("READ ONLY: nothing was written to the database.");
await prisma.$disconnect();
