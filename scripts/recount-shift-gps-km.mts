/**
 * Перераховує «за треком» у закритих змінах.
 *
 * `Shift.gpsDistanceKm` рахується один раз — у мить закриття зміни — і далі
 * лежить числом. Тому будь-яке пізніше прибирання треку його не чіпає: 03.09
 * Ігор закрив зміну о 17:58 з перуанськими точками в базі, і в картці лишилося
 * 23 817 км навіть тоді, коли карта вже показувала справжні 95.
 *
 * Числа беруться тією самою функцією, що й при закритті (gpsKmBetween), тож
 * розбіжність тут завжди означає одне: точки після закриття змінилися.
 *
 * Запуск:
 *   npx tsx scripts/recount-shift-gps-km.mts                  # сьогодні, показати
 *   npx tsx scripts/recount-shift-gps-km.mts 2026-09-03 --apply
 */

import { prisma } from "../src/lib/prisma";
import { gpsKmBetween } from "../src/lib/shift/late-close";
import { kyivDate, kyivDayStart } from "../src/lib/date/kyiv";

async function main() {
  const apply = process.argv.includes("--apply");
  const day = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? kyivDate(new Date());
  const from = kyivDayStart(day);
  const to = new Date(from.getTime() + 864e5);

  const shifts = await prisma.shift.findMany({
    where: { startedAt: { gte: from, lt: to }, gpsDistanceKm: { not: null } },
    orderBy: { startedAt: "asc" },
    select: {
      id: true, startedAt: true, endedAt: true, gpsDistanceKm: true, afterWorkKm: true,
      user: { select: { name: true } },
    },
  });

  let changed = 0;
  for (const shift of shifts) {
    const workKm = await gpsKmBetween(shift.id, shift.startedAt, shift.endedAt);
    const afterWorkKm = shift.endedAt ? await gpsKmBetween(shift.id, shift.endedAt, null) : null;
    if (workKm === shift.gpsDistanceKm) continue;

    changed++;
    console.log(`  ${shift.user.name ?? "?"}: ${shift.gpsDistanceKm} → ${workKm} км`);
    if (!apply) continue;
    await prisma.shift.update({
      where: { id: shift.id },
      data: { gpsDistanceKm: workKm, ...(shift.endedAt ? { afterWorkKm } : {}) },
    });
  }

  console.log(
    changed === 0
      ? `\n${day}: усі числа збігаються з точками.`
      : apply
        ? `\n${day}: оновлено ${changed}.`
        : `\n${day}: розійшлося ${changed}. Повторіть з --apply.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
