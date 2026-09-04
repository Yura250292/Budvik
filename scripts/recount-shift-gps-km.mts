/**
 * Перераховує «за треком» у закритих змінах.
 *
 * З 05.09.2026 пробіг — це ЛИШЕ їзда на довірених фіксах: тремтіння приймача
 * на стоянці (3-17 км за день) і ходьба в пробіг більше не йдуть. Тому на
 * старих змінах числа зміняться, і майже завжди вниз. Саме заради цього тут
 * бекап: у картках і в звітах офісу ці цифри вже бачили.
 *
 * Запуск:
 *   npx tsx scripts/recount-shift-gps-km.mts                     # сьогодні, показати
 *   npx tsx scripts/recount-shift-gps-km.mts 2026-09-03 --apply  # один день
 *   npx tsx scripts/recount-shift-gps-km.mts --days=30 --apply   # останні 30 днів
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { recountShiftTrack } from "../src/lib/shift/recount";
import { kyivDate, kyivDayStart } from "../src/lib/date/kyiv";

async function main() {
  const apply = process.argv.includes("--apply");
  const daysArg = process.argv.find((a) => a.startsWith("--days="));
  const day = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

  const range = daysArg
    ? { from: new Date(Date.now() - Number(daysArg.slice(7)) * 864e5), to: new Date(), label: `останні ${daysArg.slice(7)} днів` }
    : (() => {
        const d = day ?? kyivDate(new Date());
        const from = kyivDayStart(d);
        return { from, to: new Date(from.getTime() + 864e5), label: d };
      })();

  const shifts = await prisma.shift.findMany({
    where: { startedAt: { gte: range.from, lt: range.to } },
    orderBy: { startedAt: "asc" },
    select: {
      id: true, startedAt: true, endedAt: true, gpsDistanceKm: true, distanceKm: true,
      afterWorkKm: true, odometerToGpsRatio: true,
      user: { select: { name: true } },
    },
  });

  /**
   * Бекап пишемо ДО першого запису й одразу всім набором: якщо прохід
   * упаде посередині, повернути треба буде й те, що вже змінилося.
   */
  if (apply) {
    mkdirSync("output", { recursive: true });
    const path = `output/shift-km-backup-${kyivDate(new Date())}.json`;
    writeFileSync(
      path,
      JSON.stringify(
        shifts.map((s) => ({
          id: s.id, name: s.user.name, startedAt: s.startedAt,
          gpsDistanceKm: s.gpsDistanceKm, afterWorkKm: s.afterWorkKm,
          odometerToGpsRatio: s.odometerToGpsRatio,
        })),
        null,
        1
      )
    );
    console.log(`Бекап старих чисел: ${path} (${shifts.length} змін)\n`);
  }

  console.log(
    `${"Хто".padEnd(18)}${"День".padEnd(7)}${"одометр".padStart(8)}${"було".padStart(8)}` +
      `${"стало".padStart(8)}${"стоянка".padStart(9)}${"ходьба".padStart(8)}${"похибка".padStart(9)}`
  );
  console.log("=".repeat(75));

  let changed = 0;
  const errors: number[] = [];
  for (const shift of shifts) {
    const r = await recountShiftTrack(shift, { apply });
    if (r.changed) changed++;

    const err =
      r.distanceKm != null && r.distanceKm > 0 && r.after != null
        ? Math.round(((r.after - r.distanceKm) / r.distanceKm) * 100)
        : null;
    if (err != null) errors.push(Math.abs(err));

    console.log(
      (r.name ?? "?").slice(0, 17).padEnd(18) +
        kyivDate(r.startedAt).slice(5).padEnd(7) +
        String(r.distanceKm ?? "—").padStart(8) +
        String(r.before ?? "—").padStart(8) +
        String(r.after ?? "—").padStart(8) +
        String(r.stopKm ?? "—").padStart(9) +
        String(r.walkKm ?? "—").padStart(8) +
        (err != null ? `${err > 0 ? "+" : ""}${err}%` : "—").padStart(9)
    );
  }

  const median = errors.length
    ? errors.sort((a, b) => a - b)[Math.floor(errors.length / 2)]
    : null;
  console.log(
    `\n${range.label}: змін ${shifts.length}, розійшлося ${changed}` +
      (median != null ? `, медіана |трек − одометр| = ${median}%` : "") +
      (apply ? " — записано." : " — це показ, повторіть із --apply.")
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
