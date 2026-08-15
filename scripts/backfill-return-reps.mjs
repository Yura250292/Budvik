/**
 * Проставляє торгового поверненням, які прийшли з 1С без нього.
 *
 * Навіщо: у документі ВозвратТоваровОтПокупателя менеджер заповнений не
 * завжди — 1443 з 2566 повернень (1,88 млн грн) прийшли з порожнім
 * Менеджером, здебільшого стара історія 2023–2024. Оборот рахується нетто
 * (RETURN лежить від'ємним і SUM віднімає його сам), але повернення без
 * торгового не віднімається НІ ВІД КОГО: воно просто випадає з КПІ, і
 * оборот того, хто продав, лишається завищеним на його частку.
 *
 * Обмін ідемпотентний за externalId і вже прийняті документи повторно не
 * чіпає, тому історію треба виправити окремо — цим скриптом.
 *
 * Логіка визначення торгового — та сама, що в apply-payments.ts (allocate):
 * SalesRepClient → торговий з останнього документа клієнта, реалізації
 * пріоритетніші. Інакше з'явилося б друге місце з власними правилами.
 *
 * ВАЖЛИВО: на відміну від backfill-payment-allocations.mjs, тут у пошуку
 * «останнього документа» стоїть AND sd."docType" <> 'RETURN'. Повернення не
 * визначає, чий це клієнт (те саме правило, що в money-facts.ts): без цієї
 * умови одне безхазяйне повернення отримувало б торгового з іншого
 * безхазяйного повернення, і помилка розповзалася б ланцюжком.
 *
 * Скрипт НЕ чіпає totalAmount, знаки й дебіторку — тільки salesRepId там,
 * де він порожній.
 *
 * Запуск (спершу без --apply):
 *   node --env-file=.env scripts/backfill-return-reps.mjs
 *   node --env-file=.env scripts/backfill-return-reps.mjs --apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const money = (n) => Number(n ?? 0).toLocaleString("uk-UA", { maximumFractionDigits: 2 });

// Повернення без торгового + кандидат, якого дає клієнт.
// Сума в базі від'ємна — розвертаємо, щоб у звіті були додатні числа.
const rows = await prisma.$queryRaw`
  SELECT r.id,
         r.number,
         r."createdAt",
         (-r."totalAmount")::float8 AS amount,
         r."counterpartyId",
         c.name AS client_name,
         COALESCE(rc."salesRepId", d."salesRepId") AS "salesRepId",
         CASE WHEN rc."salesRepId" IS NOT NULL THEN 'CLIENT' ELSE 'CLIENT_DOC' END AS source,
         u.name AS rep_name
  FROM "SalesDocument" r
  LEFT JOIN "Counterparty" c ON c.id = r."counterpartyId"
  LEFT JOIN LATERAL (
    -- Закріплення за торговим. orderBy обов'язковий: клієнт може бути
    -- закріплений за кількома, і без сортування Postgres віддає довільного.
    SELECT src."salesRepId"
    FROM "SalesRepClient" src
    WHERE src."counterpartyId" = r."counterpartyId"
    ORDER BY src.id
    LIMIT 1
  ) rc ON TRUE
  LEFT JOIN LATERAL (
    -- Торговий з останнього документа клієнта. Реалізація пріоритетніша за
    -- замовлення — той самий пріоритет, що в receivableRowsByRep.
    -- Повернення виключені: див. коментар у шапці файлу.
    SELECT sd."salesRepId"
    FROM "SalesDocument" sd
    WHERE sd."counterpartyId" = r."counterpartyId"
      AND sd."salesRepId" IS NOT NULL
      AND sd."docType" <> 'RETURN'
    ORDER BY (sd."docType" = 'REALIZATION') DESC, sd."createdAt" DESC
    LIMIT 1
  ) d ON TRUE
  LEFT JOIN "User" u ON u.id = COALESCE(rc."salesRepId", d."salesRepId")
  WHERE r."docType" = 'RETURN'
    AND r.status = 'CONFIRMED'
    AND r."externalId" IS NOT NULL
    AND r."salesRepId" IS NULL
  ORDER BY r."createdAt" DESC`;

const resolvable = rows.filter((r) => r.salesRepId);
const noClient = rows.filter((r) => !r.counterpartyId).length;
const orphans = rows.length - resolvable.length;

const sum = (list) => list.reduce((s, r) => s + r.amount, 0);

console.log(`Повернень без торгового: ${rows.length} на ${money(sum(rows))} грн`);
console.log(`  можна визначити торгового: ${resolvable.length} на ${money(sum(resolvable))} грн`);
console.log(`  лишаться без торгового:    ${orphans} (з них ${noClient} взагалі без клієнта)`);

const byYear = new Map();
for (const r of resolvable) {
  const yr = new Date(r.createdAt).getUTCFullYear();
  const cur = byYear.get(yr) ?? { cnt: 0, sum: 0 };
  byYear.set(yr, { cnt: cur.cnt + 1, sum: cur.sum + r.amount });
}
console.log("\n=== По роках ===");
for (const [yr, v] of [...byYear.entries()].sort()) {
  console.log(`  ${yr}  ${String(v.cnt).padStart(5)} шт  ${money(v.sum).padStart(14)} грн`);
}

const byRep = new Map();
const bySource = new Map();
for (const r of resolvable) {
  const name = r.rep_name ?? r.salesRepId;
  const cur = byRep.get(name) ?? { cnt: 0, sum: 0 };
  byRep.set(name, { cnt: cur.cnt + 1, sum: cur.sum + r.amount });
  bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
}

console.log("\n=== Кому зарахуються повернення (зменшить їхній оборот) ===");
for (const [name, v] of [...byRep.entries()].sort((a, b) => b[1].sum - a[1].sum)) {
  console.log(`  ${String(name).padEnd(28)} ${String(v.cnt).padStart(5)} шт  ${money(v.sum).padStart(14)} грн`);
}
console.log("\nЗвідки взято торгового:");
for (const [src, cnt] of bySource) console.log(`  ${src.padEnd(12)} ${cnt}`);

if (!apply) {
  console.log("\nЦе пробний прогін. Нічого не змінено. Повторіть з --apply.");
  await prisma.$disconnect();
  process.exit(0);
}

// Оновлюємо по одному полю й лише там, де воно порожнє: умова salesRepId IS
// NULL продубльована в updateMany навмисно — якщо між пробним прогоном і
// --apply обмін встиг проставити торгового сам, ми його не перезапишемо.
const BATCH = 500;
let done = 0;
for (let i = 0; i < resolvable.length; i += BATCH) {
  const chunk = resolvable.slice(i, i + BATCH);
  const byRepId = new Map();
  for (const r of chunk) {
    const list = byRepId.get(r.salesRepId) ?? [];
    list.push(r.id);
    byRepId.set(r.salesRepId, list);
  }
  for (const [repId, ids] of byRepId) {
    await prisma.salesDocument.updateMany({
      where: { id: { in: ids }, salesRepId: null },
      data: { salesRepId: repId },
    });
  }
  done += chunk.length;
  console.log(`  оброблено ${done}/${resolvable.length}`);
}

console.log(`\n✓ Проставлено торгового ${done} поверненням.`);
console.log("Перевірте оборот торгових за 2026 рік: він має зменшитись на їхню частку повернень.");

await prisma.$disconnect();
