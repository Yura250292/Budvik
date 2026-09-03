/**
 * Які зупинки видно в справжніх днях — і чи підписуються вони клієнтами.
 *
 *   npx tsx scripts/check-stops.ts            # сьогодні
 *   npx tsx scripts/check-stops.ts 2026-09-02
 */

import { prisma } from "../src/lib/prisma";
import { findStops } from "../src/lib/track/stops";
import { ordersTodayForRep } from "../src/lib/track/orders-today";
import { kyivDate, kyivDayStart } from "../src/lib/date/kyiv";

const hm = (d: Date) =>
  d.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });

async function main() {
  const day = process.argv[2] || kyivDate(new Date());
  const from = kyivDayStart(day);

  const sessions = await prisma.trackSession.findMany({
    where: { day: from },
    select: { id: true, userId: true, user: { select: { name: true } } },
  });

  for (const session of sessions) {
    const points = await prisma.trackPoint.findMany({
      where: { sessionId: session.id },
      orderBy: { recordedAt: "asc" },
      select: { lat: true, lng: true, recordedAt: true },
    });
    if (points.length < 2) continue;

    const orders = await ordersTodayForRep(session.userId, day);
    const stops = findStops(points, orders.dots);
    const named = stops.filter((s) => s.counterpartyName).length;

    console.log(
      `\n${session.user.name ?? "?"}: ${stops.length} зупинок ≥5 хв, ` +
        `підписано клієнтом ${named}, замовлень на карті ${orders.dots.length}`
    );
    for (const s of stops) {
      console.log(
        `  ${String(s.seq).padStart(2)}  ${hm(s.from)}–${hm(s.to)}  ${String(s.minutes).padStart(3)} хв  ` +
          (s.counterpartyName ? `${s.counterpartyName} (${s.distanceM} м)` : "—")
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
