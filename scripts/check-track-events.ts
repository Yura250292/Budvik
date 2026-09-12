/**
 * Чорна скринька треку: що відбувалося на планшеті й коли.
 *
 * Питання, заради якого це існує: чому в одного торгового трек пише, а в
 * іншого ні, коли з пульсу обидва виглядають однаково. 07.09 чотири планшети
 * показували «пишемо, підписані, дозвіл Завжди, проба приймача ±5 м» і нуль
 * точок за чотири години — а що саме сталося о котрій, не було видно ніде.
 *
 * Тут поруч три ряди на кожну людину: події пристрою (підйом контексту,
 * запуск служби і чим скінчився), життя контексту з пульсу (скільки разів
 * служба взагалі викликала застосунок) і самі точки. Разом вони читаються як
 * історія, а не як стан.
 *
 *   npx tsx scripts/check-track-events.ts            # сьогодні
 *   npx tsx scripts/check-track-events.ts 2026-09-07
 *   npx tsx scripts/check-track-events.ts 2026-09-07 Валентин
 */

import { prisma } from "../src/lib/prisma";
import { kyivDate, kyivDayStart } from "../src/lib/date/kyiv";

const hm = (d: Date | null | undefined) =>
  d
    ? d.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" })
    : "—";

/** Людською мовою: журнал читає не той, хто його писав. */
const KIND: Record<string, string> = {
  boot: "контекст JS піднявся",
  start_ok: "службу запущено",
  start_failed: "ЗАПУСК ВПАВ",
  start_denied: "запуск без дозволу на локацію",
  stop: "службу зупинено",
  restart_refused: "перезапуск відмовлено (фон)",
  task_error: "система віддала помилку завданню",
  push: "реєстрація сповіщень",
  mic: "мікрофон помічника",
  wake: "розбуджено сповіщенням",
  reload: "ПЕРЕЗАВАНТАЖЕННЯ контексту",
  task_gone: "СИСТЕМА ЗНЯЛА завдання локації",
};

async function main() {
  const day = process.argv[2] || kyivDate(new Date());
  const who = process.argv[3];
  const from = kyivDayStart(day);
  const to = new Date(from.getTime() + 864e5);

  const users = await prisma.user.findMany({
    where: {
      role: { in: ["SALES", "DRIVER"] },
      ...(who ? { name: { contains: who, mode: "insensitive" as const } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  console.log(`\nЧорна скринька за ${day}\n${"=".repeat(78)}`);

  for (const u of users) {
    const [events, beats, points, shift] = await Promise.all([
      prisma.trackEvent.findMany({
        where: { userId: u.id, at: { gte: from, lt: to } },
        orderBy: { at: "asc" },
        select: { at: true, kind: true, note: true },
      }),
      prisma.deviceHeartbeat.findMany({
        where: { userId: u.id, at: { gte: from, lt: to } },
        orderBy: { at: "asc" },
        select: {
          at: true, tracking: true, subscribed: true, lastFixAt: true,
          contextStartedAt: true, fixBatches: true, contextPoints: true, appVersion: true,
        },
      }),
      prisma.trackPoint.count({ where: { userId: u.id, recordedAt: { gte: from, lt: to } } }),
      prisma.shift.findFirst({
        where: { userId: u.id, startedAt: { gte: from, lt: to } },
        select: { startedAt: true, endedAt: true, status: true },
      }),
    ]);

    if (events.length === 0 && beats.length === 0 && points === 0) continue;

    console.log(
      `\n${(u.name ?? "?").trim()} — точок ${points}` +
        (shift ? ` · зміна ${hm(shift.startedAt)}–${hm(shift.endedAt)} (${shift.status})` : " · зміни немає")
    );

    if (events.length > 0) {
      console.log("  Події пристрою:");
      for (const e of events) {
        console.log(`    ${hm(e.at)}  ${(KIND[e.kind] ?? e.kind).padEnd(32)} ${e.note ?? ""}`);
      }
    } else {
      console.log("  Події пристрою: немає (стара збірка або планшет не озивався)");
    }

    /**
     * Із пульсів беремо не всі рядки, а МОМЕНТИ ЗМІНИ контексту: поки
     * контекст той самий, кожен рядок повторює попередній, і читати їх сотню
     * означає не побачити нічого.
     */
    const marks = beats.filter(
      (b, i) =>
        i === 0 ||
        b.contextStartedAt?.getTime() !== beats[i - 1].contextStartedAt?.getTime() ||
        b.appVersion !== beats[i - 1].appVersion
    );
    if (marks.length > 0) {
      console.log("  Контексти (з пульсу):");
      for (const m of marks) {
        console.log(
          `    ${hm(m.at)}  контекст із ${hm(m.contextStartedAt)} · пачок фіксів ${m.fixBatches ?? "?"} · ` +
            `точок ${m.contextPoints ?? "?"} · ${m.appVersion ?? "?"}`
        );
      }
      const last = beats[beats.length - 1];
      console.log(
        `    останній пульс ${hm(last.at)}: пише=${last.tracking}, підписка=${last.subscribed}, ` +
          `фікс ${hm(last.lastFixAt)}, пачок ${last.fixBatches ?? "?"}`
      );
    }
  }

  console.log(
    "\nЯк читати: «контекст піднявся, службу запущено, пачок фіксів 0» — служба\n" +
      "мертва (Android не дав підняти з фону). «Пачки йдуть, а точок нема» — фільтри\n" +
      "рекордера або приймач. «Подій немає, пульс є» — стара збірка.\n"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
