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
import { productType, isMeaningfulType } from "@/lib/catalog/brand-tree";

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
  brand: { select: { name: true, slug: true } },
} as const;

/** Уточнення запиту: «дриль» → «дриль APRO». Веде у відфільтрований список. */
export type SuggestFacet = {
  /** Що підставити у поле або в фільтр. */
  key: string;
  /** Як показати людині. */
  label: string;
  count: number;
};

export type SuggestResult = {
  items: SuggestRow[];
  /** Бренди, у яких є знайдене. Найчастіший спосіб звузити запит. */
  brands: SuggestFacet[];
  /** Типи товарів серед знайденого: «дриль» → «Дриль», «Дриль-шуруповерт». */
  types: SuggestFacet[];
};

export type SuggestRow = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  price: number;
  image: string | null;
  stock: number;
  category: { name: string } | null;
  brand: { name: string; slug: string } | null;
};

/** Слова запиту, стемлені — те, за чим шукаємо і чим рахуємо уточнення. */
function queryTerms(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map(stemTerm);
}

/**
 * Повна відповідь підказок: товари плюс уточнення.
 *
 * Обидва клієнти ходять сюди, а не збирають блоки самі: інакше сайт і
 * застосунок на однаковий запит показали б різні уточнення, і пояснити це
 * покупцеві було б нічим.
 */
export async function suggestAll(raw: string): Promise<SuggestResult> {
  const q = raw.trim();
  if (q.length < SUGGEST_MIN_LENGTH) return { items: [], brands: [], types: [] };

  const [items, facets] = await Promise.all([
    suggestProducts(q),
    suggestFacets(queryTerms(q)),
  ]);

  /* Порожня видача — не привід показувати уточнення: вони вели б у списки,
     де так само нічого немає. */
  if (items.length === 0) return { items, brands: [], types: [] };

  return { items, ...facets };
}

export async function suggestProducts(raw: string): Promise<SuggestRow[]> {
  const q = raw.trim();
  if (q.length < SUGGEST_MIN_LENGTH) return [];

  const terms = queryTerms(q);

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

/**
 * Скільки рядків беремо, щоб порахувати уточнення.
 *
 * Не весь збіг: на «набір» їх понад тисячу, а два коротких поля з трьохсот
 * рядків коштують стільки ж, скільки одна картка товару. Числа під
 * уточненнями через це можуть бути заниженими — тому вони й не показуються
 * як точні лічильники каталогу, а лише впорядковують підказки.
 */
const FACET_POOL = 300;

/** Скільки уточнень показуємо. Більше — стіна, у яку ніхто не читається. */
const FACET_LIMIT = 5;

/**
 * Уточнення запиту: бренди й типи товарів серед знайденого.
 *
 * Так влаштована випадайка у великих магазинах техніки, і причина проста:
 * «дриль» — це півтори сотні позицій, і людині потрібен не довший список, а
 * наступне питання. «Дриль APRO» або «Дриль-шуруповерт» звужують удвічі одним
 * дотиком, тоді як гортання восьми підказок не звужує нічого.
 */
async function suggestFacets(terms: string[]): Promise<{ brands: SuggestFacet[]; types: SuggestFacet[] }> {
  if (terms.length === 0) return { brands: [], types: [] };

  const rows = await prisma.product.findMany({
    where: {
      ...SHOWABLE,
      AND: terms.map((t) => ({ name: { contains: t, mode: "insensitive" as const } })),
    },
    select: { name: true, brand: { select: { name: true, slug: true } } },
    orderBy: [{ stock: "desc" }],
    take: FACET_POOL,
  });

  const brands = new Map<string, { label: string; count: number }>();
  const types = new Map<string, { label: string; count: number }>();

  for (const r of rows) {
    if (r.brand) {
      const cur = brands.get(r.brand.slug);
      brands.set(r.brand.slug, { label: r.brand.name, count: (cur?.count ?? 0) + 1 });
    }

    /*
     * Тип виводиться з назви тим самим productType, що й зміст каталогу, —
     * інакше уточнення вело б у список, який не збігається з обіцяним.
     */
    const t = productType(r.name, r.brand?.name ?? null);
    if (t && isMeaningfulType(t)) {
      const cur = types.get(t);
      types.set(t, { label: t.charAt(0).toUpperCase() + t.slice(1), count: (cur?.count ?? 0) + 1 });
    }
  }

  const top = (m: Map<string, { label: string; count: number }>): SuggestFacet[] =>
    [...m.entries()]
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, FACET_LIMIT);

  /*
   * Єдиний тип не уточнює нічого: якщо все знайдене — «дриль», рядок «Дриль»
   * лише повторює запит. Те саме з єдиним брендом.
   */
  const typeList = top(types);
  const brandList = top(brands);

  return {
    brands: brandList.length > 1 ? brandList : [],
    types: typeList.length > 1 ? typeList : [],
  };
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
