/**
 * Стрічка подій торгового — типи й посилання.
 *
 * Цей файл чистий: без Prisma, без next/*. Його імпортує і воркер, і
 * головна кабінету (щоб малювати посилання за типом рядка), тож нічого
 * серверного сюди класти не можна.
 *
 * Навіщо стрічка взагалі. Торговий відкриває застосунок двічі на день —
 * відкрити й закрити зміну, — а замовлення робить в іншій програмі. Удень
 * його в застосунок нічого не кличе. Стрічка дає приводи: оплата від
 * клієнта, проведена чи зібрана накладна, повернення, картка клієнта, біля
 * якого зупинилась машина, список, кому подзвонити. Кожна подія — рядок у
 * `Notification` з префіксом `REP_` і, у робочі години, пуш із глибоким
 * посиланням. Побічно кожен тап — вихід застосунку на передній план, де
 * оживає трек (mobile/src/track/use-track-health.ts).
 */

export const REP_FEED_PREFIX = "REP_";

export const REP_FEED_TYPES = {
  /** Клієнт заплатив у касу (ПКО з 1С, рознесене на торгового). */
  PAYMENT: "REP_PAYMENT",
  /** Офіс провів видаткову накладну за замовленням торгового. */
  DOC_POSTED: "REP_DOC_POSTED",
  /** Склад зібрав накладну повністю. */
  DOC_PICKED: "REP_DOC_PICKED",
  /** Проведено повернення від клієнта. */
  RETURN: "REP_RETURN",
  /** Водій відмітив доставку. */
  DOC_DELIVERED: "REP_DOC_DELIVERED",
  /** Машина зупинилась біля клієнта: борг, останнє замовлення, що поповнити. */
  VISIT: "REP_VISIT",
  /** Щоденний список «кому подзвонити» об 11:00. */
  CALL_LIST: "REP_CALL_LIST",
  /** Прихід товару, який беруть клієнти торгового (раз на день о 10:00). */
  ARRIVAL: "REP_ARRIVAL",
  /** Накладна потрапила в маршрутний лист 1С. */
  ROUTE: "REP_ROUTE",
  /** Приїхав товар, на який торговий поставив «повідомити, коли буде». */
  WATCH: "REP_WATCH",
  /** Подорожчали позиції, які беруть клієнти торгового (раз на ранок). */
  PRICE_UP: "REP_PRICE_UP",
} as const;

export type RepFeedType = (typeof REP_FEED_TYPES)[keyof typeof REP_FEED_TYPES];

const ALL_TYPES = new Set<string>(Object.values(REP_FEED_TYPES));

export function isRepFeedType(type: string): type is RepFeedType {
  return ALL_TYPES.has(type);
}

/** Одна подія стрічки — те, що стане рядком Notification і, можливо, пушем. */
export type FeedEvent = {
  type: RepFeedType;
  repId: string;
  /** Унікальний ключ події; повтор — не помилка, а «вже знаємо». */
  dedupKey: string;
  /**
   * Що відкривати з рядка: counterpartyId для оплати й візиту,
   * salesDocumentId для документів, нічого — для списку дзвінків.
   */
  relatedId: string | null;
  /** Сторінка кабінету для пуша (те саме, що дає feedHref). */
  target: string;
  title: string;
  body: string;
  /** Момент події для порядку в стрічці. */
  at: Date;
  /**
   * Свій пуш, ніколи не в групі. Картка перед візитом і список дзвінків
   * втрачають сенс у заголовку «3 події у клієнтів».
   */
  standalone?: boolean;
};

/**
 * Куди веде рядок сповіщення.
 *
 * Оплата й візит — на картку клієнта: там борг, історія й памʼять про
 * нього. Список дзвінків — на список клієнтів. Усе інше, включно зі старими
 * типами (WHOLESALE_ORDER_REQUEST, SALES_DOC_CONFIRMED), — на документ, як
 * і було до стрічки.
 */
export function feedHref(type: string, relatedId: string | null | undefined): string | null {
  if (type === REP_FEED_TYPES.CALL_LIST) return "/sales/clients";
  if (type === REP_FEED_TYPES.WATCH) return "/sales/watches";
  if (!relatedId) return null;
  // День у шляху, а не в ?day=: білий список тапів застосунку
  // (notification-taps.ts, CABINET_TARGET) параметрів запиту не пропускає.
  if (type === REP_FEED_TYPES.ARRIVAL) return `/sales/arrivals/${relatedId}`;
  if (type === REP_FEED_TYPES.PRICE_UP) return `/sales/price-changes/${relatedId}`;
  if (type === REP_FEED_TYPES.PAYMENT || type === REP_FEED_TYPES.VISIT) {
    return `/sales/clients/${relatedId}`;
  }
  return `/sales/orders/${relatedId}`;
}

/**
 * Фільтри сторінки стрічки: одна таблетка — кілька типів. Спільні для
 * кабінету торгового й адмінки, тож і назви однакові.
 */
export const FEED_FILTERS = [
  { key: "all", label: "Усі", types: null },
  { key: "money", label: "Оплати", types: [REP_FEED_TYPES.PAYMENT] },
  {
    key: "docs",
    label: "Накладні",
    types: [
      REP_FEED_TYPES.DOC_POSTED,
      REP_FEED_TYPES.DOC_PICKED,
      REP_FEED_TYPES.ROUTE,
      REP_FEED_TYPES.DOC_DELIVERED,
    ],
  },
  { key: "returns", label: "Повернення", types: [REP_FEED_TYPES.RETURN] },
  { key: "arrivals", label: "Товар", types: [REP_FEED_TYPES.ARRIVAL, REP_FEED_TYPES.WATCH, REP_FEED_TYPES.PRICE_UP] },
  { key: "tips", label: "Підказки", types: [REP_FEED_TYPES.VISIT, REP_FEED_TYPES.CALL_LIST] },
] as const satisfies readonly { key: string; label: string; types: readonly RepFeedType[] | null }[];

export type FeedFilterKey = (typeof FEED_FILTERS)[number]["key"];

/** Типи для фільтра; null — усі типи стрічки. Невідомий ключ = «усі». */
export function filterTypes(key: string | null | undefined): RepFeedType[] | null {
  const f = FEED_FILTERS.find((x) => x.key === key);
  return f?.types ? [...f.types] : null;
}
