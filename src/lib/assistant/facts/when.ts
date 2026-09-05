/**
 * «У пʼятницю», «завтра о девʼятій», «через тиждень» — у мить часу.
 *
 * Розбір датою в коді, а не моделлю, з тієї ж причини, що й решта
 * швидкого шляху: це найчастіші формулювання, вони коротко описуються
 * правилами, і платити за них 15 тисяч токенів немає за що. Незвичне
 * формулювання правила не впізнають — тоді питання йде моделі, і вона
 * ставить нагадування інструментом.
 *
 * ЧАС ЗА ЗАМОВЧУВАННЯМ — 9:00 за Києвом. Нагадування без години означає
 * «на початок робочого дня»: о 3-й ночі воно розбудить, а о 18:00 —
 * запізниться.
 */

import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { shiftDay } from "@/lib/analytics/period";

/** Година за замовчуванням, якщо в питанні її немає. */
const DEFAULT_HOUR = 9;

const WEEKDAYS: Array<[RegExp, number]> = [
  [/понеділ/i, 1],
  [/вівтор/i, 2],
  [/серед/i, 3],
  [/четвер/i, 4],
  [/п.?ятниц/i, 5],
  [/субот/i, 6],
  [/неділ/i, 7],
];

export type ParsedWhen = { at: Date; day: string; hour: number; minute: number };

/**
 * Мить, на яку ставити нагадування, або null — якщо дати в тексті немає.
 *
 * `today` — київська дата у форматі YYYY-MM-DD.
 */
export function parseWhen(text: string, today: string): ParsedWhen | null {
  const day = parseDay(text, today);
  if (!day) return null;

  const time = /(?:^|\s)(?:о|об)\s*(\d{1,2})(?:[:.](\d{2}))?/i.exec(text);
  let hour = time ? Number(time[1]) : DEFAULT_HOUR;
  const minute = time && time[2] ? Number(time[2]) : 0;

  // «о 8 вечора» — та сама вісімка, але ввечері.
  if (/вечор|ввечері/i.test(text) && hour < 12) hour += 12;
  if (hour > 23 || minute > 59) return null;

  const at = new Date(kyivDayStart(day).getTime() + hour * 3_600_000 + minute * 60_000);
  return { at, day, hour, minute };
}

function parseDay(text: string, today: string): string | null {
  if (/післязавтра/i.test(text)) return shiftDay(today, 2);
  if (/завтра/i.test(text)) return shiftDay(today, 1);
  if (/сьогодні|за\s+годину|через\s+годину/i.test(text)) return today;

  const inDays = /через\s+(\d{1,2})\s*(дн|день|дні|днів)/i.exec(text);
  if (inDays) return shiftDay(today, Math.min(365, Number(inDays[1])));
  if (/через\s+тиждень/i.test(text)) return shiftDay(today, 7);
  if (/через\s+два\s+тижні/i.test(text)) return shiftDay(today, 14);
  if (/через\s+місяць/i.test(text)) return shiftDay(today, 30);

  // «12.09» або «12.09.2026»
  const exact = /(?:^|\s)(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{4}))?/.exec(text);
  if (exact) {
    const [, d, m, y] = exact;
    const year = y ? Number(y) : Number(today.slice(0, 4));
    const iso = `${year}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
    if (!Number.isNaN(new Date(`${iso}T12:00:00Z`).getTime())) {
      // Дата без року, яка вже минула, означає наступний рік.
      return iso < today && !y ? `${year + 1}${iso.slice(4)}` : iso;
    }
  }

  /**
   * День тижня — це НАСТУПНИЙ такий день, а не сьогоднішній.
   *
   * «Нагадай у пʼятницю», сказане в пʼятницю, означає наступну: те, що
   * мало статися сьогодні, торговий не відкладає на пізніше в той самий
   * день — він каже «через годину».
   */
  for (const [re, target] of WEEKDAYS) {
    if (!re.test(text)) continue;
    const current = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const ahead = ((target - current + 7) % 7) || 7;
    return shiftDay(today, ahead);
  }

  return null;
}

/** «завтра о 9:00» — як сказати людині, коли саме нагадаємо. */
export function whenLabel(parsed: ParsedWhen, today: string): string {
  const day =
    parsed.day === today
      ? "сьогодні"
      : parsed.day === shiftDay(today, 1)
        ? "завтра"
        : parsed.day.split("-").reverse().slice(0, 2).join(".");
  const time = `${parsed.hour}:${String(parsed.minute).padStart(2, "0")}`;
  return `${day} о ${time}`;
}

/** Сьогоднішня київська дата — щоб не тягнути kyivDate по всьому коду. */
export const kyivToday = () => kyivDate(new Date());
