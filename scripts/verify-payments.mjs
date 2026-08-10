/**
 * Перевірка оплат (ПКО з 1С) і того, що дебіторка на сайті — жива.
 * Лише читання: жодних INSERT/UPDATE/DDL.
 *
 * Запуск: node --env-file=.env scripts/verify-payments.mjs
 *
 * Що показує:
 *  1) скільки оплат прийшло за 30 днів і чи не завмер потік;
 *  2) чи рознесені оплати по торгових — саме з PaymentAllocation рахується
 *     мотивація, тож нерознесені гроші нікому не зараховані;
 *  3) чи цілі рахунки-контейнери, які створює обмін під кожен ПКО;
 *  4) свіжість балансів взаєморозрахунків: дебіторка на сайті — це знімок
 *     регістру 1С, і якщо він застряг, борг «не зменшується» саме тому;
 *  5) чи не залишилось сиріт після ручних правок.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DAYS = 30;
const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
const money = (n) => Number(n ?? 0).toLocaleString("uk-UA", { maximumFractionDigits: 2 });
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

// --- 1. Потік оплат ---------------------------------------------------------

const flow = await prisma.$queryRaw`
  SELECT source, method, count(*)::int AS cnt, sum(amount) AS total
  FROM "Payment"
  WHERE coalesce("paidAt", "createdAt") >= ${since}
  GROUP BY source, method
  ORDER BY total DESC NULLS LAST`;

console.log(`=== Оплати за ${DAYS} днів ===`);
if (flow.length === 0) {
  console.log("  ⚠️ жодної оплати — перевірте запит payments в агенті та алерти обміну");
} else {
  for (const r of flow) {
    console.log(`  ${r.source.padEnd(7)} ${(r.method ?? "—").padEnd(15)} ${String(r.cnt).padStart(5)} шт  ${money(r.total).padStart(14)} грн`);
  }
}

const last = await prisma.payment.findFirst({
  where: { source: "1C" },
  orderBy: [{ paidAt: "desc" }],
  select: { paidAt: true, notes: true, amount: true },
});
console.log(`  Остання оплата з 1С: ${day(last?.paidAt)} ${last?.notes ?? ""} ${last ? money(last.amount) + " грн" : ""}`);

// Пауза довша за добу для щоденного бізнесу означає, що ПКО перестали
// доїжджати — найчастіше через тихо впалий запит, а не через відсутність оплат.
if (last?.paidAt) {
  const hours = Math.round((Date.now() - new Date(last.paidAt).getTime()) / 36e5);
  console.log(hours > 48
    ? `  ⚠️ остання оплата ${hours} год тому — схоже, потік ПКО зупинився`
    : `  ✓ потік живий (${hours} год тому)`);
}

// --- 2. Рознесення по торгових ----------------------------------------------

const alloc = await prisma.$queryRaw`
  SELECT
    count(*)::int AS payments,
    count(*) FILTER (WHERE a.n IS NULL)::int AS unallocated,
    count(*) FILTER (WHERE a.n IS NOT NULL AND abs(a.total - p.amount) > 0.01)::int AS mismatched
  FROM "Payment" p
  LEFT JOIN (
    SELECT "paymentId", count(*)::int AS n, sum(amount) AS total
    FROM "PaymentAllocation" GROUP BY "paymentId"
  ) a ON a."paymentId" = p.id
  WHERE coalesce(p."paidAt", p."createdAt") >= ${since}`;

const a = alloc[0] ?? {};
console.log(`\n=== Рознесення по торгових (${DAYS} днів) ===`);
console.log(`  оплат: ${a.payments ?? 0}, без рознесення: ${a.unallocated ?? 0}, сума не збігається: ${a.mismatched ?? 0}`);
console.log(Number(a.mismatched ?? 0) > 0
  ? "  ⚠️ сума алокацій розійшлася з сумою оплати — гроші пораховані двічі або недораховані"
  : "  ✓ суми алокацій збігаються з оплатами");
if (Number(a.unallocated ?? 0) > 0) {
  console.log("  ℹ️ нерознесені — це клієнти без прив'язаного торгового; у мотивацію не потрапляють");
}

const byRep = await prisma.$queryRaw`
  SELECT u.name AS rep, count(*)::int AS cnt, sum(al.amount) AS total
  FROM "PaymentAllocation" al
  JOIN "Payment" p ON p.id = al."paymentId"
  JOIN "User" u ON u.id = al."repId"
  WHERE coalesce(p."paidAt", p."createdAt") >= ${since}
  GROUP BY u.name ORDER BY total DESC`;
if (byRep.length) {
  console.log("  Зібрано по торгових:");
  for (const r of byRep) console.log(`    ${r.rep.padEnd(24)} ${String(r.cnt).padStart(4)} шт  ${money(r.total).padStart(14)} грн`);
}

// --- 3. Рахунки-контейнери --------------------------------------------------
//
// Обмін створює під ПКО мінімальний рахунок і одразу закриває його. Якщо він
// лишився неоплаченим, значить apply-payments відпрацював частково.

const containers = await prisma.$queryRaw`
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE abs("paidAmount" - "totalAmount") > 0.01)::int AS unbalanced,
         count(*) FILTER (WHERE "paymentStatus" <> 'PAID')::int AS not_paid
  FROM "Invoice" WHERE number LIKE '1C-%'`;
const c = containers[0] ?? {};
console.log(`\n=== Рахунки-контейнери 1C-* ===`);
console.log(`  усього: ${c.total ?? 0}, незбалансованих: ${c.unbalanced ?? 0}, не PAID: ${c.not_paid ?? 0}`);
console.log(Number(c.unbalanced ?? 0) === 0 && Number(c.not_paid ?? 0) === 0
  ? "  ✓ контейнери цілі"
  : "  ⚠️ є контейнери з розбіжністю — дивіться apply-payments");

// --- 4. Свіжість дебіторки --------------------------------------------------

const debt = await prisma.$queryRaw`
  SELECT count(*) FILTER (WHERE "receivableBalance" > 0.01)::int AS debtors,
         sum("receivableBalance") FILTER (WHERE "receivableBalance" > 0.01) AS total,
         max("balanceSyncedAt") AS synced
  FROM "Counterparty"`;
const d = debt[0] ?? {};
console.log(`\n=== Дебіторка (знімок регістру 1С) ===`);
console.log(`  боржників: ${d.debtors ?? 0}, разом: ${money(d.total)} грн`);
console.log(`  останнє оновлення балансів: ${d.synced ? new Date(d.synced).toLocaleString("uk-UA") : "—"}`);
if (d.synced) {
  const hours = Math.round((Date.now() - new Date(d.synced).getTime()) / 36e5);
  console.log(hours > 24
    ? `  ⚠️ баланси не оновлювались ${hours} год — борг на сайті застиг і не зменшиться після ПКО`
    : `  ✓ баланси свіжі (${hours} год тому)`);
}

const snap = await prisma.debtSnapshot.aggregate({ _max: { day: true }, _count: true });
console.log(`  знімків DebtSnapshot: ${snap._count}, останній день: ${day(snap._max.day)}`);

const top = await prisma.counterparty.findMany({
  where: { receivableBalance: { gt: 0.01 } },
  select: { name: true, receivableBalance: true },
  orderBy: { receivableBalance: "desc" },
  take: 10,
});
console.log("  Топ-10 боржників:");
for (const t of top) console.log(`    ${t.name.slice(0, 40).padEnd(42)} ${money(t.receivableBalance).padStart(14)} грн`);

// --- 5. Сироти --------------------------------------------------------------

const orphans = await prisma.$queryRaw`
  SELECT count(*)::int AS n
  FROM "Payment" p
  JOIN "Invoice" i ON i.id = p."invoiceId"
  JOIN "Counterparty" cp ON cp.id = i."counterpartyId"
  WHERE p.source = '1C' AND cp."externalId" IS NULL`;
console.log(`\n=== Цілісність ===`);
console.log(Number(orphans[0]?.n ?? 0) === 0
  ? "  ✓ усі оплати з 1С прив'язані до контрагентів з externalId"
  : `  ⚠️ ${orphans[0].n} оплат з 1С висять на контрагентах без externalId`);

const noExternal = await prisma.payment.count({ where: { source: "1C", externalId: null } });
console.log(noExternal === 0
  ? "  ✓ усі оплати з 1С мають externalId (ідемпотентність збережена)"
  : `  ⚠️ ${noExternal} оплат з 1С без externalId — повторний обмін їх задублює`);

// profitAmount по зібраному поки завжди 0: ПКО не несе посилання на
// реалізацію, тож алокація йде шляхом CLIENT. Друкуємо як факт, не як помилку.
const withProfit = await prisma.paymentAllocation.count({ where: { profitAmount: { gt: 0 } } });
console.log(`  алокацій з ненульовим profitAmount: ${withProfit}` +
  (withProfit === 0 ? "  (очікувано, доки ПКО не віддає посилання на реалізацію)" : ""));

await prisma.$disconnect();
