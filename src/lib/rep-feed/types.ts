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
 * клієнта, проведена чи зібрана накладна, повернення. Кожна подія — рядок у
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
  /** Що відкривати з рядка: counterpartyId для оплати, salesDocumentId для решти. */
  relatedId: string;
  /** Сторінка кабінету для пуша (те саме, що дає feedHref). */
  target: string;
  title: string;
  body: string;
  /** Момент події для порядку в стрічці. */
  at: Date;
};

/**
 * Куди веде рядок сповіщення.
 *
 * Оплата — на картку клієнта: там борг, історія й памʼять про нього.
 * Усе інше, включно зі старими типами (WHOLESALE_ORDER_REQUEST,
 * SALES_DOC_CONFIRMED), — на документ, як і було до стрічки.
 */
export function feedHref(type: string, relatedId: string | null | undefined): string | null {
  if (!relatedId) return null;
  if (type === REP_FEED_TYPES.PAYMENT) return `/sales/clients/${relatedId}`;
  return `/sales/orders/${relatedId}`;
}
