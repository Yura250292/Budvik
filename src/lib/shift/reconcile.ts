/**
 * Зведення зміни, у якої немає фінішного фото.
 *
 * Таких шляхів три, і всі вони раніше писали в базу самі по собі:
 * пізнє закриття з застосунку, автозакриття ввечері з воркера й правка
 * офісу з адмінки. Логіка в них одна — «час закінчення відомий, одометр
 * ні» — і розкидана по трьох місцях вона неминуче розійшлася б: досить
 * забути один прапорець, і зміна не потрапить ні в чергу підтвердження,
 * ні в ранкове добивання одометром.
 *
 * Тому запис живе тут, а роути лише вирішують, ЧИ закривати і ЧИМ
 * пояснити людині те, що сталося.
 */

import { prisma } from "@/lib/prisma";
import type { OdometerSource, Prisma } from "@prisma/client";
import { gpsKmBetween } from "@/lib/shift/late-close";
import { MAX_DAILY_KM } from "@/lib/odometer/validate";
import { kyivTime } from "@/lib/date/kyiv";

/** Звідки взявся час закінчення. Значення лягають у Shift.lateCloseSource. */
export type LateCloseSource =
  /** Підказка треку, підтверджена людиною в застосунку */
  | "GPS"
  /** Людина вказала час руками */
  | "MANUAL"
  /** Воркер: машина стала надовго, час = момент зупинки */
  | "AUTO_GPS"
  /**
   * Воркер: зупинку знайдено, але трек мовчав перед нею — час є лише
   * верхньою межею, а не виміром.
   */
  | "AUTO_GAP"
  /** Воркер: трек помер, час = остання відома точка */
  | "AUTO_DEAD"
  /** Воркер: машина ще їхала, але час вийшов — найменш надійне */
  | "AUTO_FORCED"
  /** Офіс закрив із адмінки */
  | "OFFICE";

/** Чи закрив зміну автомат, а не людина. */
export function isAutomatic(source: LateCloseSource): boolean {
  return source.startsWith("AUTO_");
}

export type ShiftForClose = {
  id: string;
  startedAt: Date;
  startOdometer: number;
};

/**
 * Закриває зміну без фінішного фото.
 *
 * Статус ABANDONED, а не CLOSED, — навмисно. Пробігу за одометром ще
 * немає, і видавати таку зміну за нормально закриту означало б сховати
 * те, що її треба буде звірити зранку. CLOSED вона стане тільки тоді,
 * коли хтось назве кінцевий одометр (див. applyEndOdometer).
 */
export async function closeWithoutPhoto(
  tx: Prisma.TransactionClient,
  shift: ShiftForClose,
  opts: {
    endedAt: Date;
    source: LateCloseSource;
    /** Пояснення в картці зміни: чому вона закрита саме так */
    notes?: string;
  }
) {
  const { endedAt, source } = opts;

  /**
   * Кілометри ділимо надвоє саме тут, поки час свіжий: до endedAt —
   * робочі, після — дорога додому й вечір. Одометр цього не вміє в
   * принципі, він знає лише підсумок між двома фото.
   */
  const workKm = await gpsKmBetween(shift.id, shift.startedAt, endedAt);
  const afterWorkKm = await gpsKmBetween(shift.id, endedAt, null);

  const durationMinutes = Math.round((endedAt.getTime() - shift.startedAt.getTime()) / 60_000);

  return tx.shift.update({
    where: { id: shift.id },
    data: {
      status: "ABANDONED",
      endedAt,
      durationMinutes,
      closedLate: true,
      lateCloseSource: source,
      // Прапорець «закрито не людиною» читає адмінка (бейдж «· авто») і
      // звіти ефективності водіїв — там він уже враховується.
      closedAutomatically: isAutomatic(source),
      gpsDistanceKm: workKm,
      afterWorkKm,
      // Підозра стоїть, бо одометра немає. Причину видно з
      // lateCloseSource і notes — це не просто червоний прапорець.
      odometerSuspicious: true,
      notes: opts.notes ?? "Закрито без фінішного фото одометра",
    },
  });
}

/**
 * Скільки кілометрів після роботи людина намотала НАСПРАВДІ.
 *
 * Вечірні кілометри рахуються на момент закриття — але ввечері людина
 * ще може поїхати в магазин, і ті точки долітають пізніше, вже з фазою
 * AFTER_SHIFT. Тому перед тим, як віднімати вечір від пробігу, число
 * треба перерахувати: інакше зайві кілометри лягають у робочі, і за них
 * питають з торгового.
 */
export async function recountAfterWorkKm(shiftId: string, endedAt: Date | null): Promise<number | null> {
  if (!endedAt) return null;
  return gpsKmBetween(shiftId, endedAt, null);
}

/**
 * Проставляє кінцевий одометр зміні, яка закрилася без фото.
 *
 * Число може прийти від торгового («я запам'ятав»), від офісу (з
 * паперового листа) або з ранкового фото наступної зміни. Похідні
 * рахуються тими самими формулами, що й у звичайному закритті, — інакше
 * дві однакові зміни мали б різні цифри залежно від шляху.
 */
export async function applyEndOdometer(
  tx: Prisma.TransactionClient,
  shift: {
    id: string;
    startedAt: Date;
    startOdometer: number;
    endedAt: Date | null;
    gpsDistanceKm: number | null;
    afterWorkKm: number | null;
  },
  opts: {
    endOdometer: number;
    /** Виправлений час закінчення, якщо людина його теж уточнила */
    endedAt?: Date;
    source: OdometerSource;
  }
) {
  const endedAt = opts.endedAt ?? shift.endedAt ?? new Date();

  /**
   * Час міг зсунутися — тоді й розподіл кілометрів між роботою та
   * вечором інший. Перераховуємо обидва числа, а не одне.
   */
  const timeChanged = opts.endedAt != null && opts.endedAt.getTime() !== shift.endedAt?.getTime();
  const workKm = timeChanged
    ? await gpsKmBetween(shift.id, shift.startedAt, endedAt)
    : shift.gpsDistanceKm;
  const afterWorkKm = timeChanged
    ? await gpsKmBetween(shift.id, endedAt, null)
    : shift.afterWorkKm;

  const distanceKm = opts.endOdometer - shift.startOdometer;
  const durationMinutes = Math.round((endedAt.getTime() - shift.startedAt.getTime()) / 60_000);
  const ratio = workKm != null && workKm > 0 ? Math.round((distanceKm / workKm) * 100) / 100 : null;

  // Те саме правило, що й у звичайному закритті (api/shift/close).
  const odometerSuspicious =
    distanceKm < 0 || distanceKm > MAX_DAILY_KM || (distanceKm === 0 && durationMinutes > 60);

  return tx.shift.update({
    where: { id: shift.id },
    data: {
      /**
       * Одометр є — зміна нарешті повноцінна, тому CLOSED. Слід того,
       * що фінішного фото не було, лишається в closedLate і
       * lateCloseSource: історію не переписуємо, лише добиваємо цифру.
       */
      status: "CLOSED",
      endedAt,
      endOdometer: opts.endOdometer,
      endOdometerSource: opts.source,
      distanceKm: distanceKm >= 0 ? distanceKm : null,
      durationMinutes,
      gpsDistanceKm: workKm,
      afterWorkKm,
      odometerToGpsRatio: ratio,
      odometerSuspicious,
    },
  });
}

/**
 * Наступна зміна тієї самої людини — стеля для валідації.
 *
 * Кінцевий одометр не може бути більшим за стартовий наступної зміни, а
 * час закінчення — пізнішим за її початок. Без цієї перевірки одна
 * описка робить обидві зміни неправдоподібними.
 */
export async function nextShiftOf(userId: string, startedAt: Date) {
  return prisma.shift.findFirst({
    where: { userId, startedAt: { gt: startedAt } },
    orderBy: { startedAt: "asc" },
    select: { id: true, startedAt: true, startOdometer: true },
  });
}

/** Пояснення для картки зміни: чому вона закрита саме так і саме тоді. */
export function autoCloseNote(source: LateCloseSource, stoodSince: Date | null): string {
  switch (source) {
    case "AUTO_GPS":
      return `Закрито автоматично: машина стояла з ${stoodSince ? kyivTime(stoodSince) : "невідомо"}`;
    case "AUTO_GAP":
      return (
        `Закрито автоматично о ${stoodSince ? kyivTime(stoodSince) : "невідомо"}, але трек ` +
        `мовчав перед цим — робота могла скінчитися раніше`
      );
    case "AUTO_DEAD":
      return `Закрито автоматично: трек обірвався${stoodSince ? ` о ${kyivTime(stoodSince)}` : ""}`;
    case "AUTO_FORCED":
      return "Закрито автоматично за часом: зміна тривала надто довго";
    case "OFFICE":
      return "Закрито офісом з адмінки";
    default:
      return "Закрито заднім числом без фінішного фото";
  }
}
