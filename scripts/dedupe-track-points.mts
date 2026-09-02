/**
 * Прибирає дублі точок треку — наслідок перевідправки завислої пачки.
 *
 * Звідки взялися. 01.09 у застосунок додано запобіжник: якщо відправка
 * стоїть понад п'ять хвилин, замок забирає наступна спроба й шле пачку
 * наново. Це врятувало дні маршрутів, але має ціну: перша спроба не мертва, а
 * ЗАВИСЛА, і коли вона врешті доходить, ті самі точки лягають удруге. Сервер
 * від цього не захищений — дедуп у preparePoints порівнює час із останньою
 * записаною точкою, а дві однакові пачки читають хвіст ОДНОЧАСНО й обидві
 * бачать його чистим.
 *
 * Дубль — це рядок із тим самим `recordedAt` у тій самій сесії. Іншим він
 * бути не може: на планшеті `recordedAt` — первинний ключ буфера, тож двох
 * різних точок з однаковим часом там не існує.
 *
 * Лишаємо найстарший рядок кожної групи (менший id) — той, що приїхав
 * першим. Пробіг від видалення не змінюється: відстань між однаковими
 * координатами нульова, тож `metersFromPrev` у копій і так нуль.
 *
 * Після цього скрипта ставиться унікальний індекс, і повтор стає фізично
 * неможливим — тобто запускати його вдруге не доведеться.
 *
 * Запуск:
 *   npx tsx scripts/dedupe-track-points.mts           # лише показати
 *   npx tsx scripts/dedupe-track-points.mts --apply   # видалити
 */

import { prisma } from "../src/lib/prisma";

type Group = { sessionId: string; recordedAt: Date; c: bigint };

async function main() {
  const apply = process.argv.includes("--apply");

  const groups = await prisma.$queryRaw<Group[]>`
    SELECT "sessionId", "recordedAt", count(*) AS c
    FROM "TrackPoint"
    GROUP BY 1, 2
    HAVING count(*) > 1
    ORDER BY "recordedAt"
  `;

  const extra = groups.reduce((sum, g) => sum + (Number(g.c) - 1), 0);
  const total = await prisma.trackPoint.count();

  console.log(`Усього точок:        ${total}`);
  console.log(`Груп із дублями:     ${groups.length}`);
  console.log(`Зайвих рядків:       ${extra}`);

  if (groups.length > 0) {
    const first = groups[0]!.recordedAt;
    const last = groups[groups.length - 1]!.recordedAt;
    console.log(`Період:              ${first.toISOString()} — ${last.toISOString()}`);
  }

  if (!apply) {
    console.log("\nСухий прогін. Повторіть із --apply, щоб видалити.");
    return;
  }

  const deleted = await prisma.$executeRaw`
    DELETE FROM "TrackPoint" a
    USING "TrackPoint" b
    WHERE a."sessionId" = b."sessionId"
      AND a."recordedAt" = b."recordedAt"
      AND a.id > b.id
  `;

  const left = await prisma.trackPoint.count();
  console.log(`\nВидалено:            ${deleted}`);
  console.log(`Лишилось точок:      ${left}`);

  const check = await prisma.$queryRaw<Group[]>`
    SELECT "sessionId", "recordedAt", count(*) AS c
    FROM "TrackPoint" GROUP BY 1, 2 HAVING count(*) > 1
  `;
  console.log(check.length === 0 ? "Дублів не лишилось ✓" : `УВАГА: лишилось груп ${check.length}`);
}

main()
  .catch((e) => {
    console.error("ПАДІННЯ:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
