/**
 * Роздріб з опту — для товарів, у яких в 1С немає роздрібної ціни.
 *
 * Агент тягне два типи цін: «6.МАГАЗИНИ» (роздріб) і «4.ОПТ». У TOTAL і POLAX
 * роздрібного типу в 1С немає взагалі — вони продаються за оптом, — тож сайт
 * рахує роздріб сам: опт × коефіцієнт бренду (Brand.retailMarkup) або
 * загальний. 1,3 — не з голови: у SIGMA, де роздріб заведений на всі позиції,
 * «6.МАГАЗИНИ» ≈ ОПТ × 1,33.
 *
 * Округлюємо до цілої гривні: розрахункова ціна з копійками виглядала б як
 * облікова, а вона — оцінка. Виняток — дрібниця дешевша за 10 ₴ (кліпси для
 * плитки по 0,32 ₴, дюбелі, шайби): там ціла гривня — це або нуль, або +30 %
 * зверху, тож лишаємо копійки. Щойно в 1С зʼявиться справжній роздріб, він
 * витісняє розрахунковий (Product.priceDerived → false).
 */

export const DEFAULT_RETAIL_MARKUP = 1.3;

/** Межі коефіцієнта в адмінці: менше 1 — продаж нижче опту, більше 3 — одруківка. */
export const RETAIL_MARKUP_MIN = 1;
export const RETAIL_MARKUP_MAX = 3;

export function effectiveMarkup(brandMarkup: number | null | undefined): number {
  return brandMarkup && brandMarkup > 0 ? brandMarkup : DEFAULT_RETAIL_MARKUP;
}

/** Нижче цього порогу розрахункову ціну тримаємо з копійками. */
export const WHOLE_HRYVNIA_FROM = 10;

export function deriveRetailPrice(wholesale: number, brandMarkup: number | null | undefined): number {
  const raw = wholesale * effectiveMarkup(brandMarkup);
  return raw < WHOLE_HRYVNIA_FROM ? Math.round(raw * 100) / 100 : Math.round(raw);
}

export function isValidMarkup(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= RETAIL_MARKUP_MIN && value <= RETAIL_MARKUP_MAX;
}
