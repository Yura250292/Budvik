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

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got)}`);
  if (!ok) fails.push(name);
}

const res = await planCandidates();
console.log(`кандидатів: ${res.points.length}, без піна: ${res.noPin.length}, поза зоною: ${res.outOfZone.length}`);

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

// Жоден кандидат не має вже лежати в листі 1С або в маршруті сайту.
const ids = res.points.map((p) => p.salesDocumentId);
if (ids.length) {
  const inSheet = await prisma.routeSheetStop.count({ where: { salesDocumentId: { in: ids }, hidden: false } });
  const inRoute = await prisma.deliveryStop.count({ where: { salesDocumentId: { in: ids } } });
  check("жоден не в листі 1С", inSheet === 0, inSheet);
  check("жоден не в маршруті сайту", inRoute === 0, inRoute);
}

// Дублів документів бути не може: один документ — одна точка.
check("без дублів", new Set(ids).size === ids.length, `${new Set(ids).size} / ${ids.length}`);

await prisma.$disconnect();

if (fails.length) {
  console.error(`\nне зійшлося: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("\nвибірка кандидатів чиста");
