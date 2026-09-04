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
const ROUTE_DAY = make({ day: "numeric", month: "long", weekday: "short" });

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

/**
 * «Сьогодні» / «Учора» / «Завтра» / «3 вересня, ср» — назва дня маршруту.
 *
 * Без року: у кабінеті водія всі листи свіжі, і рік лише з'їдає ширину
 * рядка на телефоні. Копія тієї самої функції з сайту
 * (src/components/driver/RoutePicker.tsx): шторка вибору мусить називати
 * дні однаково у вебі й у застосунку, інакше водій вирішить, що це різні
 * списки.
 *
 * `day` і `today` — київські дати у форматі YYYY-MM-DD.
 */
export function formatRouteDay(day: string, today: string): string {
  if (day === today) return "Сьогодні";
  if (day === shiftDay(today, -1)) return "Учора";
  if (day === shiftDay(today, 1)) return "Завтра";

  // Опівдні за UTC — щоб зсув поясу не переніс дату на сусідню добу.
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return run(ROUTE_DAY, parsed.toISOString(), day);
}

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

/**
 * Сьогоднішня київська доба у вигляді YYYY-MM-DD.
 *
 * en-CA дає рівно цей формат без ручного складання рядка; `toISOString()`
 * тут не годиться — він віддає UTC, а київський день починається на дві-три
 * години раніше, і ввечері дата була б учорашньою.
 */
export function kyivToday(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    // Пристрій без ICU: краще вважати днем сьогодні, ніж заблокувати відмітки.
    return new Date().toISOString().slice(0, 10);
  }
}
