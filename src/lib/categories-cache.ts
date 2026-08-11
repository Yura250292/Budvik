import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { CategoryWithCount } from "@/lib/category-tree";

/** Тег для скидання кешу категорій — його смикає обмін з 1С. */
export const CATEGORIES_CACHE_TAG = "categories";

/**
 * Категорії з кількістю активних товарів — для сайдбару каталогу.
 *
 * Було: `category.findMany` з `include: { _count }` і фільтром числових назв
 * у JS. Це тягло ВСІ колонки 1022 категорій (заміряно 1588 мс / 238 КБ),
 * причому JS-фільтр відкидав з них лише 6 штук.
 *
 * Стало: один SQL з GROUP BY, лише три потрібні поля (їх вимагає
 * CategoryWithCount), числові назви відсіяні регуляркою в Postgres —
 * 499 мс / 122 КБ. Зверху unstable_cache, бо категорії міняються після
 * обміну з 1С, а не на кожен перегляд каталогу.
 */
export const getCategoriesWithCounts = unstable_cache(
  async (): Promise<CategoryWithCount[]> => {
    const rows = await prisma.$queryRaw<
      { id: string; name: string; slug: string; cnt: number }[]
    >`
      SELECT c.id, c.name, c.slug, count(p.id)::int AS cnt
      FROM "Category" c
      JOIN "Product" p ON p."categoryId" = c.id AND p."isActive"
      WHERE c.name !~ '^[0-9]+$'
      GROUP BY c.id, c.name, c.slug
      ORDER BY c.name ASC
    `;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      _count: { products: r.cnt },
    }));
  },
  ["categories-with-counts"],
  { revalidate: 3600, tags: [CATEGORIES_CACHE_TAG] }
);
