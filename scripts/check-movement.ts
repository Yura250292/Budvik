/**
 * Що класифікатор пересування каже про справжні дні.
 *
 * Тестів у проєкті немає, тому перевірка тут: беремо збережені дні й
 * дивимося, скільки кілометрів лягло в машину, скільки в ноги, і чи не
 * поїхали в ноги цілі поїздки.
 *
 *   npx tsx scripts/check-movement.ts            # сьогодні
 *   npx tsx scripts/check-movement.ts 2026-09-02
 */

import { prisma } from "../src/lib/prisma";
import { classifyMovement, movementTotals } from "../src/lib/track/movement";
import { kyivDate, kyivDayStart } from "../src/lib/date/kyiv";

const hm = (d: Date) =>
  d.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour12: false });

async function main() {
  const day = process.argv[2] || kyivDate(new Date());
  const from = kyivDayStart(day);
  const to = new Date(from.getTime() + 864e5);

  const sessions = await prisma.trackSession.findMany({
    where: { day: from },
    select: { id: true, distanceKm: true, user: { select: { name: true } } },
  });

  console.log(`\nПересування за ${day}\n${"=".repeat(64)}`);

  for (const session of sessions) {
    const points = await prisma.trackPoint.findMany({
      where: { sessionId: session.id, recordedAt: { gte: from, lt: to } },
      orderBy: { recordedAt: "asc" },
      select: { lat: true, lng: true, recordedAt: true },
    });
    if (points.length < 2) continue;

    const segments = classifyMovement(points);
    const t = movementTotals(segments);
    console.log(
      `\n${session.user.name ?? "?"} — ${points.length} точок` +
        `\n  автом  ${String(t.DRIVE.km).padStart(6)} км за ${t.DRIVE.minutes} хв` +
        `\n  пішки  ${String(t.WALK.km).padStart(6)} км за ${t.WALK.minutes} хв` +
        `\n  стоїть ${String(t.STOP.km).padStart(6)} км за ${t.STOP.minutes} хв`
    );

    const walks = segments.filter((s) => s.mode === "WALK");
    console.log(`  піших відрізків: ${walks.length}`);
    for (const w of walks.slice(0, 6)) {
      console.log(`    ${hm(w.from)}–${hm(w.to)}  ${w.minutes} хв  ${(w.meters / 1000).toFixed(2)} км`);
    }

    /**
     * Запобіжник від найгіршої помилки: якщо в «пішки» потрапив відрізок
     * довший за кілометр, це майже напевно машина, і поріг треба міряти
     * заново, а не вірити підсумку.
     */
    const suspicious = walks.filter((w) => w.meters > 1_000);
    if (suspicious.length > 0) {
      console.log(`  ⚠️  піших відрізків довших за 1 км: ${suspicious.length} — перевірити пороги`);
      for (const w of suspicious) {
        console.log(`      ${hm(w.from)}–${hm(w.to)} ${(w.meters / 1000).toFixed(2)} км за ${w.minutes} хв`);
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
