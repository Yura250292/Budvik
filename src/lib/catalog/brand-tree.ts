import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

/** Тег для скидання структури каталогу — його смикає обмін з 1С. */
export const CATALOG_CACHE_TAG = "catalog-brands";

/**
 * Бренд — головний вимір каталогу.
 *
 * Категорії з 1С як навігація не працюють: 2306 категорій, з них «Імпорт з 1С»
 * тримає 16 304 товари, а «1964» — 13 284. Бренд натомість заповнений у 82%
 * товарів (40 159 з 48 961) і вже є робочою групою в закупівлях та аналітиці.
 */
export interface BrandNode {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  count: number;
}

export interface BrandTree {
  /** Бренди від MAIN_MIN товарів — ті, що показуємо одразу. */
  main: BrandNode[];
  /** Дрібні бренди під розгортачкою «Інші». Жоден товар не зникає. */
  tail: BrandNode[];
  /** Товари без brandId — окремий пункт, а не мовчазна діра. */
  unbranded: number;
  total: number;
}

/**
 * Поріг «головного» бренда. 360 брендів у списку — це не структура, а
 * простирадло: торговий гортає його перед клієнтом замість того, щоб
 * показати товар. Від 20 товарів лишається 114 брендів, і вони покривають
 * переважну частину каталогу; решта доступна через «Інші» та пошук.
 */
const MAIN_MIN = 20;

export const getBrandTree = unstable_cache(
  async (): Promise<BrandTree> => {
    const [rows, unbranded, total] = await Promise.all([
      prisma.$queryRaw<
        { id: string; name: string; slug: string; color: string | null; cnt: number }[]
      >`
        SELECT b.id, b.name, b.slug, b.color, count(p.id)::int AS cnt
        FROM "Brand" b
        JOIN "Product" p ON p."brandId" = b.id AND p."isActive"
        WHERE b."isActive"
        GROUP BY b.id, b.name, b.slug, b.color
        ORDER BY count(p.id) DESC, b.name ASC
      `,
      prisma.product.count({ where: { isActive: true, brandId: null } }),
      prisma.product.count({ where: { isActive: true } }),
    ]);

    const nodes: BrandNode[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      color: r.color,
      count: r.cnt,
    }));

    return {
      main: nodes.filter((b) => b.count >= MAIN_MIN),
      tail: nodes.filter((b) => b.count < MAIN_MIN),
      unbranded,
      total,
    };
  },
  ["catalog-brand-tree"],
  { revalidate: 3600, tags: [CATALOG_CACHE_TAG] }
);

/**
 * Тип товару — другий рівень каталогу.
 *
 * Класифікатор із закупівель (RULES у lib/procurement/low-stock.ts) сюди не
 * годиться: заміряно, що він розпізнає лише 10,4% каталогу — його писали під
 * акумуляторний і бензиновий інструмент, а не під усі 49 тис. позицій.
 *
 * Працює простіше правило: зрізати назву бренда з початку назви товару, і
 * перше слово, що лишилось, і є типом — «свердло», «ключ», «викрутка»,
 * «рукавиці». Заміряно на базі: непридатних токенів 2,6%, а типи від 15
 * товарів покривають 80,2% каталогу.
 */
const TYPE_STOP = new Set([
  "фоп", "ремонт", "тм", "для", "з", "на", "до", "та", "і", "в", "у", "по",
  "від", "під", "без", "про", "the", "of",
]);

export function productType(name: string, brandName?: string | null): string | null {
  let s = name.trim();

  if (brandName) {
    const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`^\\s*${escaped}\\s*[-–—:]?\\s*`, "i"), "");
  }

  s = s.replace(/^["'«»\s]+/, "");
  const token = s
    .split(/[\s,.:;()/]+/)[0]
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]/gu, "");

  if (token.length < 2) return null;
  if (TYPE_STOP.has(token)) return null;
  if (/^\d+$/.test(token)) return null;

  return token;
}

export interface TypeNode {
  /** Нормалізований токен — він же значення фільтра ?type=. */
  key: string;
  /** Те саме з великої літери — для показу. */
  label: string;
  count: number;
}

/** Скільки типів показуємо списком; решта ховається за «Інші типи». */
const TYPES_SHOWN = 24;

/**
 * Типи товарів усередині бренда (або серед товарів без бренда).
 *
 * Рахуємо в пам'яті, а не в SQL: правило «зріж бренд, візьми перше слово»
 * живе в JS і має лишатись одним шматком коду — інакше фільтр на сторінці
 * і лічильник у сайдбарі розійдуться на тих самих даних.
 */
export const getBrandTypes = unstable_cache(
  async (brandSlug: string | null): Promise<TypeNode[]> => {
    const brand = brandSlug && brandSlug !== "none"
      ? await prisma.brand.findUnique({ where: { slug: brandSlug }, select: { id: true, name: true } })
      : null;

    if (brandSlug && brandSlug !== "none" && !brand) return [];

    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        ...(brandSlug === "none" ? { brandId: null } : brand ? { brandId: brand.id } : {}),
      },
      select: { name: true },
    });

    const counts = new Map<string, number>();
    for (const p of products) {
      const t = productType(p.name, brand?.name);
      if (!t) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }

    return [...counts.entries()]
      .map(([key, count]) => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1), count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "uk"))
      .slice(0, TYPES_SHOWN);
  },
  ["catalog-brand-types"],
  { revalidate: 3600, tags: [CATALOG_CACHE_TAG] }
);

/** Діапазон цін активних товарів — межі для повзунка «ціна від/до». */
export const getPriceBounds = unstable_cache(
  async (): Promise<{ min: number; max: number }> => {
    const agg = await prisma.product.aggregate({
      where: { isActive: true, price: { gt: 0 } },
      _min: { price: true },
      _max: { price: true },
    });
    return {
      min: Math.floor(agg._min.price ?? 0),
      max: Math.ceil(agg._max.price ?? 0),
    };
  },
  ["catalog-price-bounds"],
  { revalidate: 3600, tags: [CATALOG_CACHE_TAG] }
);
