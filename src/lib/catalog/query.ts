import { unstable_cache } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { productType, CATALOG_CACHE_TAG } from "@/lib/catalog/brand-tree";
import { skuSearchConditions, looksLikeSku } from "@/lib/catalog/sku-search";
import { stemTerm, translitVariants } from "@/lib/catalog/normalize";
import { trigramSearchIds, reorderByIds } from "@/lib/catalog/fuzzy";

/**
 * Фільтри каталогу в одному місці.
 *
 * Сторінка каталогу і публічний API мають відповідати однаково: торговий
 * відкриває посилання зі змісту, а не будує запит руками, тож розбіжність
 * між ними означала б, що зі змісту він потрапляє не туди, куди обіцяно.
 */
export interface CatalogFilters {
  /** Slug бренда, "none" — товари без бренда, кілька — через кому. */
  brands: string[];
  /** Тип товару (перше слово назви після зрізаного бренда). */
  types: string[];
  search?: string;
  priceMin?: number;
  priceMax?: number;
  /**
   * Показати і те, чого зараз немає на складі.
   *
   * За замовчуванням каталог показує ЛИШЕ наявне: з 49 306 активних карток
   * товар є лише на 6 764, а 25 709 узагалі не мають звʼязку з 1С — це
   * залишки старого сайту, які ніколи не отримають залишок. Покупцю, що
   * гортає сторінки відсутнього товару, каталог здається великим і
   * непрацюючим одночасно.
   *
   * Кабінет торгового вмикає це явно: там відсутню позицію беруть під
   * замовлення, і бачити її треба.
   */
  showAll: boolean;
  /** Лише позиції з фото — щоб було що показати клієнту. */
  withImage: boolean;
  categorySlug?: string;
  sort?: string;
}

export function parseFilters(sp: URLSearchParams | Record<string, string | undefined>): CatalogFilters {
  const get = (k: string): string | undefined => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    return v ?? undefined;
  };
  const list = (k: string): string[] => {
    const raw = get(k);
    if (!raw) return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  };
  const num = (k: string): number | undefined => {
    const raw = Number(get(k));
    return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
  };

  return {
    brands: list("brand"),
    types: list("type"),
    search: get("search")?.trim() || undefined,
    priceMin: num("priceMin"),
    priceMax: num("priceMax"),
    showAll: get("all") === "1",
    withImage: get("withImage") === "1",
    categorySlug: get("category") || undefined,
    sort: get("sort") || undefined,
  };
}

/**
 * Prisma-where з фільтрів.
 *
 * Бренд фільтруємо по brandId через зв'язок, а не `name contains «YATO»`, як
 * було раніше: підрядок у назві ловив чужі товари, де бренд згаданий у
 * сумісності, і губив ті, де в назві його немає зовсім.
 */
export async function buildWhere(f: CatalogFilters): Promise<Prisma.ProductWhereInput> {
  const where: Prisma.ProductWhereInput = { isActive: true };
  const and: Prisma.ProductWhereInput[] = [];

  /**
   * Службові рядки-групи з 1С («01.03.02. Бури для бетону SDS-plus») активні,
   * але без ціни й фото — їх 8 тис. на 49 тис. активних, тобто кожен шостий
   * рядок видачі був заголовком розділу з написом «Ціна не вказана».
   *
   * Фільтруємо саме по ціні, а не showableProductWhere(): вимога фото і
   * залишку сховала б і справжній товар, який просто закінчився.
   */
  and.push({ price: { gt: 0 } });

  if (f.brands.length) {
    const slugs = f.brands.filter((b) => b !== "none");
    const includeUnbranded = f.brands.includes("none");
    const or: Prisma.ProductWhereInput[] = [];
    if (slugs.length) or.push({ brand: { slug: { in: slugs } } });
    if (includeUnbranded) or.push({ brandId: null });
    if (or.length) and.push({ OR: or });
  }

  // Тип живе в назві, а не окремою колонкою, тож фільтруємо підрядком —
  // всередині обраного бренда це безпечно, бо тип і виведений із цієї ж назви.
  if (f.types.length) {
    and.push({ OR: f.types.map((t) => ({ name: { contains: t, mode: "insensitive" as const } })) });
  }

  if (f.categorySlug) where.category = { slug: f.categorySlug };

  if (f.search) {
    /**
     * Артикул перевіряємо сирим рядком і окремою гілкою: нормалізація нижче
     * розбила б «GR-30030» на «gr» + «30030», і замість одного потрібного
     * товару людина отримала б усе, де трапилось «gr».
     */
    const skuMatch = skuSearchConditions(f.search);

    // Стемимо саме запит, а не базу: скорочений терм лишається підрядком
    // усіх форм слова, тож «валики» тепер знаходять «Валик малярний».
    const terms = f.search
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .map(stemTerm);

    const byText: Prisma.ProductWhereInput[] =
      terms.length > 1
        ? // Кілька слів — потрібні всі, інакше «ключ ріжковий» видає всі ключі.
          terms.map((t) => ({
            OR: [
              { name: { contains: t, mode: "insensitive" as const } },
              { sku: { contains: t, mode: "insensitive" as const } },
            ],
          }))
        : [
            {
              OR: [
                // terms[0] — те саме слово, але без закінчення; сирий рядок
                // лишається запасним для запитів на кшталт «GR-30030»
                { name: { contains: terms[0] ?? f.search, mode: "insensitive" as const } },
                { sku: { contains: f.search, mode: "insensitive" as const } },
              ],
            },
          ];

    // Артикул АБО текстовий пошук: збіг по артикулу не має відсікатись тим,
    // що ті самі символи не знайшлися в назві
    and.push(skuMatch ? { OR: [...skuMatch, { AND: byText }] } : { AND: byText });
  }

  if (f.priceMin !== undefined || f.priceMax !== undefined) {
    const price: Prisma.FloatFilter = {};
    if (f.priceMin !== undefined) price.gte = f.priceMin;
    if (f.priceMax !== undefined) price.lte = f.priceMax;
    and.push({ price });
  }

  if (!f.showAll) and.push({ stock: { gt: 0 } });
  if (f.withImage) and.push({ image: { not: null } }, { NOT: { image: "" } });

  if (and.length) where.AND = and;
  return where;
}

export function buildOrderBy(sort?: string): Prisma.ProductOrderByWithRelationInput[] {
  /*
   * Обраний порядок — головний, залишок лише розводить однакові значення.
   *
   * Було навпаки: `stock: "desc"` стояв першим у кожному рядку, тобто
   * «Дешевші» насправді сортувало за кількістю на складі, а ціна працювала
   * тільки всередині товарів з однаковим залишком. У видачі кругів перша
   * сторінка «найдешевших» починалася з позиції за 59 ₴ (їх на складі 200)
   * і не показувала жодної за 22 ₴. Людина, яка натиснула «Дешевші», просила
   * саме про ціну; наявність вона вже отримала фільтром за замовчуванням.
   */
  const map: Record<string, Prisma.ProductOrderByWithRelationInput[]> = {
    "price-asc": [{ price: "asc" }, { stock: "desc" }],
    "price-desc": [{ price: "desc" }, { stock: "desc" }],
    "name-asc": [{ name: "asc" }],
    "name-desc": [{ name: "desc" }],
    newest: [{ createdAt: "desc" }, { stock: "desc" }],
  };
  // За замовчуванням: спершу те, що є на складі — торговий показує клієнту
  // товар, який можна відвантажити сьогодні.
  return map[sort || ""] || [{ stock: "desc" }, { priority: "desc" }, { name: "asc" }];
}

/**
 * Рядок запиту з фільтрів — щоб посилання зі змісту й пагінація не розходились.
 *
 * defaultShowAll — яким «показувати відсутні» є для секції без ?all у адресі:
 * у вітрині вимкненим, у кабінеті торгового увімкненим. Пишемо параметр лише
 * тоді, коли значення розходиться з дефолтом, і пишемо його явним 0 чи 1 —
 * інакше в кабінеті вибір «лише наявне» зникав на другій сторінці, бо в
 * посиланні його нічим було відрізнити від «нічого не вибрано».
 */
export function filtersToQuery(
  f: Partial<CatalogFilters>,
  page?: number,
  opts?: { defaultShowAll?: boolean }
): string {
  const sp = new URLSearchParams();
  if (f.brands?.length) sp.set("brand", f.brands.join(","));
  if (f.types?.length) sp.set("type", f.types.join(","));
  if (f.search) sp.set("search", f.search);
  if (f.priceMin !== undefined) sp.set("priceMin", String(f.priceMin));
  if (f.priceMax !== undefined) sp.set("priceMax", String(f.priceMax));
  const defaultShowAll = opts?.defaultShowAll ?? false;
  if ((f.showAll ?? defaultShowAll) !== defaultShowAll) sp.set("all", f.showAll ? "1" : "0");
  if (f.withImage) sp.set("withImage", "1");
  if (f.categorySlug) sp.set("category", f.categorySlug);
  if (f.sort) sp.set("sort", f.sort);
  if (page && page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export const CATALOG_PAGE_SIZE = 24;

/**
 * Товари за фільтрами — спільний шлях для сторінки каталогу і API.
 *
 * Сторінка /catalog динамічна в принципі (searchParams не пререндеряться),
 * тож кешуємо не сторінку, а самі дані: типові комбінації бренд+сортування+
 * сторінка віддаються з кешу 60 с і не ходять у базу на кожного відвідувача.
 * Пошук навмисно повз кеш — унікальних запитів безліч, і кожен створював би
 * одноразовий запис.
 */
export async function fetchCatalogPage(f: CatalogFilters, page: number) {
  if (f.search) return fetchCatalogPageUncached(f, page);
  return fetchCatalogPageCached(f, page);
}

const fetchCatalogPageCached = unstable_cache(fetchCatalogPageUncached, ["catalog-page"], {
  revalidate: 60,
  tags: [CATALOG_CACHE_TAG],
});

/**
 * Скільки товарів дає кожен бренд **у поточній видачі**.
 *
 * Список брендів у фільтрах показував глобальні числа з дерева брендів:
 * «SIGMA 3202» — усі активні позиції марки, тоді як сама видача за
 * замовчуванням показує лише наявні з ціною. У розділі «Різальний
 * інструмент» це виглядало як обіцянка трьох тисяч кругів, а за кліком
 * відкривалась пара сотень. Гірше, що поруч у тій самій панелі стояли числа
 * розділів, пораховані по-іншому, — дві шкали в одному списку.
 *
 * Бренд у власних фасетах не звужує сам себе: інакше після вибору SIGMA
 * список схлопнувся б до одного рядка, і зняти вибір було б нічим.
 */
export async function fetchBrandFacets(f: CatalogFilters): Promise<Record<string, number>> {
  if (f.search) return fetchBrandFacetsUncached(f);
  return fetchBrandFacetsCached(f);
}

async function fetchBrandFacetsUncached(f: CatalogFilters): Promise<Record<string, number>> {
  const where = await buildWhere({ ...f, brands: [] });
  const rows = await prisma.product.groupBy({
    by: ["brandId"],
    where,
    _count: { _all: true },
  });

  const out: Record<string, number> = {};
  for (const r of rows) {
    // Товари без бренда живуть під тим самим ключем, що й фільтр: "none".
    out[r.brandId ?? "none"] = r._count._all;
  }
  return out;
}

const fetchBrandFacetsCached = unstable_cache(fetchBrandFacetsUncached, ["catalog-brand-facets"], {
  revalidate: 60,
  tags: [CATALOG_CACHE_TAG],
});

/**
 * Поля, які читають картки каталогу. Один список на всі шляхи вибірки.
 *
 * Експортується, бо мобільний API мусить віддавати рівно ту саму картку, що
 * й сайт: інакше та сама позиція виглядала б у застосунку інакше, ніж у
 * браузері, і розбіжність вилізла б не в коді, а в розмові з покупцем.
 */
export const CARD_SELECT = {
  id: true,
  name: true,
  slug: true,
  sku: true,
  description: true,
  price: true,
  isPromo: true,
  promoPrice: true,
  promoLabel: true,
  stock: true,
  image: true,
  // Кратність пакування: без неї кошик застосунку не знає, що товар
  // продається лише по 10, і показав би кнопку «+1», яку сервер усе одно
  // округлить угору — тобто збрехав би про кількість ще до оформлення.
  packQty: true,
  category: { select: { name: true, slug: true } },
  brand: { select: { name: true, slug: true } },
} as const;

async function fetchCatalogPageUncached(f: CatalogFilters, page: number) {
  const where = await buildWhere(f);
  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      // Явний select замість include: include тягнув усі 25+ колонок Product
      // (syncedAt, externalId, характеристики…), і весь цей баласт їхав у
      // RSC-payload сторінки. Тут — рівно те, що читають картки каталогу.
      select: CARD_SELECT,
      orderBy: buildOrderBy(f.sort),
      skip: (page - 1) * CATALOG_PAGE_SIZE,
      take: CATALOG_PAGE_SIZE,
    }),
    prisma.product.count({ where }),
  ]);

  // Точний артикул — нагору першої сторінки.
  //
  // Сортування йде в SQL по залишку, тож «50-122» ховався за 90 товарами, де
  // просто трапилось «122»: людина шукає конкретний артикул і не гортає.
  // Переставляємо лише в межах уже вибраної сторінки, щоб не зламати пагінацію.
  if (page === 1 && f.search && looksLikeSku(f.search)) {
    const needle = f.search.trim().toLowerCase();
    const exact = products.findIndex((p) => p.sku?.toLowerCase() === needle);
    if (exact > 0) products.unshift(...products.splice(exact, 1));
  }

  // Порожня видача — остання спроба, а не кінець розмови.
  if (total === 0 && f.search && page === 1) {
    const rescued = await rescueSearch(f);
    if (rescued.length > 0) {
      return { products: rescued, total: rescued.length, isFuzzy: true as const };
    }
  }

  return { products, total };
}

/**
 * Драбина рятувальних спроб, коли точний пошук дав нуль.
 *
 * Спершу інша розкладка (людина набрала «drel» замість «дриль»), далі —
 * схожість за трилітерними шматками (одрук). Обидві дорогі, тому працюють
 * лише на порожній видачі й лише на першій сторінці: тоді ціна нульова для
 * тих 99% запитів, які й так щось знайшли.
 */
async function rescueSearch(f: CatalogFilters) {
  const search = f.search!;

  for (const variant of translitVariants(search)) {
    const where = await buildWhere({ ...f, search: variant });
    const found = await prisma.product.findMany({
      where,
      select: CARD_SELECT,
      orderBy: buildOrderBy(f.sort),
      take: CATALOG_PAGE_SIZE,
    });
    if (found.length > 0) return found;
  }

  const ids = await trigramSearchIds(search, CATALOG_PAGE_SIZE);
  if (ids.length === 0) return [];

  const found = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: CARD_SELECT,
  });
  return reorderByIds(found, ids);
}

/** Ре-експорт, щоб сторінки тягли типізацію з одного модуля. */
export { productType };
