/**
 * Підказки пошуку — спільні для сайту й застосунку.
 *
 * Раніше вся драбина жила всередині роуту /api/products/suggest, і застосунок
 * її не мав узагалі: він на кожен натиск тягнув повну сторінку каталогу з
 * двадцяти чотирьох карток. Виносимо сюди, щоб два клієнти шукали однаково —
 * інакше на однаковий запит сайт і застосунок неминуче почали б показувати
 * різне, і пояснити це покупцеві було б нічим.
 *
 * Драбина навмисно саме така: артикул точно → всі слова в назві → слова в
 * назві або категорії → інша розкладка клавіатури → триграми. Кожна наступна
 * сходинка коштує дорожче за попередню, тож до неї доходимо, лише коли
 * дешевша не дала нічого.
 */

import { prisma } from "@/lib/prisma";
import { skuSearchConditions } from "@/lib/catalog/sku-search";
import { stemTerm, translitVariants } from "@/lib/catalog/normalize";
import { trigramSearchIds, reorderByIds } from "@/lib/catalog/fuzzy";

export const SUGGEST_LIMIT = 8;

/**
 * Скільки рядків беремо на переставляння за влучністю.
 *
 * Вибірка все одно обмежена, тож стеля потрібна; шістдесят — це вже далеко за
 * межами того, що людина гортає, але достатньо, щоб точний збіг не лишився за
 * бортом через чужий великий залишок.
 */
const RANK_POOL = 60;

/** Коротший запит нічого осмисленого не знайде, лише навантажить базу. */
export const SUGGEST_MIN_LENGTH = 2;

/**
 * Службові рядки-групи з 1С активні, але без ціни й фото. У підказках вони
 * найшкідливіші: займають місця з восьми доступних, а натиснути на них
 * немає сенсу.
 */
const SHOWABLE = { isActive: true, price: { gt: 0 } } as const;

/** Поля, які малює рядок підказки. */
const SELECT = {
  id: true,
  name: true,
  slug: true,
  sku: true,
  price: true,
  image: true,
  stock: true,
  category: { select: { name: true } },
  /* Бренд потрібен для ярлика: категорія з 1С у 84% товарів — це звалище
     «Імпорт з 1С», і productLabel замінює її брендом. Без бренда рядок
     підказки лишався б без жодної позначки. */
  brand: { select: { name: true } },
} as const;

export type SuggestRow = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  price: number;
  image: string | null;
  stock: number;
  category: { name: string } | null;
  brand: { name: string } | null;
};

export async function suggestProducts(raw: string): Promise<SuggestRow[]> {
  const q = raw.trim();
  if (q.length < SUGGEST_MIN_LENGTH) return [];

  const terms = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map(stemTerm);

  /**
   * Артикул — перший і головний кандидат: якщо людина набирає «GR-30030»,
   * вона знає, що їй треба, і потрібен саме цей товар угорі списку.
   * Перевіряємо сирий запит, бо нормалізація вище з'їдає дефіси.
   */
  const bySku = skuSearchConditions(q);
  const skuMatches = bySku
    ? await prisma.product.findMany({
        where: { ...SHOWABLE, OR: bySku },
        select: SELECT,
        orderBy: [{ stock: "desc" }, { name: "asc" }],
        take: SUGGEST_LIMIT,
      })
    : [];

  if (skuMatches.length >= SUGGEST_LIMIT || terms.length === 0) return skuMatches;

  /** Усі слова запиту в назві. */
  const nameConditions = terms.map((term) => ({
    name: { contains: term, mode: "insensitive" as const },
  }));

  /** Ширше: кожне слово в назві або в категорії. */
  const broadConditions = terms.map((term) => ({
    OR: [
      { name: { contains: term, mode: "insensitive" as const } },
      { category: { name: { contains: term, mode: "insensitive" as const } } },
    ],
  }));

  // Артикульні збіги вже зайняли місця вгорі — рештою добираємо по назві
  const skuSlugs = skuMatches.map((p) => p.slug);

  /**
   * Беремо ширше, ніж покажемо, і переставляємо за влучністю.
   *
   * Порядок «більше на складі — вище» ставив на запит «дриль» чотири щітки
   * APRO «(дриль)» поперед самого дриля: слово в них є, просто наприкінці
   * назви, зате залишок більший. Людина читає це як «дрилів немає».
   * Тому серед знайденого спершу йдуть ті, у чиїй назві слово стоїть раніше,
   * і лише за однакової позиції вирішує залишок.
   */
  const pool = await prisma.product.findMany({
    where: { ...SHOWABLE, AND: nameConditions, slug: { notIn: skuSlugs } },
    select: SELECT,
    orderBy: [{ stock: "desc" }, { name: "asc" }],
    take: RANK_POOL,
  });

  const nameMatches = rankByPosition(pool, terms).slice(0, SUGGEST_LIMIT - skuMatches.length);

  if (skuMatches.length + nameMatches.length >= SUGGEST_LIMIT) {
    return [...skuMatches, ...nameMatches];
  }

  const nameSlugs = [...skuSlugs, ...nameMatches.map((p) => p.slug)];
  const categoryMatches = await prisma.product.findMany({
    where: {
      ...SHOWABLE,
      AND: broadConditions,
      slug: { notIn: nameSlugs },
      NOT: { AND: nameConditions },
    },
    select: SELECT,
    orderBy: [{ stock: "desc" }, { name: "asc" }],
    take: SUGGEST_LIMIT - skuMatches.length - nameMatches.length,
  });

  const found = [...skuMatches, ...nameMatches, ...categoryMatches];
  if (found.length > 0) return found;

  // Нічого не знайшлось — та сама драбина, що й у каталозі: інша розкладка,
  // потім схожість. Порожній список підказок людина читає як «такого немає».
  return rescue(q);
}

/**
 * Переставляє знайдене за тим, як рано слово запиту трапляється в назві.
 *
 * Позиція — груба, але чесна міра влучності: «APRO Дриль 10 мм» згадує дриль
 * на п'ятому символі, а «APRO Щітка чаша сталеві витки 65 мм (дриль)» — на
 * сороковому, і саме друге раніше стояло вище через залишок на складі.
 * Порівнюємо за найгіршим зі слів запиту: якщо їх кілька, вагоме те, наскільки
 * пізно знайшлось останнє.
 */
function rankByPosition(rows: SuggestRow[], terms: string[]): SuggestRow[] {
  const score = (r: SuggestRow) => {
    const name = r.name.toLowerCase();
    let worst = 0;
    for (const t of terms) {
      const at = name.indexOf(t);
      worst = Math.max(worst, at < 0 ? name.length : at);
    }
    return worst;
  };

  /* Стабільне сортування: за однакової позиції зберігається порядок, у якому
     їх повернула база, тобто «більше на складі — вище». */
  return [...rows].sort((a, b) => score(a) - score(b));
}

async function rescue(q: string): Promise<SuggestRow[]> {
  for (const variant of translitVariants(q)) {
    const byVariant = await prisma.product.findMany({
      where: { ...SHOWABLE, name: { contains: variant, mode: "insensitive" } },
      select: SELECT,
      orderBy: [{ stock: "desc" }, { name: "asc" }],
      take: SUGGEST_LIMIT,
    });
    if (byVariant.length > 0) return byVariant;
  }

  const ids = await trigramSearchIds(q, SUGGEST_LIMIT);
  if (ids.length === 0) return [];

  const items = await prisma.product.findMany({ where: { id: { in: ids } }, select: SELECT });
  return reorderByIds(items, ids);
}
