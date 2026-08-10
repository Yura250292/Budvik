/**
 * Пропонує закріплення клієнтів за торговими на основі документів.
 *
 * Навіщо: `SalesRepClient` майже порожня (2 записи), тож оплата зараз
 * зараховується торговому з останнього документа клієнта. Для більшості це
 * правильно, але там, де клієнта ведуть кілька торгових, вибір фактично
 * випадковий — а це 8,9 млн грн, майже 60% усіх оплат.
 *
 * Закріплення робить зв'язок явним: воно має пріоритет над документами і в
 * рознесенні оплат, і в аналітиці, тож більше не залежить від того, хто
 * останнім виписав накладну.
 *
 * Скрипт ділить клієнтів на чотири групи:
 *   ОДНОЗНАЧНІ — усі документи на одного торгового;
 *   ПЕРЕДАНІ   — раніше було кілька, але зараз працює один: клієнта
 *                передали, закріплюємо на теперішнього;
 *   З ЛІДЕРОМ  — кілька активних, але один робить переважну більшість
 *                документів. Це не спільне ведення, а підміна на час
 *                відпустки; закріплюємо на основного;
 *   СПІРНІ     — жоден не домінує. НЕ чіпаємо: рішення за керівником.
 *                Для них друкуємо розклад, щоб було на чому вирішувати.
 *
 * Запуск (спершу без --apply):
 *   node --env-file=.env scripts/suggest-client-assignments.mjs
 *   node --env-file=.env scripts/suggest-client-assignments.mjs --apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const money = (n) => Number(n ?? 0).toLocaleString("uk-UA", { maximumFractionDigits: 0 });

// Вікно «теперішнього» торгового. 60 днів — приблизно два цикли об'їзду:
// достатньо, щоб побачити, хто веде клієнта зараз, і не зачепити того, хто
// возив його пів року тому.
const RECENT_DAYS = 60;

// Частка документів, з якої торговий вважається основним для клієнта.
// 70% відділяє «його клієнт, іншого разу підмінили» від справжнього
// спільного ведення: на цій базі так вирішується 52 випадки з 70.
const DOMINANCE = 0.7;

const rows = await prisma.$queryRaw`
  WITH doc_reps AS (
    SELECT c.id, c.name,
           sd."salesRepId" AS rep_id,
           u.name AS rep_name,
           count(*)::int AS docs,
           max(sd."createdAt") AS last_doc,
           count(*) FILTER (WHERE sd."createdAt" > now() - (${RECENT_DAYS} || ' days')::interval)::int AS recent_docs
    FROM "Counterparty" c
    JOIN "SalesDocument" sd ON sd."counterpartyId" = c.id AND sd."salesRepId" IS NOT NULL
    JOIN "User" u ON u.id = sd."salesRepId"
    GROUP BY c.id, c.name, sd."salesRepId", u.name
  )
  SELECT dr.*,
         coalesce(pa.paid, 0) AS client_paid,
         EXISTS (SELECT 1 FROM "SalesRepClient" s WHERE s."counterpartyId" = dr.id) AS already
  FROM doc_reps dr
  LEFT JOIN LATERAL (
    SELECT sum(pay.amount) AS paid
    FROM "Invoice" i JOIN "Payment" pay ON pay."invoiceId" = i.id
    WHERE i."counterpartyId" = dr.id AND pay.source = '1C'
  ) pa ON true
  ORDER BY dr.name`;

// Групуємо по клієнту
const clients = new Map();
for (const r of rows) {
  if (!clients.has(r.id)) {
    clients.set(r.id, { id: r.id, name: r.name, paid: Number(r.client_paid), already: r.already, reps: [] });
  }
  clients.get(r.id).reps.push({
    repId: r.rep_id, repName: r.rep_name,
    docs: r.docs, recent: r.recent_docs, lastDoc: r.last_doc,
  });
}

const unambiguous = [];
const handed = [];
const dominant = [];
const shared = [];

for (const c of clients.values()) {
  if (c.already) continue;

  if (c.reps.length === 1) {
    unambiguous.push({ ...c, pick: c.reps[0] });
    continue;
  }

  const active = c.reps.filter((r) => r.recent > 0);
  if (active.length === 1) {
    handed.push({ ...c, pick: active[0] });
  } else if (active.length === 0) {
    // Жодного свіжого документа — клієнт спить. Беремо останнього, хто з ним
    // працював: це найкраще з доступного, і воно не гірше за теперішню
    // евристику.
    const latest = [...c.reps].sort((a, b) => new Date(b.lastDoc) - new Date(a.lastDoc))[0];
    handed.push({ ...c, pick: latest, dormant: true });
  } else {
    // «Кілька активних» — здебільшого не спільне ведення, а основний
    // торговий плюс поодинокі підміни (відпустка, хтось підвіз замість
    // нього). Якщо лідер робить переважну більшість документів, це його
    // клієнт; решта — справді спірні.
    const total = active.reduce((s, r) => s + r.recent, 0);
    const leader = [...active].sort((a, b) => b.recent - a.recent)[0];
    if (total > 0 && leader.recent / total >= DOMINANCE) {
      dominant.push({ ...c, pick: leader, share: leader.recent / total, active });
    } else {
      shared.push({ ...c, active });
    }
  }
}

console.log(`Клієнтів з документами: ${clients.size}`);
console.log(`  однозначні (один торговий за всю історію):  ${unambiguous.length}`);
console.log(`  передані (кілька в історії, один активний): ${handed.length}`);
console.log(`  з явним основним (лідер ≥${Math.round(DOMINANCE * 100)}% документів):   ${dominant.length}`);
console.log(`  СПІРНІ (без явного лідера):                 ${shared.length}`);

const autoMoney = [...unambiguous, ...handed, ...dominant].reduce((s, c) => s + c.paid, 0);
const sharedMoney = shared.reduce((s, c) => s + c.paid, 0);
console.log(`\nОплат у клієнтів, яких закріпимо: ${money(autoMoney)} грн`);
console.log(`Оплат у спірних (лишаться на евристиці): ${money(sharedMoney)} грн`);

if (dominant.length) {
  console.log(`\n=== З явним основним торговим — закріплюємо на нього (топ-10) ===`);
  for (const c of [...dominant].sort((a, b) => b.paid - a.paid).slice(0, 10)) {
    const others = c.active.filter((r) => r.repId !== c.pick.repId)
      .map((r) => `${r.repName} ${r.recent}`).join(", ");
    console.log(`${money(c.paid).padStart(10)} грн  ${c.name.slice(0, 32).padEnd(34)} → ${c.pick.repName} (${Math.round(c.share * 100)}%, решта: ${others})`);
  }
  if (dominant.length > 10) console.log(`… ще ${dominant.length - 10}`);
}

if (shared.length) {
  console.log(`\n=== СПІРНІ — потрібне ваше рішення (топ-15 за оплатами) ===`);
  console.log("Закріпити їх можна в адмінці на сторінці торгового.\n");
  for (const c of [...shared].sort((a, b) => b.paid - a.paid).slice(0, 15)) {
    const who = c.active
      .sort((a, b) => b.recent - a.recent)
      .map((r) => `${r.repName} (${r.recent} док. за ${RECENT_DAYS} дн.)`)
      .join("  vs  ");
    console.log(`${money(c.paid).padStart(10)} грн  ${c.name.slice(0, 34).padEnd(36)}`);
    console.log(`${" ".repeat(16)}${who}`);
  }
  if (shared.length > 15) console.log(`\n… ще ${shared.length - 15} спірних`);
}

if (!apply) {
  console.log("\nЦе пробний прогін. Нічого не змінено. Повторіть з --apply.");
  console.log("Спірні не закріплюються ні в якому разі — лише вручну.");
  await prisma.$disconnect();
  process.exit(0);
}

const toCreate = [...unambiguous, ...handed, ...dominant].map((c) => ({
  salesRepId: c.pick.repId,
  counterpartyId: c.id,
}));

await prisma.salesRepClient.createMany({ data: toCreate, skipDuplicates: true });

console.log(`\n✓ Закріплено ${toCreate.length} клієнтів.`);
console.log(`Спірні (${shared.length}) не чіпали — закріпіть їх вручну після рішення.`);
console.log("Нові оплати підуть шляхом CLIENT; уже рознесені лишаються як були.");

await prisma.$disconnect();
