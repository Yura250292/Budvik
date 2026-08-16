import type { Prisma } from "@prisma/client";

/**
 * Пошук за артикулом (Product.sku).
 *
 * Артикул у базі — це поле sku з 1С: «10800», «GR-30030», «МДШ-600».
 * Шукати його як звичайний текст не можна: нормалізація пошуку вирізає
 * розділові знаки і б'є запит на слова, після чого «GR-30030» стає «gr» +
 * «30030» і точний артикул тоне серед усього, де трапилось «gr».
 * Тому артикул перевіряємо ДО нормалізації, сирим рядком.
 */

/**
 * Службові артикули, згенеровані при обміні, коли 1С не дала свого:
 * «1C-74DDFD7F». Їх ~11 тис., для людини вони беззмістовні — не показуємо
 * в картці й не даємо ними шукати, щоб запит «1C» не вивалював їх усі.
 */
const GENERATED_PREFIX = "1C-";

/** Чи це справжній артикул з 1С, а не наша заглушка. */
export function isRealSku(sku: string | null | undefined): boolean {
  return !!sku && !sku.startsWith(GENERATED_PREFIX);
}

/**
 * Схоже на артикул: цифри та латиниця/кирилиця з дефісами й крапками,
 * без пробілів. Назви товарів так не виглядають, тож зайвих спрацювань
 * майже не буде, а «дриль» сюди не потрапить — там немає цифр.
 */
export function looksLikeSku(raw: string): boolean {
  const q = raw.trim();
  if (q.length < 3 || q.length > 40) return false;
  if (/\s/.test(q)) return false;
  return /\d/.test(q) && /^[\p{L}\p{N}._/-]+$/u.test(q);
}

/**
 * Умови пошуку за артикулом для запиту користувача, або null — якщо запит
 * на артикул не схожий і чіпати його не варто.
 *
 * Повертає масив: точний збіг і збіг з початку. Хвостовий `contains` не
 * беремо навмисно — «300» інакше витягував би пів-каталогу.
 */
export function skuSearchConditions(raw: string): Prisma.ProductWhereInput[] | null {
  const q = raw.trim();
  if (!looksLikeSku(q)) return null;

  return [
    { sku: { equals: q, mode: "insensitive" } },
    { sku: { startsWith: q, mode: "insensitive" } },
  ];
}
