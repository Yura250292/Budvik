/**
 * Перевірка розпізнаного одометра на здоровий глузд.
 *
 * Повертає вердикт, а не кидає виняток: торговий має бачити, що саме
 * система прочитала і чому засумнівалася. «Помилка 422» на екрані
 * людини в машині не пояснює нічого.
 *
 * Милі свідомо НЕ конвертуються. Був реальний випадок, коли модель
 * побачила «MPH» біля стрілки спідометра, вирішила, що одометр у милях,
 * і 91 300 перетворилося на 146 936. Число з табло беремо як є.
 */

import type { OdometerRead } from "./recognize";

/** Нижче цього — не пробіг, а помилка читання. */
export const MIN_PLAUSIBLE_ODOMETER = 100;
/** Вище цього одометр не буває навіть у старого буса. */
export const MAX_PLAUSIBLE_ODOMETER = 2_000_000;
/** Більше за день не проїде ніхто з розвозом по області. */
export const MAX_DAILY_KM = 1500;
/** Нижче цього впевненість AI не варта підтвердження без погляду людини. */
export const MIN_CONFIDENCE = 0.7;

export type OdometerVerdict = {
  /** Чи можна приймати це число без правки людини */
  ok: boolean;
  value: number | null;
  /** Причина відмови — код, за яким UI підбирає текст */
  reason:
    | "not_read"
    | "not_a_number"
    | "implausible_range"
    | "trip_meter"
    | "less_than_start"
    | "too_far"
    | null;
  /** Не блокують, але людині варто глянути */
  warnings: Array<
    "few_digits" | "low_confidence" | "zero_distance" | "below_previous" | "far_from_track"
  >;
  /** Пробіг відносно точки відліку, якщо вона відома */
  deltaKm: number | null;
};

export type ValidateContext = {
  /**
   * Число, від якого рахується пробіг: для закриття зміни — її стартовий
   * одометр, для відкриття — кінцевий одометр попередньої зміни.
   */
  previousValue?: number | null;
  /** Чи це закриття зміни: там від'ємна різниця неможлива в принципі */
  isClosing?: boolean;
  /**
   * Скільки кілометрів проїхано за треком (лише їзда), якщо трек цілий.
   *
   * Друга думка про число, і єдина, яка в нас є. У Джумаги всі показання
   * вводяться руками, і 03.09 він закрив дев'ятигодинну зміну з різницею
   * 18 км при 94 км за треком — описка в одній цифрі, якої не бачив ніхто.
   * Зворотний випадок 26.08: 468 км одометра проти 105 за треком.
   *
   * Порівнювати можна лише з ПОВНИМ треком: у дні, коли запис уривався,
   * менше число за GPS — норма, і сваритися на нього означало б навчити
   * людей ігнорувати попередження.
   */
  trackDriveKm?: number | null;
  trackComplete?: boolean;
};

/**
 * У скільки разів одометр може розійтися з треком, поки це ще не дивно.
 *
 * Знизу вдвічі, зверху втричі — навмисно ширше за колір у картці (0,8–1,3):
 * там це підказка для ока, тут — попередження людині в машині, і хибне
 * спрацювання коштує довіри до всіх інших.
 */
const TRACK_MIN_RATIO = 0.5;
const TRACK_MAX_RATIO = 3;

export function validateOdometer(
  read: OdometerRead,
  ctx: ValidateContext = {}
): OdometerVerdict {
  const warnings: OdometerVerdict["warnings"] = [];
  const prev = ctx.previousValue ?? null;

  if (read.value == null) {
    return { ok: false, value: null, reason: "not_read", warnings, deltaKm: null };
  }
  if (!Number.isFinite(read.value) || !Number.isInteger(read.value)) {
    return { ok: false, value: read.value, reason: "not_a_number", warnings, deltaKm: null };
  }
  if (read.value < MIN_PLAUSIBLE_ODOMETER || read.value > MAX_PLAUSIBLE_ODOMETER) {
    return { ok: false, value: read.value, reason: "implausible_range", warnings, deltaKm: null };
  }
  // Модель сама зізналася, що дивиться на добовий лічильник.
  if (read.isTripMeter) {
    return { ok: false, value: read.value, reason: "trip_meter", warnings, deltaKm: null };
  }

  const deltaKm = prev != null ? read.value - prev : null;

  if (deltaKm != null) {
    // Одометр не крутиться назад. При закритті це завжди помилка читання
    // (або не той автомобіль), при відкритті — привід підсвітити.
    if (deltaKm < 0) {
      if (ctx.isClosing) {
        return { ok: false, value: read.value, reason: "less_than_start", warnings, deltaKm };
      }
      warnings.push("below_previous");
    }
    if (deltaKm > MAX_DAILY_KM) {
      return { ok: false, value: read.value, reason: "too_far", warnings, deltaKm };
    }
    if (deltaKm === 0) warnings.push("zero_distance");
  }

  /**
   * Трек як друга думка. Не блокує НІКОЛИ: він сам буває неповним, і
   * зупинити людину на закритті зміни через здогадку було б гірше за
   * помилку в цифрі, яку офіс однаково побачить у звірці.
   */
  if (
    deltaKm != null &&
    ctx.trackComplete &&
    ctx.trackDriveKm != null &&
    ctx.trackDriveKm > 5 &&
    (deltaKm < ctx.trackDriveKm * TRACK_MIN_RATIO || deltaKm > ctx.trackDriveKm * TRACK_MAX_RATIO)
  ) {
    warnings.push("far_from_track");
  }

  if (read.digits != null && read.digits <= 4) warnings.push("few_digits");
  if (read.confidence != null && read.confidence < MIN_CONFIDENCE) {
    warnings.push("low_confidence");
  }

  return { ok: true, value: read.value, reason: null, warnings, deltaKm };
}

/** Людський текст вердикту — щоб UI не збирав його з коду по шматках. */
export function verdictMessage(v: OdometerVerdict): string | null {
  switch (v.reason) {
    case "not_read":
      return "Не вдалося прочитати число. Сфотографуйте панель ближче й без відблисків.";
    case "not_a_number":
      return "Прочитане не схоже на показання одометра.";
    case "implausible_range":
      return `Число ${v.value} не схоже на пробіг.`;
    case "trip_meter":
      return "Це схоже на добовий лічильник (TRIP), а не загальний пробіг (ODO).";
    case "less_than_start":
      return "Показання менші за стартові. Перевірте, чи це та сама машина.";
    case "too_far":
      return `Різниця ${v.deltaKm} км завелика для одного дня — перевірте число.`;
    default:
      return null;
  }
}

/**
 * Розбір числа, введеного руками.
 *
 * Терпить «187 452», «187,452», «187452 км» — люди пишуть по-різному, і
 * відмова через пробіл дратувала б на рівному місці.
 */
export function parseOdometerText(text: string): number | null {
  const digits = text.replace(/[\s,._]/g, "").replace(/км$/i, "").trim();
  if (!/^\d{3,7}$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}
