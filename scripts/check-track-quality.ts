/**
 * Якість треку за день: не «чи є лінія», а чи вона суцільна.
 *
 * Карта бреше найгірше саме тут. Коли пристрій мовчав пів години, сусідні
 * точки просто з'єднуються прямою — і день виглядає відпрацьованим. Тому
 * цей звіт рахує інше: скільки кілометрів дня — це РЕАЛЬНО записаний шлях,
 * а скільки — стрибки через дірки, та коли саме дірки починались.
 *
 * Заразом видно і другий бік: у кого трек не почався взагалі, у кого
 * обірвався і о котрій востаннє озивався планшет (DeviceToken.lastUsedAt).
 *
 * Читання, жодних записів:
 *   npx tsx scripts/check-track-quality.ts          # сьогодні
 *   npx tsx scripts/check-track-quality.ts 2026-08-25
 */

import { PrismaClient } from "@prisma/client";
import { kyivDate, kyivDayStart } from "../src/lib/date/kyiv";

const prisma = new PrismaClient();

/** Пауза, з якої це вже не «не встиг», а дірка. Точка йде раз на хвилину. */
const GAP_MINUTES = 4;

function hhmm(d: Date) {
  return d.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });
}

async function main() {
  const day = process.argv[2] || kyivDate(new Date());
  const dayStart = kyivDayStart(day);
  const dayEnd = new Date(dayStart.getTime() + 864e5);

  console.log(`\nТрек за ${day} (київський час)\n${"=".repeat(72)}`);

  const shifts = await prisma.shift.findMany({
    where: { startedAt: { gte: dayStart, lt: dayEnd } },
    orderBy: { startedAt: "asc" },
    select: {
      id: true, userId: true, status: true, startedAt: true, endedAt: true,
      user: { select: { name: true, role: true } },
    },
  });

  for (const shift of shifts) {
    const pts = await prisma.trackPoint.findMany({
      where: { shiftId: shift.id },
      orderBy: { recordedAt: "asc" },
      select: { recordedAt: true, createdAt: true, accuracyM: true, metersFromPrev: true, lat: true, lng: true },
    });

    const end = shift.endedAt ?? new Date();
    const durMin = (end.getTime() - shift.startedAt.getTime()) / 60_000;

    console.log(
      `\n${shift.user.name ?? "?"} (${shift.user.role}) — зміна ${hhmm(shift.startedAt)}–${shift.endedAt ? hhmm(shift.endedAt) : "…"} (${durMin.toFixed(0)} хв), ${shift.status}`
    );

    if (pts.length === 0) {
      console.log("  ТРЕКУ НЕМАЄ ЖОДНОЇ ТОЧКИ");
      await printDevices(shift.userId);
      continue;
    }

    // Мовчання до першої точки й після останньої — це теж дірки, просто
    // з країв. Саме вони ховаються найкраще: лінія ж є.
    const headMin = (pts[0].recordedAt.getTime() - shift.startedAt.getTime()) / 60_000;
    const tailMin = (end.getTime() - pts[pts.length - 1].recordedAt.getTime()) / 60_000;

    let totalKm = 0;
    let gapKm = 0;
    let gapMin = 0;
    const gaps: string[] = [];

    for (let i = 1; i < pts.length; i++) {
      const km = (pts[i].metersFromPrev ?? 0) / 1000;
      const min = (pts[i].recordedAt.getTime() - pts[i - 1].recordedAt.getTime()) / 60_000;
      totalKm += km;
      if (min <= GAP_MINUTES) continue;
      gapKm += km;
      gapMin += min;
      gaps.push(
        `    ${hhmm(pts[i - 1].recordedAt)}→${hhmm(pts[i].recordedAt)}  ${min.toFixed(0).padStart(3)} хв  ${km.toFixed(1).padStart(5)} км  ` +
          `точність до ${String(pts[i - 1].accuracyM ?? "-").padStart(3)} м, після ${String(pts[i].accuracyM ?? "-").padStart(3)} м`
      );
    }

    // Лаг доставки: скільки точка лежала в буфері планшета. Пачка йде раз
    // на 2 хвилини, тож усе, що більше, — це хвилини без зв'язку.
    const lags = pts
      .map((p) => (p.createdAt.getTime() - p.recordedAt.getTime()) / 60_000)
      .sort((a, b) => a - b);

    const share = totalKm > 0 ? (gapKm / totalKm) * 100 : 0;
    console.log(
      `  точок ${pts.length}, перша ${hhmm(pts[0].recordedAt)} (через ${headMin.toFixed(0)} хв після відкриття), остання ${hhmm(pts[pts.length - 1].recordedAt)} (${tailMin.toFixed(0)} хв тому)`
    );
    console.log(
      `  ${totalKm.toFixed(1)} км за треком, з них ${gapKm.toFixed(1)} км (${share.toFixed(0)}%) — стрибки через ${gaps.length} дірок на ${gapMin.toFixed(0)} хв`
    );
    console.log(
      `  лаг доставки: медіана ${lags[Math.floor(lags.length / 2)].toFixed(1)} хв, найгірший ${lags[lags.length - 1].toFixed(1)} хв`
    );
    gaps.forEach((g) => console.log(g));
    if (share > 30 || headMin > 15 || tailMin > 20) await printDevices(shift.userId);
  }

  // Точки поза змінами: водії (вони змін не відкривають) і фаза «після зміни».
  const outside = await prisma.trackPoint.groupBy({
    by: ["userId"],
    where: { recordedAt: { gte: dayStart, lt: dayEnd }, shiftId: null },
    _count: { _all: true },
  });
  if (outside.length) {
    console.log(`\nТочки поза змінами (водії та «після зміни»):`);
    for (const row of outside) {
      const u = await prisma.user.findUnique({ where: { id: row.userId }, select: { name: true, role: true } });
      console.log(`  ${u?.name ?? row.userId} (${u?.role}) — ${row._count._all}`);
    }
  }
}

/** Планшети людини: коли востаннє озивались і чи не відкликаний токен. */
async function printDevices(userId: string) {
  const devices = await prisma.deviceToken.findMany({
    where: { userId, scope: "track" },
    orderBy: { createdAt: "desc" },
    select: { deviceName: true, lastUsedAt: true, revokedAt: true, createdAt: true },
  });
  if (devices.length === 0) {
    console.log("    пристроїв не зареєстровано — застосунок не встановлений або вхід не робився");
    return;
  }
  for (const d of devices) {
    console.log(
      `    пристрій ${d.deviceName ?? "-"}: востаннє озивався ${d.lastUsedAt ? d.lastUsedAt.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" }) : "ніколи"}${d.revokedAt ? " (ТОКЕН ВІДКЛИКАНО)" : ""}`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
