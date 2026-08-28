/**
 * Дати й час робочих екранів — київські, з готовими форматерами.
 *
 * Кожен виклик `toLocaleTimeString` будує `Intl.DateTimeFormat` заново, а
 * побудова коштує на порядок дорожче за саме форматування. На екрані дня водія
 * час малюється в кожному рядку маршруту, тож на довгому дні це десятки зайвих
 * побудов на один прокрут. Тут форматери створені один раз на модуль.
 *
 * Часовий пояс заданий явно: сервер віддає UTC, планшет може стояти будь-де, а
 * зміна рахується за київським днем.
 */

const TZ = "Europe/Kyiv";

/** Пристрій без ICU лишить нас без форматера — тоді малюємо запасний текст. */
function make(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat("uk-UA", { timeZone: TZ, ...options });
  } catch {
    return null;
  }
}

const TIME = make({ hour: "2-digit", minute: "2-digit" });
const DAY_SHORT = make({ day: "2-digit", month: "2-digit" });
const DAY_MONTH = make({ day: "numeric", month: "long" });
const DAY_MONTH_PADDED = make({ day: "2-digit", month: "long" });
const TODAY = make({ weekday: "long", day: "numeric", month: "long" });
const WHEN = make({ day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });

function run(fmt: Intl.DateTimeFormat | null, iso: string, fallback: string): string {
  if (!fmt) return fallback;
  const d = new Date(iso);
  // Порожній рядок і зіпсована дата дають Invalid Date: у одних рушіях це
  // виняток, у інших — текст «Invalid Date» просто в інтерфейсі. Обидва
  // варіанти гірші за прочерк.
  if (Number.isNaN(d.getTime())) return fallback;
  try {
    return fmt.format(d);
  } catch {
    return fallback;
  }
}

/** «09:42» */
export function formatTime(iso: string): string {
  return run(TIME, iso, "—");
}

/** «28.08» */
export function formatDayShort(iso: string): string {
  return run(DAY_SHORT, iso, "—");
}

/** «28 серпня» */
export function formatDayMonth(iso: string): string {
  return run(DAY_MONTH, iso, "—");
}

/**
 * «08 серпня» — те саме, що `formatDayMonth`, але з нулем попереду.
 *
 * Розбіжність історична: історія змін пише день двома цифрами, картка зміни —
 * однією. Зводити їх в один формат тут не можна, це змінило б вигляд екранів.
 */
export function formatDayMonthPadded(iso: string): string {
  return run(DAY_MONTH_PADDED, iso, "—");
}

/** «четвер, 28 серпня» — надзаголовок шапки зміни. */
export function formatToday(): string {
  if (!TODAY) return "Зміна";
  try {
    return TODAY.format(new Date());
  } catch {
    return "Зміна";
  }
}

/** «28 серпня, 09:42» */
export function formatWhen(iso: string): string {
  return run(WHEN, iso, "—");
}
