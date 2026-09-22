/**
 * Перевірка бекфілу реалізацій 2024-2025: чи приїхало і чи цим можна
 * користуватися.
 *
 * READ ONLY. Усі запити - SELECT у READ ONLY-транзакції; база сама
 * відхилить будь-який запис. Nothing is written to the database.
 *
 *   npx tsx --env-file=.env scripts/check-backfill-2024.mts
 *
 * Відповідає на чотири питання, і саме в такому порядку:
 *   1. Чи не зсунувся 2026 рік (бекфіл лише ДОПИСУЄ історію).
 *   2. Скільки приїхало по роках і чи немає провалених місяців.
 *   3. Чи є чим групувати товар (без typeKey сезонність рахувати нема на чому).
 *   4. Який вийшов сезонний профіль і чи схожі роки між собою.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { kyivTsSql } from "../src/lib/date/kyiv";

const uah = (n: number) => Math.round(n).toLocaleString("uk-UA").replace(/ /g, " ");
const MON = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

/** Той самий фільтр, що й у решті аналітики, але БЕЗ нижньої межі. */
const SOURCE = Prisma.sql`s."externalId" IS NOT NULL AND s.status = 'CONFIRMED' AND s."docType" IN ('REALIZATION','RETURN')`;
const TS = Prisma.raw(kyivTsSql('s."createdAt"'));

await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;

  // ── 1. Глибина історії ────────────────────────────────────────────
  const span = await tx.$queryRaw<Array<{ doctype: string; docs: bigint; from: Date; to: Date }>>`
    SELECT s."docType" AS doctype, count(*) AS docs,
           min(s."createdAt") AS from, max(s."createdAt") AS to
    FROM "SalesDocument" s WHERE s."externalId" IS NOT NULL
    GROUP BY 1 ORDER BY 1`;
  console.log("\n=== Глибина історії ===");
  console.table(
    span.map((r) => ({
      тип: r.doctype,
      документів: Number(r.docs),
      з: r.from.toISOString().slice(0, 10),
      по: r.to.toISOString().slice(0, 10),
    }))
  );

  // ── 2. Реалізації по роках і місяцях ──────────────────────────────
  const byMonth = await tx.$queryRaw<Array<{ y: number; m: number; docs: bigint; amount: number; lines: bigint }>>`
    SELECT EXTRACT(YEAR FROM ${TS})::int AS y, EXTRACT(MONTH FROM ${TS})::int AS m,
           count(DISTINCT s.id) AS docs,
           COALESCE(sum(i.quantity * i."sellingPrice"), 0)::float AS amount,
           count(i.id) AS lines
    FROM "SalesDocument" s
    LEFT JOIN "SalesDocumentItem" i ON i."salesDocumentId" = s.id
    WHERE ${SOURCE} AND s."docType" = 'REALIZATION'
    GROUP BY 1, 2 ORDER BY 1, 2`;

  const years = [...new Set(byMonth.map((r) => r.y))].sort();
  console.log("\n=== Реалізації по місяцях (документів / рядків) ===");
  const grid: Record<string, Record<string, string>> = {};
  for (const y of years) {
    grid[String(y)] = {};
    for (let m = 1; m <= 12; m++) {
      const row = byMonth.find((r) => r.y === y && r.m === m);
      grid[String(y)][MON[m - 1]] = row ? `${Number(row.docs)} / ${Number(row.lines)}` : "—";
    }
  }
  console.table(grid);

  console.log("\n=== Підсумок по роках ===");
  console.table(
    years.map((y) => {
      const rows = byMonth.filter((r) => r.y === y);
      const docs = rows.reduce((s, r) => s + Number(r.docs), 0);
      const lines = rows.reduce((s, r) => s + Number(r.lines), 0);
      const amount = rows.reduce((s, r) => s + r.amount, 0);
      const months = rows.filter((r) => Number(r.docs) > 0).length;
      const med = [...rows.map((r) => Number(r.docs))].sort((a, b) => a - b)[Math.floor(rows.length / 2)] || 0;
      const weak = rows.filter((r) => Number(r.docs) < med * 0.2).map((r) => MON[r.m - 1]);
      return {
        рік: y,
        документів: docs,
        рядків: lines,
        "сума, ₴": uah(amount),
        "місяців з продажами": `${months} з 12`,
        "провалені місяці": weak.length ? weak.join(", ") : "немає",
      };
    })
  );

  // ── 3. Чи є чим групувати ─────────────────────────────────────────
  const cover = await tx.$queryRaw<Array<{ y: number; lines: bigint; withprod: bigint; withtype: bigint; withsec: bigint; withbrand: bigint }>>`
    SELECT EXTRACT(YEAR FROM ${TS})::int AS y,
           count(*) AS lines,
           count(p.id) AS withprod,
           count(p."typeKey") AS withtype,
           count(p."sectionId") AS withsec,
           count(p."brandId") AS withbrand
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    LEFT JOIN "Product" p ON p.id = i."productId"
    WHERE ${SOURCE} AND s."docType" = 'REALIZATION'
    GROUP BY 1 ORDER BY 1`;
  const pct = (a: bigint, b: bigint) => (Number(b) > 0 ? `${((Number(a) / Number(b)) * 100).toFixed(1)}%` : "—");
  console.log("\n=== Чи є чим групувати товар ===");
  console.table(
    cover.map((r) => ({
      рік: r.y,
      рядків: Number(r.lines),
      "товар зіставлено": pct(r.withprod, r.lines),
      "група (typeKey)": pct(r.withtype, r.lines),
      розділ: pct(r.withsec, r.lines),
      бренд: pct(r.withbrand, r.lines),
    }))
  );

  // ── 4. Документи без торгового й без клієнта ──────────────────────
  const orphans = await tx.$queryRaw<Array<{ y: number; docs: bigint; norep: bigint; noclient: bigint }>>`
    SELECT EXTRACT(YEAR FROM ${TS})::int AS y, count(*) AS docs,
           count(*) FILTER (WHERE s."salesRepId" IS NULL) AS norep,
           count(*) FILTER (WHERE s."counterpartyId" IS NULL) AS noclient
    FROM "SalesDocument" s WHERE ${SOURCE} AND s."docType" = 'REALIZATION'
    GROUP BY 1 ORDER BY 1`;
  console.log("\n=== Документи без прив'язки ===");
  console.table(
    orphans.map((r) => ({
      рік: r.y,
      документів: Number(r.docs),
      "без торгового": `${Number(r.norep)} (${pct(r.norep, r.docs)})`,
      "без клієнта": `${Number(r.noclient)} (${pct(r.noclient, r.docs)})`,
    }))
  );

  // ── 5. Сезонний профіль по фірмі ──────────────────────────────────
  const full = years.filter((y) => byMonth.filter((r) => r.y === y && Number(r.docs) > 0).length === 12);
  console.log(`\n=== Сезонний профіль (повні роки: ${full.join(", ") || "жодного"}) ===`);
  if (full.length === 0) {
    console.log("Повного року немає — сезонність рахувати ще нема на чому.");
  } else {
    const shares = full.map((y) => {
      const rows = Array.from({ length: 12 }, (_, m) => byMonth.find((r) => r.y === y && r.m === m + 1)?.amount ?? 0);
      const total = rows.reduce((a, b) => a + b, 0);
      return rows.map((v) => (total > 0 ? v / total : 0));
    });
    const avg = Array.from({ length: 12 }, (_, m) => shares.reduce((s, y) => s + y[m], 0) / shares.length);
    console.table(
      Array.from({ length: 12 }, (_, m) => {
        const row: Record<string, string> = { місяць: MON[m] };
        full.forEach((y, i) => (row[String(y)] = `×${(shares[i][m] * 12).toFixed(2)}`));
        row["разом"] = `×${(avg[m] * 12).toFixed(2)}`;
        return row;
      })
    );

    if (shares.length >= 2) {
      // Кореляція часток двох років — головний запобіжник проти разового
      // сплеску: те, що не повторилось, не є сезоном.
      const [a, b] = shares;
      const ma = a.reduce((x, y) => x + y, 0) / 12;
      const mb = b.reduce((x, y) => x + y, 0) / 12;
      const cov = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0);
      const va = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0));
      const vb = Math.sqrt(b.reduce((s, v) => s + (v - mb) ** 2, 0));
      const r = cov / (va * vb);
      console.log(`\nсхожість років між собою: ${r.toFixed(2)}`);
      console.log(
        r >= 0.5
          ? "  -> роки схожі, сезонному профілю можна вірити"
          : "  -> роки НЕ схожі: один із них нетиповий, профіль показувати лише із застереженням"
      );
    }
  }
});

console.log("\nREAD ONLY: nothing was written to the database.");
await prisma.$disconnect();
