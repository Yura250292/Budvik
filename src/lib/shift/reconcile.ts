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
import { computeShiftTrackFields, isOdometerSuspicious, shiftTrackKm } from "@/lib/shift/service";
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
  const track = await computeShiftTrackFields({ ...shift, endedAt });

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
      ...track,
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
export async function recountAfterWorkKm(
  shiftId: string,
  startedAt: Date,
  endedAt: Date | null
): Promise<number | null> {
  if (!endedAt) return null;
  // Саме `shiftTrackKm`, а не `computeShiftTrackFields`: тому потрібен лише
  // вечір, а той порахував би заразом і робочий трек — двічі прочитавши
  // тисячі точок на кожному відкритті зміни.
  const after = await shiftTrackKm(shiftId, endedAt, null);
  return after ? after.driveKm : null;
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
   * Перераховуємо ЗАВЖДИ, а не лише коли зсунувся час.
   *
   * Одометр добивають зранку наступного дня — тобто через багато годин
   * після закриття, і за цей час у зміну дійшов увесь хвіст буфера. Стара
   * умова «лише якщо час змінився» лишала в картці пробіг, порахований на
   * половині точок.
   */
  const track = await computeShiftTrackFields({ ...shift, endedAt });
  const workKm = track.driveKm;

  const distanceKm = opts.endOdometer - shift.startOdometer;
  const durationMinutes = Math.round((endedAt.getTime() - shift.startedAt.getTime()) / 60_000);
  const ratio = workKm != null && workKm > 0 ? Math.round((distanceKm / workKm) * 100) / 100 : null;

  /**
   * Те саме правило, що й у звичайному закритті. Трек тут свідомо НЕ
   * вважаємо цілим: число приходить наступного ранку зі старту наступної
   * зміни, тобто описує день разом із вечором, і порівнювати його з
   * робочим треком означало б лаятися на кожну забуту зміну.
   */
  const odometerSuspicious = isOdometerSuspicious({ distanceKm, durationMinutes });

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
      ...track,
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
