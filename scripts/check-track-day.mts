/**
 * «Чому сьогодні писало, а вчора ні» — звіт за день проміжками з доказами.
 *
 * Логіка в src/lib/track/day-report.ts; тут лише друк.
 *
 *   npx tsx --env-file=.env scripts/check-track-day.mts                   # сьогодні, усі
 *   npx tsx --env-file=.env scripts/check-track-day.mts 2026-09-15
 *   npx tsx --env-file=.env scripts/check-track-day.mts 2026-09-15 Джумага
 */

import { prisma } from "../src/lib/prisma";
import { kyivDate } from "../src/lib/date/kyiv";
import { buildDayReport } from "../src/lib/track/day-report";

const args = process.argv.slice(2);
const day = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? kyivDate(new Date());
const who = args.find((a) => !/^\d{4}-\d{2}-\d{2}$/.test(a));

const hm = (d: Date | null) =>
  d ? d.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }) : "—";

async function main() {
  const users = await prisma.user.findMany({
    where: {
      role: { in: ["SALES", "DRIVER"] },
      ...(who ? { name: { contains: who, mode: "insensitive" as const } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  console.log(`\nЗвіт треку за ${day}\n${"=".repeat(78)}`);
  for (const u of users) {
    const r = await buildDayReport(u.id, day);
    if (!r.window) continue;

    const shift = r.shifts.length
      ? r.shifts.map((s) => `${hm(s.startedAt)}–${hm(s.endedAt)}`).join(", ")
      : "без зміни";
    const cover = r.slots ? Math.round((r.slotsWithPoints / r.slots) * 100) : 0;
    console.log(`\n== ${r.name}: зміна ${shift} · точок ${r.points} · з точками ${cover}% п'ятихвилинок`);

    for (const i of r.intervals) {
      const mins = Math.round((i.to.getTime() - i.from.getTime()) / 60_000);
      console.log(
        `  ${hm(i.from)}–${hm(i.to)} ${String(mins).padStart(4)} хв  ${i.verdict}${i.points ? ` (${i.points} точок)` : ""}`
      );
      for (const ev of i.evidence) console.log(`        · ${ev}`);
    }

    if (r.contexts.length) {
      console.log("  Контексти JS:");
      for (const c of r.contexts) {
        const frozen = c.maxBatches === 0 && c.lastBeat.getTime() - c.startedAt.getTime() > 15 * 60_000;
        console.log(
          `    ${hm(c.startedAt)} [${c.version ?? "—"}] сторож ${c.watchdogAfterSec == null ? "—" : `+${c.watchdogAfterSec}с`}` +
            ` · пачок ${c.maxBatches} · пульсів ${c.beats} · до ${hm(c.lastBeat)}${frozen ? "  ⚠ жодної пачки" : ""}`
        );
      }
    }
    if (r.notable.length) console.log(`  Події: ${r.notable.join(" | ")}`);
    if (r.dispatcherLog.length) {
      console.log("  Журнал диспетчера (останній нативний знімок):");
      for (const line of r.dispatcherLog.slice(-25)) console.log(`    ${line}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
