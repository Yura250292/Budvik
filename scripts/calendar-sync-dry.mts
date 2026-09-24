/**
 * Що конектор зробив би з календарями — не роблячи цього.
 *
 * Показує наміри: кому яку подію поставити, виправити чи прибрати. У Google
 * не ходить (крім --live), у базу не пише. Перша перевірка після кожної
 * зміни проєкторів і правил.
 *
 *   npx tsx --env-file=.env scripts/calendar-sync-dry.mts
 *   npx tsx --env-file=.env scripts/calendar-sync-dry.mts --live   # справжній прохід
 *
 * READ ONLY без --live.
 */

import { syncCalendars } from "../src/lib/calendar/sync";
import { calendarMissingEnv } from "../src/lib/calendar/config";
import { windowFor } from "../src/lib/calendar/policy";
import { prisma } from "../src/lib/prisma";

const live = process.argv.includes("--live");

async function main() {
  const missing = calendarMissingEnv();
  if (missing.length > 0) {
    console.log(`Конектор вимкнено — немає ${missing.join(", ")}.`);
    console.log("Це не помилка: без цих змінних календар просто не працює, решта сайту жива.");
    return;
  }

  const now = new Date();
  const window = windowFor(now);
  console.log(`Вікно звірення: ${window.from} … ${window.to}`);

  const connections = await prisma.calendarConnection.findMany({
    select: { googleEmail: true, status: true, calendarId: true, lastSyncAt: true },
  });

  if (connections.length === 0) {
    console.log("Підключень немає — нікому нічого класти.");
    return;
  }

  for (const c of connections) {
    console.log(
      `• ${c.googleEmail} — ${c.status}, календар ${c.calendarId ? "створено" : "ще ні"}` +
        `, останній прохід ${c.lastSyncAt ? c.lastSyncAt.toISOString() : "не було"}`
    );
  }

  console.log();
  const log = await syncCalendars({ dry: !live, now });

  if (log.length === 0) {
    console.log(live ? "Нічого не змінилось." : "Наміри порожні — календарі вже збігаються з сайтом.");
  } else {
    for (const line of log) console.log(`  ${line}`);
  }

  if (!live) console.log("\nУ Google нічого не записано (для справжнього проходу — прапорець --live).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
