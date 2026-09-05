/**
 * Українські формулювання для відповідей, які пише код, а не модель.
 *
 * Модель ставить відмінки й множину сама — і саме тому їй платять токенами.
 * Коли відповідь складає код, ці дрібниці доводиться робити руками:
 * «12 днів», «1 день», «22 дні». Машинне «12 днів(я)» у кабінеті читається
 * як недороблена програма, і довіра до цифри поруч зникає разом із ним.
 */

const NBSP = " ";

/** «12 300 ₴» — нерозривні пробіли, без копійок. */
export function money(value: number): string {
  const n = Math.round(value ?? 0);
  /**
   * Мінус лишається.
   *
   * Раніше сума бралася за модулем, і в таблі команди торговий із
   * оборотом -710 ₴ (повернень більше, ніж продажів) стояв поруч із тим,
   * хто продав на 710 ₴, — однаковим числом.
   */
  return `${n < 0 ? "-" : ""}${String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}₴`;
}

/** «7,5 %» — кома, нерозривний пробіл, без зайвого нуля. */
export function percent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",");
  return `${text}${NBSP}%`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  const twoLast = abs % 100;
  if (twoLast >= 11 && twoLast <= 14) return many;
  const last = abs % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export const days = (n: number) => `${Math.abs(Math.round(n))} ${plural(n, "день", "дні", "днів")}`;
export const times = (n: number) => `${n} ${plural(n, "раз", "рази", "разів")}`;
export const clients = (n: number) => `${n} ${plural(n, "клієнт", "клієнти", "клієнтів")}`;
export const items = (n: number) => `${n} ${plural(n, "позиція", "позиції", "позицій")}`;
export const points = (n: number) => `${n} ${plural(n, "точка", "точки", "точок")}`;

/** Назви місяців у називному — для заголовка прогнозу. */
const MONTHS = [
  "січень", "лютий", "березень", "квітень", "травень", "червень",
  "липень", "серпень", "вересень", "жовтень", "листопад", "грудень",
];

/** «2026-09» → «вересень». Рік дописуємо лише чужий, свій і так зрозумілий. */
export function monthLabel(monthKey: string, today = ""): string {
  const [y, m] = monthKey.split("-").map(Number);
  const name = MONTHS[(m || 1) - 1] ?? monthKey;
  return today.slice(0, 4) === String(y) ? name : `${name} ${y}`;
}

/** Посилання на картку клієнта в кабінеті. */
export const clientLink = (id: string, name: string) => `[${name}](/sales/clients/${id})`;

/**
 * Посилання на товар — пошуком у каталозі за артикулом.
 *
 * Картки товару в кабінеті торгового немає; без артикула лишається просто
 * назва, бо пошук за назвою з пробілами дає випадковий результат.
 */
export const productLink = (name: string, sku: string | null) =>
  sku ? `[${name}](/sales/catalog/list?search=${encodeURIComponent(sku)})` : name;

/**
 * «пʼятницю, 4 вересня» — те, що стає після «План на …».
 *
 * Відмінок доводиться підставляти руками: Intl дає лише називний, і
 * заголовок виходив «План на пʼятниця».
 */
export function planDayLabel(iso: string, weekdayAccusative: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  const dm = date.toLocaleDateString("uk-UA", { day: "numeric", month: "long", timeZone: "UTC" });
  return `${weekdayAccusative}, ${dm}`;
}
