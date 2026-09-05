/**
 * Чи правильно ми бачимо повторні проїзди — на справжніх днях.
 *
 * Питання, на яке відповідає цей стенд: скільки денного пробігу насправді йде
 * по власному сліду, і скільки з цього ловить `markRepeatPasses`. Перше число
 * рахується незалежно й тупо — рівномірні відбірні точки вздовж треку й пошук
 * найближчої давнішої, — тому воно й годиться за еталон: у ньому немає жодної
 * з наших евристик про напрямки й пороги.
 *
 * Порівнювати треба ОБИДВА боки. День, у якому людина справді їздить кільцем
 * (Кулик 04.09: еталон 7%), — найцінніший контроль: якщо детектор і на ньому
 * почне бачити повтори, значить поріг опустили надто низько.
 *
 *   npx tsx scripts/check-repeat-pass.ts            # сьогодні
 *   npx tsx scripts/check-repeat-pass.ts 2026-09-04
 */

import { prisma } from "../src/lib/prisma";
import { haversineM } from "../src/lib/track/geo";
import { splitByMovement } from "../src/lib/track/movement-parts";
import { classifyMovement } from "../src/lib/track/movement";
import { kyivDate, kyivDayStart } from "../src/lib/date/kyiv";

/** Крок відбірних точок еталона. */
const STEP_M = 100;
/** Ближче цього вважаємо, що це та сама дорога. */
const NEAR_M = 40;
/** Раніше цього часу повтором не рахуємо — як і в самому детекторі. */
const MIN_REVISIT_MS = 3 * 60_000;

/**
 * Незалежний еталон: яка частка ЇЗДИ проходить біля давнішого сліду.
 *
 * Тільки їзда — і це не дрібниця. Перша версія рахувала всі точки підряд, і
 * еталон вийшов утричі більшим за детектор. Причина виявилася не в детекторі:
 * поки людина пів години стоїть у клієнта, приймач сипле точки в одному
 * місці, і кожна пізніша «повторює давнішу» за визначенням. Тобто еталон
 * міряв стоянки, а не повернення дорогою.
 */
function groundTruthShare(
  pts: Array<{ lat: number; lng: number; recordedAt: Date }>,
  driveGap: boolean[]
): number {
  const s: Array<{ lat: number; lng: number; at: number }> = [];
  for (let i = 0; i < pts.length - 1; i++) {
    if (!driveGap[i]) continue;
    const m = haversineM(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng);
    if (m < 20) continue;
    const steps = Math.max(1, Math.round(m / STEP_M));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      s.push({
        lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * t,
        lng: pts[i].lng + (pts[i + 1].lng - pts[i].lng) * t,
        at:
          pts[i].recordedAt.getTime() +
          (pts[i + 1].recordedAt.getTime() - pts[i].recordedAt.getTime()) * t,
      });
    }
  }
  if (s.length === 0) return 0;

  let near = 0;
  for (let i = 0; i < s.length; i++) {
    for (let j = 0; j < i; j++) {
      if (s[i].at - s[j].at < MIN_REVISIT_MS) break;
      if (haversineM(s[i].lat, s[i].lng, s[j].lat, s[j].lng) <= NEAR_M) {
        near++;
        break;
      }
    }
  }
  return Math.round((100 * near) / s.length);
}

async function main() {
  const day = process.argv[2] || kyivDate(new Date());
  const from = kyivDayStart(day);
  const to = new Date(from.getTime() + 864e5);

  const shifts = await prisma.shift.findMany({
    where: { startedAt: { gte: from, lt: to } },
    orderBy: { startedAt: "asc" },
    select: { id: true, user: { select: { name: true } } },
  });

  console.log(`\nПовторні проїзди за ${day}\n${"=".repeat(78)}`);
  console.log(
    `${"Хто".padEnd(18)}${"їзди".padStart(8)}${"уперше".padStart(9)}${"назад".padStart(8)}` +
      `${"знову".padStart(8)}${"знайшли".padStart(9)}${"еталон".padStart(8)}`
  );

  for (const s of shifts) {
    const points = await prisma.trackPoint.findMany({
      where: { shiftId: s.id },
      orderBy: { recordedAt: "asc" },
      select: { lat: true, lng: true, recordedAt: true, accuracyM: true, gapGeometry: true },
    });
    if (points.length < 20) continue;

    /** Ті самі проміжки, що їх детектор вважає їздою. */
    const driveGap: boolean[] = new Array(Math.max(0, points.length - 1)).fill(false);
    for (const seg of classifyMovement(points)) {
      if (seg.mode !== "DRIVE") continue;
      for (let i = seg.start; i < seg.end; i++) driveGap[i] = true;
    }

    const parts = await splitByMovement(points, false);
    const km = (kind: string) =>
      Math.round(
        parts.filter((p) => p.mode === "DRIVE" && p.pass === kind).reduce((a, p) => a + p.km, 0) * 10
      ) / 10;
    const first = km("FIRST");
    const back = km("BACK");
    const again = km("AGAIN");
    const total = Math.round((first + back + again) * 10) / 10;
    const found = total > 0 ? Math.round((100 * (back + again)) / total) : 0;

    console.log(
      (s.user.name ?? "?").trim().slice(0, 17).padEnd(18) +
        String(total).padStart(8) +
        String(first).padStart(9) +
        String(back).padStart(8) +
        String(again).padStart(8) +
        `${found}%`.padStart(9) +
        `${groundTruthShare(points, driveGap)}%`.padStart(8)
    );
  }

  console.log(
    "\nЕталон рахується інакше й навмисно тупо — по відстані до давнішого сліду.\n" +
      "Детектор має бути близько до нього на днях із поверненнями й так само низько\n" +
      "там, де людина їздила кільцем.\n"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
