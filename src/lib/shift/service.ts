/**
 * Життєвий цикл зміни торгового.
 *
 * Логіка живе тут, а не в роутах: відкриття зміни вміє заразом закрити
 * забуту вчорашню, і ця пара мусить бути однією транзакцією. Розкидана
 * по двох роутах, вона рано чи пізно розійшлася б.
 */

import { prisma } from "@/lib/prisma";
import type { OdometerSource, Prisma } from "@prisma/client";
import { haversineM, MAX_ACCURACY_M } from "@/lib/track/geo";
import { classifyMovement, type MoveMode } from "@/lib/track/movement";
import { dropSpikes } from "@/lib/track/spikes";
import { MAX_DAILY_KM } from "@/lib/odometer/validate";

/**
 * Скільки годин зміна може висіти відкритою, поки її не визнають забутою.
 *
 * Після появи автозакриття (`@/lib/shift/auto-close`) стеля майже
 * недосяжна: зміну закриють увечері того ж дня. Константа лишається
 * запасним поясненням для випадків, коли воркер не працював.
 */
export const ABANDON_AFTER_HOURS = 20;

export type ShiftSummary = {
  id: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  startOdometer: number;
  endOdometer: number | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  gpsDistanceKm: number | null;
  odometerToGpsRatio: number | null;
  personalKm: number | null;
  odometerSuspicious: boolean;
  closedAutomatically: boolean;
};

/** Відкрита зміна людини або null. */
export async function findOpenShift(userId: string) {
  return prisma.shift.findFirst({
    where: { userId, status: "OPEN" },
    orderBy: { startedAt: "desc" },
  });
}

/** Остання зміна з відомим кінцевим одометром — точка відліку для наступної. */
export async function findLastFinished(userId: string) {
  return prisma.shift.findFirst({
    where: { userId, status: { in: ["CLOSED", "ABANDONED"] }, endOdometer: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { id: true, endOdometer: true, endedAt: true, distanceKm: true, startedAt: true },
  });
}

/**
 * Пробіг зміни за треком, поділений за способом пересування.
 *
 * Одна функція на всі шляхи закриття — і в цьому весь сенс. Раніше їх було
 * дві: звичайне закриття рахувало `gpsDistanceForShift` (лише довірені
 * фікси), а автозакриття, пізнє закриття й правка офісу — `gpsKmBetween`
 * (усі підряд, разом зі стометровим шумом). Одна й та сама зміна отримувала
 * різні числа залежно від того, ЯК її закрили, і пояснити це людині було
 * нічим.
 *
 * Два правила, від яких залежить, чи збігається число з одометром:
 *
 * 1. **Лише довірені фікси.** Слабкі (похибка понад MAX_ACCURACY_M) лежать у
 *    треку, бо показують, де людина була, коли GPS не бачив неба. Але сусідні
 *    такі точки стрибають на пів кілометра, стоячи на місці, — у Кулика
 *    28–31.08 саме звідси бралося +30 % до одометра.
 *
 * 2. **У пробіг іде лише ЇЗДА.** Тремтіння приймача на стоянці — це 3–17 км
 *    за день (Передрій 04.09: 16,8 км «стоїть» при різниці з одометром у
 *    13 км). Класифікатор `classifyMovement` уже вміє відрізняти стоянку від
 *    руху для карти; тепер те саме рішення визначає й число. Ходьба теж не
 *    їзда: одометр її не бачить у принципі.
 *
 * Проміжки, добиті реальною дорогою (`roadMetersFromPrev`), ідуть у пробіг
 * замість прямої — інакше офлайнові ділянки занижують день рівно на хорду.
 */
export type ShiftTrackKm = {
  /** Кілометри за кермом — це й є «за треком» у картці зміни */
  driveKm: number;
  /** Ногами: ринок, двір, склад клієнта. Окремо, бо одометр їх не бачить */
  walkKm: number;
  /** Скільки «проїхало» тремтіння на стоянках — міра шуму приймача */
  stopKm: number;
  /** Скільки з driveKm добито дорогою через OSRM, а не виміряно */
  filledKm: number;
  /** Скільки точок було в проміжку і скільки з них придатні для пробігу */
  pointsCount: number;
  trustedCount: number;
};

export async function shiftTrackKm(
  shiftId: string,
  from: Date | null,
  to: Date | null
): Promise<ShiftTrackKm | null> {
  const points = await prisma.trackPoint.findMany({
    where: {
      shiftId,
      ...(from || to
        ? { recordedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    orderBy: { recordedAt: "asc" },
    select: {
      lat: true,
      lng: true,
      accuracyM: true,
      recordedAt: true,
      roadMetersFromPrev: true,
    },
  });

  /**
   * Спершу довірені фікси, потім — геть вуса.
   *
   * Вус — це поодинока точка, що вистрілює на пів кілометра вбік і тим самим
   * місцем вертається за двадцять секунд, хоч сам прилад у ту мить звітує
   * нульову швидкість. У пробіг вона йде ДВІЧІ: у Джумаги 03.09 дев'ятнадцять
   * таких дали 14,4 зайвих кілометра.
   */
  const trusted = dropSpikes(
    points.filter((p) => p.accuracyM == null || p.accuracyM <= MAX_ACCURACY_M)
  );
  if (trusted.length < 2) return null;

  /**
   * Відстань КОЖНОГО проміжку окремо — і рахуємо її самі, а не беремо з
   * сегмента. `classifyMovement` міряє прямою (їй цього досить, щоб назвати
   * спосіб пересування), а нам у тих самих метрах потрібна дорога там, де
   * вона відома. Проміжок i лежить між trusted[i] і trusted[i+1].
   */
  const gapM: number[] = [];
  const gapRoadM: number[] = [];
  for (let i = 1; i < trusted.length; i++) {
    const road = trusted[i].roadMetersFromPrev;
    gapM.push(
      road != null
        ? road
        : haversineM(trusted[i - 1].lat, trusted[i - 1].lng, trusted[i].lat, trusted[i].lng)
    );
    gapRoadM.push(road ?? 0);
  }

  /**
   * Сегменти стикуються: `end` одного дорівнює `start` наступного, тож
   * кожен проміжок належить рівно одному сегментові й нічого не губиться.
   */
  const totals: Record<MoveMode, number> = { DRIVE: 0, WALK: 0, STOP: 0 };
  let filledM = 0;
  for (const seg of classifyMovement(trusted)) {
    for (let i = seg.start; i < seg.end; i++) {
      totals[seg.mode] += gapM[i];
      if (seg.mode === "DRIVE") filledM += gapRoadM[i];
    }
  }

  const km = (m: number) => Math.round(m / 100) / 10;
  return {
    driveKm: km(totals.DRIVE),
    walkKm: km(totals.WALK),
    stopKm: km(totals.STOP),
    filledKm: km(filledM),
    pointsCount: points.length,
    trustedCount: trusted.length,
  };
}

/**
 * Пробіг за GPS-треком зміни — одне число для сумісності зі старими
 * викликачами. Усе, що варто знати про його склад, — у `shiftTrackKm`.
 */
export async function gpsDistanceForShift(
  shiftId: string,
  from: Date | null = null,
  to: Date | null = null
): Promise<number | null> {
  const track = await shiftTrackKm(shiftId, from, to);
  return track ? track.driveKm : null;
}

/**
 * Усі числа треку, які лежать у картці зміни, — одним заходом.
 *
 * Існує, щоб їх не рахували по-різному в чотирьох місцях: закриття з фото,
 * закриття без фото, добивання одометра й нічний перерахунок. Кожне з них
 * раніше писало свій набір полів, і `afterWorkKm` то був, то ні.
 *
 * `trackKmAt` — мітка «коли рахували». Без неї число застигає назавжди:
 * зміну закривають о 17:00, а хвіст буфера доїжджає до 19:00, і в картці
 * назавжди лишається пробіг без останньої години дороги.
 */
export type ShiftTrackFields = {
  gpsDistanceKm: number | null;
  driveKm: number | null;
  walkKm: number | null;
  stopKm: number | null;
  filledKm: number | null;
  afterWorkKm: number | null;
  trackKmAt: Date;
};

export async function computeShiftTrackFields(shift: {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
}): Promise<ShiftTrackFields> {
  const work = await shiftTrackKm(shift.id, shift.startedAt, shift.endedAt);
  /**
   * Вечір рахуємо лише в закритої зміни, і теж лише їзду: дрейф приймача на
   * нічній стоянці інакше додав би людині «поїздок» після роботи.
   */
  const after = shift.endedAt ? await shiftTrackKm(shift.id, shift.endedAt, null) : null;

  return {
    gpsDistanceKm: work ? work.driveKm : null,
    driveKm: work ? work.driveKm : null,
    walkKm: work ? work.walkKm : null,
    stopKm: work ? work.stopKm : null,
    filledKm: work ? work.filledKm : null,
    afterWorkKm: after ? after.driveKm : null,
    trackKmAt: new Date(),
  };
}

/**
 * Чи є привід придивитися до пробігу зміни.
 *
 * Три перші причини фізичні: назад одометр не крутиться, більше за
 * MAX_DAILY_KM за день не проїде ніхто з розвозом по області, а нульовий
 * пробіг за годину роботи означає, що машина не рухалась.
 *
 * Четверта причина — нова й найкорисніша: одометр РІЗКО розходиться з
 * цілим треком. Саме так виглядали помилки, яких досі не бачив ніхто:
 * Джумага 03.09 закрив дев'ятигодинну зміну з різницею 18 км при 94 км за
 * треком, а 26.08 — 468 км при 105. Обидва числа введені руками, обидва
 * пройшли всі перевірки: вони правдоподібні самі по собі й неправдоподібні
 * поруч із маршрутом.
 *
 * Питаємо трек лише тоді, коли він цілий: у день, коли запис уривався,
 * менше число за GPS — норма, і мітка тут навчила б офіс її ігнорувати.
 */
export function isOdometerSuspicious(input: {
  distanceKm: number;
  durationMinutes: number;
  trackDriveKm?: number | null;
  trackComplete?: boolean;
}): boolean {
  const { distanceKm, durationMinutes } = input;
  if (distanceKm < 0 || distanceKm > MAX_DAILY_KM) return true;
  if (distanceKm === 0 && durationMinutes > 60) return true;

  if (input.trackComplete && input.trackDriveKm != null && input.trackDriveKm > 5) {
    const off = Math.abs(distanceKm - input.trackDriveKm) / input.trackDriveKm;
    if (off > ODOMETER_TRACK_TOLERANCE) return true;
  }
  return false;
}

/**
 * Наскільки одометр може розійтися з цілим треком, поки це не привід
 * питати. Третина — навмисно широко: трек має власний люфт, і мітка мусить
 * означати «тут справді дивно», а не «майже завжди».
 */
const ODOMETER_TRACK_TOLERANCE = 0.33;

/**
 * Закриває зміну, яку торговий забув закрити.
 *
 * Пробіг береться зі СТАРТУ наступної зміни: іншого числа просто не
 * існує — кінцевого фото немає, а одометр показує значення лише на
 * знімку. Тому в цей пробіг неминуче входить і вечір, і дорога додому.
 * Позначаємо це прапорцем, щоб цифра не видавалася за чисто робочу.
 */
export async function autoCloseForgotten(
  tx: Prisma.TransactionClient,
  forgotten: {
    id: string;
    startOdometer: number;
    startedAt: Date;
    /** Чи торговий уже закрив її ввечері, вказавши час без фото */
    closedLate?: boolean;
    /** Кілометри після закінчення роботи за GPS — якщо час відомий */
    afterWorkKm?: number | null;
    endedAt?: Date | null;
  },
  nextStartOdometer: number,
  /**
   * id зміни, яка її закрила. null, коли та ще не створена: часткового
   * унікального індексу «одна OPEN на людину» вистачає, щоб забута
   * зміна мусила закритися ПЕРШОЮ, а посилання дописалося другим кроком.
   */
  nextShiftId: string | null
): Promise<{
  id: string;
  distanceKm: number | null;
  startedAt: Date;
  afterWorkKm: number | null;
}> {
  const totalKm = nextStartOdometer - forgotten.startOdometer;
  const plausible = totalKm >= 0 && totalKm <= 5000;

  /**
   * Якщо торговий увечері закрив зміну «без фото, вказавши час», ми вже
   * знаємо за GPS, скільки з цього пробігу — дорога додому й вечір.
   * Віднімаємо їх, і в distanceKm лишається саме робоче.
   *
   * Без цього кроку весь вечір ліг би в робочий пробіг — і людину
   * питали б за кілометри, яких вона не намотувала по клієнтах.
   *
   * GPS занижений (трек іде по прямій між точками), тому віднімаємо
   * обережно: якщо оцінка більша за половину пробігу, щось не так —
   * краще лишити все як є й розібратися очима.
   */
  const after = forgotten.closedLate ? (forgotten.afterWorkKm ?? 0) : 0;
  const trustAfter = after > 0 && plausible && after < totalKm / 2;
  const workKm = trustAfter ? Math.round(totalKm - after) : totalKm;

  await tx.shift.update({
    where: { id: forgotten.id },
    data: {
      status: "ABANDONED",
      closedAutomatically: true,
      autoClosedByShiftId: nextShiftId,
      endOdometer: nextStartOdometer,
      // Джерела «AI» тут немає — число прийшло з наступної зміни, а не
      // з фото цієї. MANUAL найчесніше описує походження.
      endOdometerSource: "MANUAL" as OdometerSource,
      distanceKm: plausible ? workKm : null,
      odometerSuspicious: true,
      // Час закінчення не чіпаємо, якщо торговий уже вказав його сам:
      // його «о 17:20 я був удома» точніше за «зараз».
      ...(forgotten.endedAt ? {} : { endedAt: new Date() }),
      ...(trustAfter ? { afterWorkKm: after } : {}),
    },
  });

  return {
    id: forgotten.id,
    distanceKm: plausible ? workKm : null,
    startedAt: forgotten.startedAt,
    /** Скільки вечірніх кілометрів вдалося відняти від робочих */
    afterWorkKm: trustAfter ? after : null,
  };
}

/** Підсумок зміни для екрана застосунку й адмінки. */
export function summarize(shift: {
  id: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  startOdometer: number;
  endOdometer: number | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  gpsDistanceKm: number | null;
  odometerToGpsRatio: number | null;
  personalKm: number | null;
  odometerSuspicious: boolean;
  closedAutomatically: boolean;
}): ShiftSummary {
  return {
    id: shift.id,
    status: shift.status,
    startedAt: shift.startedAt,
    endedAt: shift.endedAt,
    startOdometer: shift.startOdometer,
    endOdometer: shift.endOdometer,
    distanceKm: shift.distanceKm,
    durationMinutes: shift.durationMinutes,
    gpsDistanceKm: shift.gpsDistanceKm,
    odometerToGpsRatio: shift.odometerToGpsRatio,
    personalKm: shift.personalKm,
    odometerSuspicious: shift.odometerSuspicious,
    closedAutomatically: shift.closedAutomatically,
  };
}
