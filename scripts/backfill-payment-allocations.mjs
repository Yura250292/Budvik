/**
 * Рознесення вже прийнятих оплат на торгових.
 *
 * Навіщо: allocate() визначав торгового лише через документ оплати (ПКО його
 * не несе) або через закріплення SalesRepClient (заповнюється вручну і на
 * практиці порожнє). У результаті всі оплати з 1С лягли без рознесення —
 * гроші приходили, борг зменшувався, а «скільки зібрано» в мотивації
 * лишалося нулем.
 *
 * apply-payments тепер має третій шлях — торговий з останнього документа
 * клієнта. Але обмін ідемпотентний за externalId і вже прийняті оплати
 * повторно не обробляє, тому історію треба рознести окремо — цим скриптом.
 *
 * Логіка визначення торгового ідентична до apply-payments.ts (шлях
 * CLIENT_DOC), інакше історія і майбутні оплати розійшлися б.
 *
 * Запуск (спершу без --apply):
 *   node --env-file=.env scripts/backfill-payment-allocations.mjs
 *   node --env-file=.env scripts/backfill-payment-allocations.mjs --apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const money = (n) => Number(n ?? 0).toLocaleString("uk-UA", { maximumFractionDigits: 2 });

// Оплати без жодної алокації + торговий, якого дає останній документ клієнта.
const rows = await prisma.$queryRaw`
  SELECT p.id, p.amount, p."paidAt", d."salesRepId", u.name AS rep_name
  FROM "Payment" p
  JOIN "Invoice" i ON i.id = p."invoiceId"
  LEFT JOIN LATERAL (
    SELECT sd."salesRepId"
    FROM "SalesDocument" sd
    WHERE sd."counterpartyId" = i."counterpartyId"
      AND sd."salesRepId" IS NOT NULL
    ORDER BY (sd."docType" = 'REALIZATION') DESC, sd."createdAt" DESC
    LIMIT 1
  ) d ON true
  LEFT JOIN "User" u ON u.id = d."salesRepId"
  WHERE NOT EXISTS (SELECT 1 FROM "PaymentAllocation" a WHERE a."paymentId" = p.id)
  ORDER BY p."paidAt" DESC`;

const resolvable = rows.filter((r) => r.salesRepId);
const orphans = rows.length - resolvable.length;

console.log(`Оплат без рознесення: ${rows.length}`);
console.log(`  можна віднести на торгового: ${resolvable.length}`);
console.log(`  лишаться нерознесеними:      ${orphans} (у клієнта немає жодного документа з торговим)`);

const byRep = new Map();
for (const r of resolvable) {
  const name = r.rep_name ?? r.salesRepId;
  const cur = byRep.get(name) ?? { cnt: 0, sum: 0 };
  byRep.set(name, { cnt: cur.cnt + 1, sum: cur.sum + r.amount });
}

console.log("\n=== Буде зараховано по торгових ===");
for (const [name, v] of [...byRep.entries()].sort((a, b) => b[1].sum - a[1].sum)) {
  console.log(`  ${name.padEnd(28)} ${String(v.cnt).padStart(5)} шт  ${money(v.sum).padStart(14)} грн`);
}

if (!apply) {
  console.log("\nЦе пробний прогін. Нічого не змінено. Повторіть з --apply.");
  await prisma.$disconnect();
  process.exit(0);
}

// profitAmount лишається 0: ПКО не несе посилання на реалізацію, тож частку
// маржі в цій оплаті визначити нізвідки. Те саме робить і apply-payments.
const BATCH = 500;
let done = 0;
for (let i = 0; i < resolvable.length; i += BATCH) {
  const chunk = resolvable.slice(i, i + BATCH);
  await prisma.paymentAllocation.createMany({
    data: chunk.map((r) => ({
      paymentId: r.id,
      repId: r.salesRepId,
      amount: r.amount,
      profitAmount: 0,
      brandId: null,
      source: "CLIENT_DOC",
    })),
    skipDuplicates: true,
  });
  done += chunk.length;
  console.log(`  рознесено ${done}/${resolvable.length}`);
}

console.log(`\n✓ Рознесено ${done} оплат.`);

await prisma.$disconnect();
