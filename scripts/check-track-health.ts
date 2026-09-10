/**
 * Пульт треку в терміналі — той самий діагноз, що на екрані.
 *
 * Одна логіка на три поверхні (`src/lib/track/health-board.ts`): екран
 * керівника, сповіщення воркера і цей скрипт. Дві копії розійшлися б, і
 * відповідь на «чому не пишеться» залежала б від того, хто питає.
 *
 *   npx tsx scripts/check-track-health.ts            # сьогодні
 *   npx tsx scripts/check-track-health.ts 2026-09-07
 *   npx tsx scripts/check-track-health.ts --events   # із журналом пристрою
 */

import { prisma } from "../src/lib/prisma";
import { trackHealthBoard } from "../src/lib/track/health-board";

const args = process.argv.slice(2);
const withEvents = args.includes("--events");
const day = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

const hm = (s: string | null) =>
  s ? new Date(s).toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }) : "—";

const MARK: Record<string, string> = { OK: "✅", WARN: "⚠️ ", DEAD: "❌", IDLE: "· " };

async function main() {
  const board = await trackHealthBoard(day);
  console.log(`\nПульт треку за ${board.day}, станом на ${hm(board.now)}\n${"=".repeat(78)}`);

  for (const t of board.tablets) {
    console.log(`\n${MARK[t.state]} ${t.name}  —  ${t.verdict}`);
    if (t.action) console.log(`     → ${t.action}`);

    const b = t.beat;
    if (b) {
      console.log(
        `     пульс ${hm(b.at)} (${b.minutesAgo} хв тому) · ${b.appVersion ?? "—"}` +
          (b.osVersion ? ` · ${b.osVersion}` : "")
      );
      console.log(
        `     життя застосунку: з ${hm(b.contextStartedAt)}` +
          (b.contextMinutes != null ? ` (${b.contextMinutes} хв)` : "") +
          ` · викликів служби ${b.fixBatches ?? "?"} · точок ${b.contextPoints ?? "?"}`
      );
      console.log(
        `     пише=${b.tracking} підписка=${b.subscribed} режим=${b.mode ?? "—"} буфер=${b.buffered}` +
          ` · дозвіл ${b.locationPermission ?? "—"} · GPS ${b.locationMode ?? "—"}` +
          ` · батарея ${b.batteryPct ?? "?"}%${b.batteryOptimized ? " (обмежує!)" : ""}`
      );
      console.log(
        `     фікс ${hm(b.lastFixAt)}${b.lastFixAccuracyM != null ? ` ±${b.lastFixAccuracyM} м` : ""}` +
          ` · відправка ${hm(b.lastSyncAt)} · сторож ${hm(b.watchdogAt)} ${b.watchdogStatus ?? ""}`
      );
      if (b.lastError) console.log(`     скарга пристрою: ${b.lastError}`);
    }
    console.log(`     точок за день ${t.points.today}, остання ${hm(t.points.lastAt)}`);

    /**
     * Проба шару треку — окремим рядком, бо вона відповідає на інше питання.
     * Пульс каже «як почувається запис»; проба каже, чи шар треку взагалі
     * живий. Коли пульс старий, а проба свіжа — застосунок відкривали, і
     * мовчить саме трек, а не планшет.
     */
    if (t.probe) {
      const stale = t.beat ? t.probe.minutesAgo < t.beat.minutesAgo : true;
      console.log(
        `     проба треку ${hm(t.probe.at)} (${t.probe.minutesAgo} хв тому): ${t.probe.text}` +
          (stale ? "   ← свіжіша за пульс" : "")
      );
    }

    if (withEvents && t.events.length) {
      console.log("     журнал пристрою:");
      for (const e of [...t.events].reverse()) {
        console.log(`       ${hm(e.at)}  ${e.kind.padEnd(14)} ${e.note ?? ""}`);
      }
    }
  }

  const bad = board.tablets.filter((t) => t.state === "DEAD").length;
  console.log(`\n${"=".repeat(78)}`);
  console.log(bad ? `❌ Планшетів, які НЕ пишуть: ${bad}\n` : "✅ Ті, хто на зміні, пишуть\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
