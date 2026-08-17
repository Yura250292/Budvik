/**
 * Кратність товару — скільки штук у пачці, якщо товар не продається поштучно.
 *
 * Постачальники пишуть кратність прямо в назві номенклатури 1С, трьома стилями:
 *   «(пачка, кратно 10шт)»   APRO, UNIFIX
 *   «(КРАТНО 12 парам)»      SIGMA, GRAD — рукавички рахуються парами
 *   «Уп. 5 шт.»              NINJA, USH, VOREL, YATO
 *
 * Свідомо НЕ розбираємо квадратні дужки [N] у кінці назви (YATO, VOREL, STHOR,
 * ~10 тис. товарів). Це кількість у заводському ящику, а не крок замовлення:
 * там трапляється [1] на точильному верстаті і [500] на шліфпапері. Якщо колись
 * знадобиться «в ящику N шт» — це окреме поле, не packQty.
 */

// «кратно 10шт», «КРАТНО - 2шт», «кратно 12 парам», «кратно 10.шт», «кратно 2 наборів»
const RX_KRATNO =
  /кратн[оа]?\s*[-–—:.]?\s*(\d{1,4})\s*[.,]?\s*(?:шт|пар|компл|набор|наб\b)/i;

// «Уп. 5 шт.», «уп.(10шт)», «упак 25 шт»
const RX_UPAKOVKA = /(?:уп|упак)\.?\s*\(?\s*(\d{1,4})\s*\)?\s*(?:шт|пар)/i;

/**
 * «кратніс- 32Х» у нівелірах і «лінза 4х кратна» у лупах — це оптичне збільшення,
 * а не пачка. Відсікаємо назви, де поряд із «кратн» стоїть множник із «х».
 */
const RX_OPTIKA = /(?:лупа|лупи|лінз|нівелір|кратніс|\d\s*[хx]\s*кратн)/i;

/**
 * Витягує кратність із назви товару. Повертає null, якщо товар поштучний.
 */
export function parsePackQty(name: string): number | null {
  if (!name) return null;
  if (RX_OPTIKA.test(name)) return null;

  const m = RX_KRATNO.exec(name) ?? RX_UPAKOVKA.exec(name);
  if (!m) return null;

  const qty = Number(m[1]);
  // 1 — це поштучно, а не пачка. Понад 1000 у назві — майже завжди описка або
  // характеристика товару (метраж, кількість зубців), а не крок замовлення.
  if (!Number.isFinite(qty) || qty <= 1 || qty > 1000) return null;
  return qty;
}

/** Кратність товару: явне поле з бази, інакше поштучно. */
export function packQtyOf(product: { packQty?: number | null }): number {
  const q = product.packQty;
  return q && q > 1 ? q : 1;
}

/** Округлює кількість вгору до найближчої кратної. Мінімум — одна пачка. */
export function roundUpToPack(quantity: number, pack: number): number {
  if (pack <= 1) return Math.max(1, Math.round(quantity));
  return Math.max(pack, Math.ceil(quantity / pack) * pack);
}

/** Наступна/попередня кратна кількість для кнопок +/−. */
export function stepPack(quantity: number, pack: number, dir: 1 | -1): number {
  if (pack <= 1) return Math.max(1, quantity + dir);
  // Якщо поточна кількість некратна (прийшла зі старого замовлення) — спершу
  // вирівнюємо її, а не додаємо крок до кривого числа.
  const aligned = Math.round(quantity / pack) * pack;
  return Math.max(pack, aligned + dir * pack);
}

/** Підпис для картки товару: «Пачка 10 шт» / «Кратно 12 парам». */
export function packLabel(pack: number, name?: string): string | null {
  if (pack <= 1) return null;
  const isPairs = name ? /\d\s*пар(?:ам|и|а)?/i.test(name) : false;
  return isPairs ? `Кратно ${pack} парам` : `Пачка ${pack} шт`;
}
