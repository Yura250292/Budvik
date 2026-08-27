import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { TYPE_LABELS } from "@/lib/catalog/classify";

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
  /** Логотип, якщо він у нас є. У переважної більшості порожньо — див. Brand.logoUrl. */
  logoUrl: string | null;
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
        {
          id: string;
          name: string;
          slug: string;
          color: string | null;
          logoUrl: string | null;
          cnt: number;
        }[]
      >`
        SELECT b.id, b.name, b.slug, b.color, b."logoUrl", count(p.id)::int AS cnt
        FROM "Brand" b
        JOIN "Product" p ON p."brandId" = b.id AND p."isActive"
        WHERE b."isActive"
        GROUP BY b.id, b.name, b.slug, b.color, b."logoUrl"
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
      logoUrl: r.logoUrl,
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
 * Дерево брендів по тому, що справді можна купити.
 *
 * getBrandTree вище рахує всі активні картки — це правильна відповідь на
 * питання «що є в базі», і саме її показує зміст каталогу на сайті. Але
 * покупцю в застосунку список брендів обіцяє видачу: він натискає «DNIPRO-M,
 * 1 468 позицій» і бачить десять, бо решта без залишку. З 281 бренда товар у
 * наявності є у 84 — решта відкривала порожні екрани.
 *
 * Умова тут та сама, що в buildWhere() каталогу: isActive + stock > 0 +
 * price > 0. Бренд, у якого не лишилось нічого, зникає зі списку зовсім:
 * порожня полиця гірша за її відсутність.
 */
export const getShoppableBrandTree = unstable_cache(
  async (): Promise<BrandTree> => {
    const shoppable = { isActive: true, stock: { gt: 0 }, price: { gt: 0 } } as const;

    const [rows, unbranded, total] = await Promise.all([
      prisma.$queryRaw<
        { id: string; name: string; slug: string; color: string | null; logoUrl: string | null; cnt: number }[]
      >`
        SELECT b.id, b.name, b.slug, b.color, b."logoUrl", count(p.id)::int AS cnt
        FROM "Brand" b
        JOIN "Product" p ON p."brandId" = b.id AND p."isActive" AND p.stock > 0 AND p.price > 0
        WHERE b."isActive"
        GROUP BY b.id, b.name, b.slug, b.color, b."logoUrl"
        HAVING count(p.id) > 0
        ORDER BY count(p.id) DESC, b.name ASC
      `,
      prisma.product.count({ where: { ...shoppable, brandId: null } }),
      prisma.product.count({ where: shoppable }),
    ]);

    const nodes: BrandNode[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      color: r.color,
      logoUrl: r.logoUrl,
      count: r.cnt,
    }));

    return {
      main: nodes.filter((b) => b.count >= MAIN_MIN),
      tail: nodes.filter((b) => b.count < MAIN_MIN),
      unbranded,
      total,
    };
  },
  ["catalog-brand-tree-shoppable-v1"],
  { revalidate: 3600, tags: [CATALOG_CACHE_TAG] }
);

/**
 * Група товару — другий рівень каталогу.
 *
 * Раніше вона виводилась тут-таки з назви правилом «зріж бренд, візьми перше
 * слово». Правило дешеве, але сліпе: «Акумуляторна батарея» давала групу
 * «акумуляторна», «Набір конекторів для шланга» — «набір», а фільтр каталогу
 * шукав ці слова підрядком у назвах і тягнув чуже. Тепер групу рахує
 * lib/catalog/classify.ts за всією назвою, а результат лежить у колонці
 * Product.typeKey — тут лишився тільки показ.
 */
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
 * Групи товарів усередині бренда (або серед товарів без бренда).
 *
 * Рахуємо по колонці Product.typeKey — тій самій, якою фільтрує каталог.
 * Раніше тут працювало правило «зріж бренд, візьми перше слово», а фільтр
 * шукав це слово підрядком у назві: панель показувала «Акумуляторна 28», а
 * за кліком відкривалось зовсім інше. Класифікатор тепер один на всіх
 * (lib/catalog/classify.ts), і його результат лежить у базі.
 */
export const getBrandTypes = unstable_cache(
  async (brandSlug: string | null): Promise<TypeNode[]> => {
    const brand = brandSlug && brandSlug !== "none"
      ? await prisma.brand.findUnique({ where: { slug: brandSlug }, select: { id: true } })
      : null;

    if (brandSlug && brandSlug !== "none" && !brand) return [];

    const rows = await prisma.product.groupBy({
      by: ["typeKey"],
      where: {
        isActive: true,
        typeKey: { not: null },
        ...(brandSlug === "none" ? { brandId: null } : brand ? { brandId: brand.id } : {}),
      },
      _count: { _all: true },
    });

    return rows
      .map((r) => ({
        key: r.typeKey!,
        label: TYPE_LABELS[r.typeKey!] ?? r.typeKey!,
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "uk"))
      .slice(0, TYPES_SHOWN);
  },
  ["catalog-brand-types-v2"],
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
