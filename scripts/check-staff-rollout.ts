/**
 * Чи можна роздавати нову робочу збірку решті — одним запуском.
 *
 *   npx tsx scripts/check-staff-rollout.ts
 *
 * Заради чого. Збірка перевірена машинно по кожному пункту паритету, але
 * єдине, заради чого вона існує — записати маршрут, — довго не траплялося на
 * живому планшеті ЖОДНОГО разу: 28.08 пульсів з увімкненим треком було 0 з 12,
 * бо на єдиному пристрої з новою збіркою не було дозволу на місце. Роздати її
 * тоді п'ятьом означало б п'ять утрачених маршрутів, кожен з яких помітили б
 * аж наступного ранку.
 *
 * Тому готовність тут міряється не переліком можливостей, а трьома фактами з
 * бази: трек ішов, точки лягли, дірок у них немає. Усе інше — контекст до них.
 *
 * Читання, жодних записів.
 */
import { prisma } from "../src/lib/prisma";
import { STAFF_APK_VERSION_NAME } from "../src/lib/app-builds";

/** Скільки годин тиші в треку вже вважаємо діркою, а не стоянкою в клієнта. */
const GAP_MINUTES = 45;

/** Стільки точок за день — це справжня зміна, а не «увімкнув і вимкнув». */
const POINTS_FOR_A_DAY = 100;

const kyiv = (d: Date) =>
  d.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

async function main() {
  const marker = `app:staff:installed:`;
  const installed = await prisma.syncState.findMany({
    where: { key: { startsWith: marker } },
    select: { key: true, value: true, updatedAt: true },
  });

  if (installed.length === 0) {
    console.log("Нову збірку ще ніхто не відкривав. Роздавати нема кому й нема на чому.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Нова збірка (${STAFF_APK_VERSION_NAME}) стоїть у ${installed.length} люд.\n`);

  let anyProven = false;

  for (const row of installed) {
    const userId = row.key.replace(marker, "");
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, role: true },
    });

    /**
     * Пульси саме НОВОЇ збірки. Старий трекер шле свої під тим самим
     * користувачем, і без фільтра по версії вони видали б чужу роботу за її.
     */
    const beats = await prisma.deviceHeartbeat.findMany({
      where: { userId, appVersion: { startsWith: "1.2." } },
      orderBy: { at: "asc" },
      select: {
        at: true, tracking: true, buffered: true,
        locationPermission: true, batteryOptimized: true, locationMode: true, lastError: true,
      },
    });

    const tracked = beats.filter((b) => b.tracking).length;
    const last = beats[beats.length - 1];

    console.log(`— ${user?.name ?? userId} (${user?.role}) —`);
    console.log(`  пульсів: ${beats.length}, з них із увімкненим треком: ${tracked}`);

    if (last) {
      console.log(
        `  останній стан: дозвіл ${last.locationPermission ?? "?"}` +
          ` · GPS ${last.locationMode ?? "?"}` +
          ` · батарея ${last.batteryOptimized ? "душить" : "не заважає"}` +
          ` · у буфері ${last.buffered}` +
          ` · ${kyiv(last.at)}`
      );
      if (last.lastError) console.log(`  остання помилка пристрою: ${last.lastError}`);
    }

    /**
     * Точки беремо за час ПІСЛЯ появи нової збірки на цьому пристрої: до того
     * їх писав старий трекер, і зарахувати їх новій — це обдурити самого себе.
     */
    const since = beats[0]?.at ?? row.updatedAt;
    const points = await prisma.trackPoint.findMany({
      where: { userId, recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
      select: { recordedAt: true },
    });

    if (points.length === 0) {
      console.log(`  точок після встановлення: жодної\n`);
      continue;
    }

    let maxGap = 0;
    let gapAt: Date | null = null;
    for (let i = 1; i < points.length; i++) {
      const g = (points[i].recordedAt.getTime() - points[i - 1].recordedAt.getTime()) / 60000;
      if (g > maxGap) {
        maxGap = g;
        gapAt = points[i - 1].recordedAt;
      }
    }

    console.log(
      `  точок після встановлення: ${points.length}` +
        ` (${kyiv(points[0].recordedAt)} → ${kyiv(points[points.length - 1].recordedAt)})`
    );
    console.log(
      `  найдовша тиша в треку: ${Math.round(maxGap)} хв` +
        (gapAt ? ` (з ${kyiv(gapAt)})` : "") +
        (maxGap >= GAP_MINUTES ? "  ← ДІРКА" : "")
    );

    if (points.length >= POINTS_FOR_A_DAY && maxGap < GAP_MINUTES) anyProven = true;
    console.log("");
  }

  console.log("———");
  if (anyProven) {
    console.log("Збірка ВЖЕ протримала день без дірок хоча б на одному планшеті.");
    console.log("Можна роздавати решті — і лишати старий трекер на місці ще на день.");
  } else {
    console.log("Роздавати РАНО: жоден планшет ще не відпрацював день на новій збірці без дірок.");
    console.log(`Потрібно: ≥${POINTS_FOR_A_DAY} точок поспіль і жодної тиші довшої за ${GAP_MINUTES} хв.`);
  }

  await prisma.$disconnect();
}

main();
