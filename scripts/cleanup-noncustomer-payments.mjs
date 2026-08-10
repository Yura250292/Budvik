/**
 * Прибирає з бази ПКО, які насправді не є оплатою покупця.
 *
 * Навіщо: до фільтра за видом операції запит тягнув УСІ проведені ПКО —
 * зокрема повернення від постачальника (там у «Контрагенті» постачальник) і
 * прийом роздрібної виручки. Вони осіли як Payment + PaymentAllocation і
 * завищують «скільки зібрано» та мотивацію торгових.
 *
 * Звуження запиту в агенті це НЕ виправляє: оплати вставляються upsert-ом за
 * externalId, а видалень для них обмін не відстежує. Тобто старі записи
 * лишаються назавжди, доки їх не прибрати руками — цим скриптом.
 *
 * Вхід: pko-customer-ids.txt від agent/ps/probe-pko-kinds.ps1 — Ref_Key усіх
 * ПКО, які фільтр визнає оплатою покупця. Усе інше з source="1C" — зайве.
 *
 * ВАЖЛИВО: файл має покривати ВЕСЬ період, за який в базі є оплати. Якщо
 * пробу запускали на 12 місяців, а оплати є за 18 — скрипт вважатиме старіші
 * записи зайвими і зітре живі гроші. Скрипт сам перевіряє цей розрив і
 * зупиняється.
 *
 * Запуск (спершу без --apply — покаже, що саме зникне):
 *   node --env-file=.env scripts/cleanup-noncustomer-payments.mjs agent/ps/pko-customer-ids.txt
 *   node --env-file=.env scripts/cleanup-noncustomer-payments.mjs agent/ps/pko-customer-ids.txt --apply
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const idsPath = args.find((a) => !a.startsWith("--"));

if (!idsPath) {
  console.error("Вкажіть шлях до pko-customer-ids.txt (див. agent/ps/probe-pko-kinds.ps1)");
  process.exit(1);
}

const money = (n) => Number(n ?? 0).toLocaleString("uk-UA", { maximumFractionDigits: 2 });
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

const keep = new Set(
  readFileSync(idsPath, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
);

console.log(`Прийнятих ПКО у файлі: ${keep.size}`);
if (keep.size === 0) {
  console.error("Файл порожній — проба не підтвердила жодного виду операції. Зупиняюсь.");
  process.exit(1);
}

// --- Захист від неповного файлу ---------------------------------------------
//
// Найдорожча помилка тут — вузьке вікно проби: усе, що старіше за нього,
// виглядає «не підтвердженим» і пішло б під видалення разом із живими грошима.

const oldestKept = await prisma.payment.findFirst({
  where: { source: "1C", externalId: { in: [...keep] } },
  orderBy: { paidAt: "asc" },
  select: { paidAt: true },
});
const oldestAny = await prisma.payment.findFirst({
  where: { source: "1C" },
  orderBy: { paidAt: "asc" },
  select: { paidAt: true },
});

console.log(`Найстаріша оплата в базі:        ${day(oldestAny?.paidAt)}`);
console.log(`Найстаріша підтверджена файлом:  ${day(oldestKept?.paidAt)}`);

if (oldestAny?.paidAt && oldestKept?.paidAt) {
  const gapDays = Math.round(
    (new Date(oldestKept.paidAt).getTime() - new Date(oldestAny.paidAt).getTime()) / 864e5
  );
  if (gapDays > 3) {
    console.error(
      `\n❌ Файл не покриває ${gapDays} днів найстарішої історії.\n` +
        `   Перезапустіть пробу з більшим -Months, інакше скрипт зітре живі оплати.`
    );
    process.exit(1);
  }
}

// --- Що піде під видалення ---------------------------------------------------

const doomed = await prisma.payment.findMany({
  where: { source: "1C", externalId: { notIn: [...keep] } },
  select: {
    id: true,
    externalId: true,
    amount: true,
    paidAt: true,
    notes: true,
    invoiceId: true,
    invoice: { select: { number: true, counterparty: { select: { name: true } } } },
    allocations: { select: { amount: true, rep: { select: { name: true } } } },
  },
  orderBy: { paidAt: "desc" },
});

if (doomed.length === 0) {
  console.log("\n✓ Зайвих ПКО немає — усі оплати з 1С підтверджені фільтром.");
  await prisma.$disconnect();
  process.exit(0);
}

const totalAmount = doomed.reduce((s, p) => s + p.amount, 0);
console.log(`\n=== Під видалення: ${doomed.length} оплат на ${money(totalAmount)} грн ===`);
for (const p of doomed.slice(0, 30)) {
  console.log(
    `  ${day(p.paidAt)}  ${money(p.amount).padStart(12)} грн  ${(p.invoice?.counterparty?.name ?? "?").slice(0, 32).padEnd(34)} ${p.notes ?? ""}`
  );
}
if (doomed.length > 30) console.log(`  … ще ${doomed.length - 30}`);

// Вплив на мотивацію показуємо окремо: саме ці суми торгові вже бачили
// у своїх «зібрано», і після чистки вони зменшаться.
const byRep = new Map();
for (const p of doomed) {
  for (const al of p.allocations) {
    const name = al.rep?.name ?? "(без торгового)";
    byRep.set(name, (byRep.get(name) ?? 0) + al.amount);
  }
}
if (byRep.size) {
  console.log("\n=== Вплив на «зібрано» по торгових ===");
  for (const [name, sum] of [...byRep.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(28)} −${money(sum)} грн`);
  }
}

if (!apply) {
  console.log("\nЦе пробний прогін. Нічого не змінено.");
  console.log("Перегляньте суми з адміністратором і запустіть повторно з --apply.");
  await prisma.$disconnect();
  process.exit(0);
}

// --- Видалення ---------------------------------------------------------------

const invoiceIds = [...new Set(doomed.map((p) => p.invoiceId))];

await prisma.$transaction(async (tx) => {
  // PaymentAllocation зникає каскадом за схемою.
  await tx.payment.deleteMany({ where: { id: { in: doomed.map((p) => p.id) } } });

  for (const invoiceId of invoiceIds) {
    const inv = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, number: true, totalAmount: true, payments: { select: { amount: true } } },
    });
    if (!inv) continue;

    // Контейнер, створений під видалену оплату, без оплат уже безглуздий.
    if (inv.payments.length === 0 && inv.number.startsWith("1C-")) {
      await tx.invoice.delete({ where: { id: inv.id } });
      continue;
    }

    const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        paidAmount: paid,
        paymentStatus:
          paid >= inv.totalAmount - 0.01 ? "PAID" : paid > 0.01 ? "PARTIAL" : "UNPAID",
      },
    });
  }
});

console.log(`\n✓ Видалено ${doomed.length} оплат на ${money(totalAmount)} грн, рахунки перераховано.`);
console.log("Дебіторка не змінюється: вона приходить із регістру 1С окремо від оплат.");

await prisma.$disconnect();
