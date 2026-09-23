/**
 * Кандидати на розвозку: що саме потрапить у план.
 *
 * Навіщо. Найдорожча помилка планувальника — не крива дорога, а зайвий або
 * загублений документ: повезти те, що клієнт уже забрав, або забути те, що
 * чекає тиждень. Тому вибірка перевіряється окремо від усієї решти.
 *
 *   npx tsx --env-file=.env scripts/check-plan-candidates.mts
 *
 * Лише читання бази.
 */

import { planCandidates, DELIVERY_BBOX } from "../src/lib/routes/plan-candidates";
import { prisma } from "../src/lib/prisma";
import { isInternalClient, loadInternalContext } from "../src/lib/rep-feed/internal";

const fails: string[] = [];
const skipped: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got)}`);
  if (!ok) fails.push(name);
}

const res = await planCandidates();
console.log(
  `кандидатів: ${res.points.length}, без піна: ${res.noPin.length}, ` +
    `поза зоною: ${res.outOfZone.length}, без контрагента: ${res.noCounterparty.length}`
);

check("щось знайшлося", res.points.length + res.noPin.length > 0, res.points.length + res.noPin.length);

check(
  "усі кандидати з координатами",
  res.points.every((p) => p.lat !== null && p.lng !== null),
  res.points.filter((p) => p.lat === null).length
);

check(
  "усі кандидати в зоні розвозки",
  res.points.every(
    (p) =>
      p.lat! >= DELIVERY_BBOX.latMin && p.lat! <= DELIVERY_BBOX.latMax &&
      p.lng! >= DELIVERY_BBOX.lngMin && p.lng! <= DELIVERY_BBOX.lngMax
  ),
  res.points.length
);

check(
  "у points завжди є counterpartyId",
  res.points.every((p) => p.counterpartyId !== ""),
  res.points.filter((p) => p.counterpartyId === "").length
);

// Центральне правило задачі: сюди мають потрапляти лише проведені реалізації,
// а не замовлення. Джерело істини — НЕ той самий SQL, що в модулі: окремий
// запит прямо по SalesDocument, щоб послаблений WHERE в модулі не пройшов
// повз цю перевірку непоміченим.
const allIds = [...res.points, ...res.noPin, ...res.outOfZone, ...res.noCounterparty].map((p) => p.salesDocumentId);
if (allIds.length) {
  const wrongDoc = await prisma.salesDocument.count({
    where: {
      id: { in: allIds },
      OR: [{ docType: { not: "REALIZATION" } }, { status: { not: "CONFIRMED" } }],
    },
  });
  check("усі кандидати — проведені REALIZATION", wrongDoc === 0, wrongDoc);
} else {
  console.log("skip перевірку docType/status — вибірка порожня");
  skipped.push("docType/status");
}

// Жоден кандидат не має вже лежати в листі 1С або в маршруті сайту.
//
// Порожня вибірка сама по собі не помилка (усе вже розвезли), тому на ній
// не падаємо — але й мовчати не можна: без явного skip нульова вибірка
// виглядала б як пройдена перевірка, хоча інваріант того прогону взагалі
// не перевірявся.
const ids = res.points.map((p) => p.salesDocumentId);
if (ids.length) {
  const inSheet = await prisma.routeSheetStop.count({ where: { salesDocumentId: { in: ids }, hidden: false } });
  const inRoute = await prisma.deliveryStop.count({ where: { salesDocumentId: { in: ids } } });
  check("жоден не в листі 1С", inSheet === 0, inSheet);
  check("жоден не в маршруті сайту", inRoute === 0, inRoute);
} else {
  console.log("skip перевірку анти-дублювання (лист 1С / маршрут сайту) — вибірка порожня");
  skipped.push("анти-дублювання");
}

// Дублів документів бути не може: один документ — одна точка.
check("без дублів", new Set(ids).size === ids.length, `${new Set(ids).size} / ${ids.length}`);

/*
 * Свої в план не потрапляють.
 *
 * Перший живий прогін 23.09.2026 поставив «Склад ( Дубляни)» другою, третьою
 * і четвертою точкою маршруту, а «Передрій Дмитро (співробітник)» — першою.
 * Перевірка сувора саме тому: у складу є і пін, і адреса, тож без відсіву він
 * виглядає як звичайний клієнт, і жоден інший рядок цього не зловить.
 */
const internalCtx = await loadInternalContext();
const leaked = res.points.filter((c) => isInternalClient({ id: c.counterpartyId, name: c.name }, internalCtx));
check("своїх у points немає", leaked.length === 0, leaked.length ? leaked.map((c) => c.name).join(", ") : 0);

check(
  "усі, хто в кошику internal, справді свої",
  res.internal.every((c) => isInternalClient({ id: c.counterpartyId, name: c.name }, internalCtx)),
  res.internal.length
);

/*
 * Жоден документ не зникає між кошиками.
 *
 * Кожна перевірка вище дивиться на свій кошик окремо, тож регрес типу
 * «LEFT JOIN знову став INNER» — саме той, через який документи без
 * контрагента колись зникали безслідно, — жодна з них не зловить: рядок
 * просто випаде з вибірки, і всі перевірки лишаться зеленими. Тому звіряємо
 * суму кошиків із незалежним підрахунком по тій самій умові.
 */
const total: Array<{ n: number }> = await prisma.$queryRawUnsafe(`
  SELECT count(*)::int AS n
  FROM "SalesDocument" d
  WHERE d."docType" = 'REALIZATION'
    AND d.status = 'CONFIRMED'
    AND d."createdAt" >= now() - interval '14 days'
    AND NOT EXISTS (SELECT 1 FROM "RouteSheetStop" s WHERE s."salesDocumentId" = d.id AND s.hidden = false)
    AND NOT EXISTS (SELECT 1 FROM "DeliveryStop" ds WHERE ds."salesDocumentId" = d.id)
`);
const inBaskets =
  res.points.length + res.noPin.length + res.outOfZone.length + res.internal.length + res.noCounterparty.length;
check(
  "сума кошиків дорівнює всім непривезеним реалізаціям",
  inBaskets === total[0].n,
  `${inBaskets} проти ${total[0].n}`
);

await prisma.$disconnect();

if (fails.length) {
  console.error(`\nне зійшлося: ${fails.join(", ")}`);
  process.exit(1);
}
console.log(
  skipped.length
    ? `\nвибірка кандидатів чиста (не перевірено: ${skipped.join(", ")} — вибірка була порожня)`
    : "\nвибірка кандидатів чиста"
);
