/**
 * Прибирає з треку координати, яких не могло бути.
 *
 * 03.09 планшети Ігоря й Олександра півгодини звітували Ліму — 48 і 1 точка
 * посеред перуанської столиці з похибкою ±3–9 м. Приймач у такому стані не
 * «неточний»: він рахує позицію з чужих сигналів, і жодне її значення не варте
 * нічого. У пробіг ці стрибки не пішли (там своя межа, MAX_PLAUSIBLE_KMH), але
 * в трек лягли — і день на карті став лінією через Атлантику, у якій
 * справжнього маршруту не видно взагалі.
 *
 * Прийом пачки таке більше не бере (див. isImpossibleFix у lib/track/geo).
 * Цей скрипт — для того, що вже в базі.
 *
 * Правило беремо звідти ж, а не переписуємо: два списки порогів розійшлися б, і
 * скрипт чистив би не те, що відсіює прийом.
 *
 * Пробіг ЗАКРИТОЇ зміни перераховує — інакше прибирання виглядає так, наче
 * не спрацювало: карта вже правильна, а число під нею лишається старим.
 *
 * Чого скрипт НЕ робить: не чіпає `distanceKm` сесії. Ці стрибки в неї й не
 * входили, а перерахунок дня з нуля дає інше число з іншої причини (пробіг
 * накопичується пачками, з іншими опорами) — і питання, чи переписувати
 * історичний пробіг, вирішує власник, а не прибирання сміття.
 *
 * Запуск:
 *   npx tsx scripts/drop-impossible-points.mts            # лише показати
 *   npx tsx scripts/drop-impossible-points.mts --apply    # видалити
 *   npx tsx scripts/drop-impossible-points.mts 2026-09-03 # один день
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { isImpossibleFix, haversineM } from "../src/lib/track/geo";
import { kyivDayStart } from "../src/lib/date/kyiv";
import { gpsKmBetween } from "../src/lib/shift/late-close";

const hm = (d: Date) =>
  d.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", hour12: false });

async function main() {
  const apply = process.argv.includes("--apply");
  const day = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

  const sessions = await prisma.trackSession.findMany({
    where: day ? { day: kyivDayStart(day) } : {},
    orderBy: { day: "asc" },
    select: { id: true, userId: true, day: true, pointsCount: true, user: { select: { name: true } } },
  });

  let totalDropped = 0;

  for (const session of sessions) {
    const points = await prisma.trackPoint.findMany({
      where: { sessionId: session.id },
      orderBy: { recordedAt: "asc" },
      select: { id: true, lat: true, lng: true, recordedAt: true },
    });

    /**
     * Ідемо тим самим порядком, що прийом: опорою стає лишена точка, а не
     * викинута. Інакше після першої Ліми опорою була б вона — і в «неможливі»
     * полетіли б справжні точки, які нібито стрибнули назад до Львова.
     */
    const doomed: typeof points = [];
    let prev: { lat: number; lng: number; recordedAt: Date } | null = null;
    for (const p of points) {
      if (isImpossibleFix(p, prev)) {
        doomed.push(p);
        continue;
      }
      prev = p;
    }
    if (doomed.length === 0) continue;

    // Київська дата, а не UTC: `day` — це 00:00 у Києві, тобто 21:00
    // попередньої доби за Гринвічем, і toISOString показав би вчорашній день.
    const dayLabel = session.day.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
    console.log(
      `\n${dayLabel} ${session.user.name ?? "?"}: ${doomed.length} з ${points.length} — ` +
        `${hm(doomed[0].recordedAt)} … ${hm(doomed[doomed.length - 1].recordedAt)}, ` +
        `центр ${(doomed.reduce((s, p) => s + p.lat, 0) / doomed.length).toFixed(3)},` +
        `${(doomed.reduce((s, p) => s + p.lng, 0) / doomed.length).toFixed(3)}`
    );
    totalDropped += doomed.length;
    if (!apply) continue;

    const doomedIds = new Set(doomed.map((p) => p.id));
    const kept = points.filter((p) => !doomedIds.has(p.id));

    await prisma.$transaction(async (tx) => {
      await tx.trackPoint.deleteMany({ where: { id: { in: doomed.map((p) => p.id) } } });

      /**
       * Точка ПІСЛЯ викинутого відрізка носить у собі відстань до Ліми —
       * 11 830 км у `metersFromPrev`. Це поле читають звіти якості дня, тож
       * лишити його означало б лікувати карту й лишити брехню в цифрах.
       */
      for (let i = 0; i < kept.length; i++) {
        const before = points[points.indexOf(kept[i]) - 1];
        if (!before || !doomedIds.has(before.id)) continue;
        const prevKept = kept[i - 1] ?? null;
        await tx.trackPoint.update({
          where: { id: kept[i].id },
          data: {
            metersFromPrev: prevKept
              ? Math.round(haversineM(prevKept.lat, prevKept.lng, kept[i].lat, kept[i].lng))
              : null,
            minutesFromPrev: prevKept
              ? Math.round(
                  (kept[i].recordedAt.getTime() - prevKept.recordedAt.getTime()) / 60_000
                )
              : null,
          },
        });
      }

      /**
       * Лінію дня скидаємо: вона кеш, і в ньому та сама Атлантика. Наступне
       * відкриття дня перекладе трек на дороги заново.
       */
      await tx.trackSession.update({
        where: { id: session.id },
        // DbNull, а не null: для Json-поля null у Prisma означає «літерал JSON
        // null», а нам треба саме порожньо — щоб кеш перерахувався.
        data: { pointsCount: kept.length, roadPath: Prisma.DbNull, roadPathPoints: null },
      });
    });

    /**
     * Пробіг зміни перерахувати ОБОВ'ЯЗКОВО, і це не дрібниця.
     *
     * `Shift.gpsDistanceKm` рахується один раз — коли зміну закривають — і далі
     * лежить числом. Ігор закрив зміну о 17:58, коли Ліма ще була в базі, тож у
     * картці зміни лишилося 23 817 км і після того, як самі точки зникли. Карта
     * показувала правильний маршрут, а число під нею — ні, і виглядало це так,
     * наче прибирання не спрацювало.
     *
     * Чіпаємо лише те, що вже пораховане: у відкритої зміни числа ще немає, і
     * виставляти його зараз означало б закрити її наполовину.
     */
    const shifts = await prisma.shift.findMany({
      where: {
        userId: session.userId,
        gpsDistanceKm: { not: null },
        points: { some: { sessionId: session.id } },
      },
      select: { id: true, startedAt: true, endedAt: true, gpsDistanceKm: true },
    });
    for (const shift of shifts) {
      const workKm = await gpsKmBetween(shift.id, shift.startedAt, shift.endedAt);
      const afterWorkKm = shift.endedAt ? await gpsKmBetween(shift.id, shift.endedAt, null) : null;
      await prisma.shift.update({
        where: { id: shift.id },
        data: { gpsDistanceKm: workKm, ...(shift.endedAt ? { afterWorkKm } : {}) },
      });
      console.log(`    пробіг зміни: ${shift.gpsDistanceKm} → ${workKm} км`);
    }
  }

  console.log(
    totalDropped === 0
      ? "\nНеможливих точок немає."
      : apply
        ? `\nВидалено ${totalDropped}.`
        : `\nНайдено ${totalDropped}. Повторіть з --apply, щоб видалити.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
