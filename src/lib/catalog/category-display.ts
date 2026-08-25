/**
 * Службові категорії з імпорту 1С: «Імпорт з 1С» — звалище для товарів без
 * власної групи, числові коди — технічні вузли дерева 1С. Покупець їх бачити
 * не має; в адмінці показуємо як є.
 */
const SERVICE_CATEGORY = /^(Імпорт з 1С|Ремонти|\d+)$/i;

export function isServiceCategory(name?: string | null): boolean {
  return !name || SERVICE_CATEGORY.test(name.trim());
}

/**
 * Категорії 1С, чий вміст не продається на сайті взагалі: стенди, рекламні
 * матеріали, сувенірка, обмінний фонд. Товар, що приїжджає з 1С у таку групу,
 * створюється неактивним (apply-products), а наявні деактивував
 * scripts/hide-merch.mts (25.08.2026, рішення власника: мерч не показувати).
 * «стенд» окремо не ловимо — слово трапляється і в назвах звичайних груп;
 * числові префікси 1С («9.9.9.») теж ні — під ними є й «Рахунок в/ч».
 */
const HIDDEN_CATEGORY = /(сувенір|реклам|обмінний фонд|обменный фонд)/i;

export function isHiddenCategory(name?: string | null): boolean {
  return !!name && HIDDEN_CATEGORY.test(name.trim());
}

/**
 * Ярлик на картці товару. Категорія з 1С осмислена лише у 16% товарів, тому
 * там, де вона службова, підставляємо бренд — він заповнений майже скрізь і
 * покупцю каже більше, ніж порожнє місце.
 */
export function productLabel(
  category?: { name: string } | null,
  brand?: { name: string } | null,
): string | null {
  if (category && !isServiceCategory(category.name)) return category.name;
  return brand?.name ?? null;
}
