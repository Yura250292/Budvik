/**
 * Разова правка: перепозначити зміни, закриті як AUTO_GPS попри розрив у треку.
 *
 * Перше ж автозакриття на проді (27.08) закрило зміну з джерелом
 * AUTO_GPS і поясненням «машина стояла з 16:05», хоча трек перед тим
 * мовчав 412 хвилин. Логіку виправлено, але вже записані зміни лишилися
 * з поясненням, яке читається як вимір, — і торговий підтвердив би його
 * не глядячи. Тому переставляємо джерело на AUTO_GAP тим змінам, де
 * розрив перед зупинкою це підтверджує.
 *
 *   npx tsx scripts/fix-shift-source-gap.ts        # показати
 *   npx tsx scripts/fix-shift-source-gap.ts --apply # застосувати
 */
import { PrismaClient } from "@prisma/client";
import { guessWorkEnd } from "../src/lib/shift/late-close";
import { autoCloseNote } from "../src/lib/shift/reconcile";

const p = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const GAP_BEFORE_STOP_MINUTES = 45;

async function main() {
  const shifts = await p.shift.findMany({
    where: { lateCloseSource: "AUTO_GPS", confirmedAt: null },
    select: { id: true, startedAt: true, endedAt: true, notes: true, user: { select: { name: true } } },
    orderBy: { startedAt: "desc" },
  });

  console.log(`Змін із AUTO_GPS без підтвердження: ${shifts.length}\n`);
  let touched = 0;

  for (const s of shifts) {
    const tail = await guessWorkEnd(s.id, { tailOnly: true });
    if (!tail) {
      console.log(`· ${s.user.name}: зупинки в треку вже не видно — не чіпаю`);
      continue;
    }
    if (tail.gapBeforeMin < GAP_BEFORE_STOP_MINUTES) {
      console.log(`✓ ${s.user.name}: розрив ${tail.gapBeforeMin} хв — AUTO_GPS правильне`);
      continue;
    }

    touched++;
    console.log(
      `→ ${s.user.name}: розрив ${tail.gapBeforeMin} хв перед зупинкою — AUTO_GPS → AUTO_GAP`
    );
    if (!APPLY) continue;

    await p.shift.update({
      where: { id: s.id },
      data: {
        lateCloseSource: "AUTO_GAP",
        notes: autoCloseNote("AUTO_GAP", s.endedAt),
      },
    });
  }

  console.log(
    `\n${touched === 0 ? "Нічого міняти" : APPLY ? `Виправлено: ${touched}` : `Буде виправлено: ${touched} (--apply)`}`
  );
  await p.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
