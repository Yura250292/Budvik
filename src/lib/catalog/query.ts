import { unstable_cache } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CATALOG_CACHE_TAG } from "@/lib/catalog/brand-tree";
import { skuSearchConditions, looksLikeSku } from "@/lib/catalog/sku-search";
import { stemTerm, translitVariants } from "@/lib/catalog/normalize";
import { trigramSearchIds, reorderByIds } from "@/lib/catalog/fuzzy";
import { FACETS, FACET_BY_KEY, facetsFor, type FacetDef } from "@/lib/catalog/facets";

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
  /** Групи товару (Product.typeKey) — «свердло», «бензопила». */
  types: string[];
  /**
   * Розділ каталогу (Product.sectionId) — «osnastka», «sad».
   *
   * Окремий фільтр, а не перелік усіх груп розділу в ?type=: посилання
   * «Електроінструмент» містило 40 токенів, ламалось від кожної правки
   * складу розділу і не мало як показати товар, який до розділу належить,
   * а окремої групи ще не набрав.
   */
  section?: string;
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
  /**
   * Характеристики: ключ реєстру → обрані значення. «power» → ["akum"].
   *
   * Окремим полем, а не колонками у фільтрі, бо набір залежить від місця в
   * каталозі: про болгарку питають діаметр диска, про пензель — ні. Що саме
   * питати, вирішує src/lib/catalog/facets.ts.
   */
  attrs: Record<string, string[]>;
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

  // Читаємо лише ключі реєстру: чужий параметр в адресі не має ставати
  // фільтром, інакше будь-яка мітка з реклами (?fbclid=…) звужувала б видачу.
  const attrs: Record<string, string[]> = {};
  for (const def of FACETS) {
    const vals = list(def.key);
    if (vals.length) attrs[def.key] = vals;
  }

  return {
    brands: list("brand"),
    types: list("type"),
    section: get("section") || undefined,
    search: get("search")?.trim() || undefined,
    priceMin: num("priceMin"),
    priceMax: num("priceMax"),
    showAll: get("all") === "1",
    withImage: get("withImage") === "1",
    categorySlug: get("category") || undefined,
    sort: get("sort") || undefined,
    attrs,
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

  /*
   * Розділ і група — точний збіг по колонках, а не підрядок у назві.
   *
   * Було `name contains «болгарка»`, і посилання розділу тягло все, де це
   * слово взагалі трапляється: «Щітка чаша (КШМ)», «Ключ для болгарки»,
   * «Ланцюг до бензопили». Заміряно на живій базі: 42% видачі розділу
   * «Електроінструмент» були чужими товарами, у «Хімії» — 66%.
   *
   * Головне навіть не це, а те, що зміст рахував розділ ОДНИМ способом
   * (група за назвою), а фільтр відбирав ІНШИМ. Число під назвою розділу
   * не могло збігтися з видачею в принципі. Тепер обидва читають ті самі
   * колонки, які проставляє класифікатор.
   */
  if (f.section) and.push({ sectionId: f.section });
  if (f.types.length) and.push({ typeKey: { in: f.types } });

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

  for (const cond of attrConditions(f.attrs)) and.push(cond);

  if (and.length) where.AND = and;
  return where;
}

/**
 * Умови за характеристиками: живлення, діаметр диска, напруга, потужність.
 *
 * Кілька значень одного фасета — це «або» («125 або 230 мм»), різні фасети —
 * «і» («акумуляторна І 125 мм»): саме так люди й читають набір галочок.
 *
 * `skipKey` лишає один фасет поза умовою — потрібно, щоб порахувати його
 * власні лічильники: список значень, звужений сам собою, схлопнувся б до
 * обраного рядка, і зняти вибір не було б чим.
 */
function attrConditions(
  attrs: Record<string, string[]> | undefined,
  skipKey?: string
): Prisma.ProductWhereInput[] {
  if (!attrs) return [];
  const out: Prisma.ProductWhereInput[] = [];

  for (const [key, values] of Object.entries(attrs)) {
    if (!values.length || key === skipKey) continue;
    const def = FACET_BY_KEY.get(key);
    if (!def) continue;

    if (def.kind === "range") {
      const or: Prisma.ProductWhereInput[] = [];
      for (const id of values) {
        const b = def.buckets?.find((x) => x.id === id);
        if (!b) continue;
        const cmp: Prisma.IntFilter = {};
        if (b.gte !== undefined) cmp.gte = b.gte;
        if (b.lt !== undefined) cmp.lt = b.lt;
        or.push({ [def.column]: cmp } as Prisma.ProductWhereInput);
      }
      if (or.length) out.push({ OR: or });
      continue;
    }

    if (def.kind === "number") {
      const nums = values.map(Number).filter((n) => Number.isFinite(n));
      if (nums.length) out.push({ [def.column]: { in: nums } } as Prisma.ProductWhereInput);
      continue;
    }

    // enum: значення поза переліком ігноруємо — в адресу їх міг вписати хто завгодно.
    const allowed = values.filter((v) => def.options?.some((o) => o.value === v));
    if (allowed.length) out.push({ [def.column]: { in: allowed } } as Prisma.ProductWhereInput);
  }

  return out;
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
  if (f.section) sp.set("section", f.section);
  if (f.search) sp.set("search", f.search);
  if (f.priceMin !== undefined) sp.set("priceMin", String(f.priceMin));
  if (f.priceMax !== undefined) sp.set("priceMax", String(f.priceMax));
  const defaultShowAll = opts?.defaultShowAll ?? false;
  if ((f.showAll ?? defaultShowAll) !== defaultShowAll) sp.set("all", f.showAll ? "1" : "0");
  if (f.withImage) sp.set("withImage", "1");
  if (f.categorySlug) sp.set("category", f.categorySlug);
  if (f.sort) sp.set("sort", f.sort);
  // Порядком реєстру, а не Object.keys: інакше та сама пара фільтрів давала б
  // різні адреси, і пагінація з чипами розходились би між собою.
  for (const def of FACETS) {
    const vals = f.attrs?.[def.key];
    if (vals?.length) sp.set(def.key, vals.join(","));
  }
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
 * Скільки товарів дає кожен розділ **у поточній видачі**.
 *
 * Числа розділів приходили зі змісту каталогу — тобто з усього каталогу,
 * незалежно від того, що людина вже обрала. Всередині бренда це виглядало як
 * обіцянка: «Polax / Малярний інструмент 1 240», а за кліком відкривалось
 * сорок позицій, бо решта — інші фірми. Тепер розділ рахується тим самим
 * where, що й видача, тож обраний бренд лишається в умові автоматично.
 *
 * Розділ сам себе не звужує — інакше після вибору лишався б один рядок і
 * перейти в сусідній розділ, не скинувши фільтр, було б нічим. Групи теж
 * прибираємо: вони належать розділу, і з ними числа сусідніх розділів були б
 * нулями.
 */
export async function fetchSectionFacets(f: CatalogFilters): Promise<Record<string, number>> {
  if (f.search) return fetchSectionFacetsUncached(f);
  return fetchSectionFacetsCached(f);
}

async function fetchSectionFacetsUncached(f: CatalogFilters): Promise<Record<string, number>> {
  const where = await buildWhere({ ...f, section: undefined, types: [] });
  const rows = await prisma.product.groupBy({
    by: ["sectionId"],
    where: { ...where, sectionId: { not: null } },
    _count: { _all: true },
  });

  const out: Record<string, number> = {};
  for (const r of rows) if (r.sectionId) out[r.sectionId] = r._count._all;
  return out;
}

const fetchSectionFacetsCached = unstable_cache(
  fetchSectionFacetsUncached,
  ["catalog-section-facets"],
  { revalidate: 60, tags: [CATALOG_CACHE_TAG] }
);

/**
 * Скільки товарів дає кожна група товару **у поточній видачі**.
 *
 * Замінює getBrandTypes() на сторінці каталогу: та рахувала групи лише по
 * бренду й не знала про розділ, тож усередині бренда рівень розділу зникав, а
 * список був плоским і обрізаним. Тут умова спільна з видачею — і бренд, і
 * розділ, і ціна, і наявність, — тому «Пензлі 12» всередині Polax означає
 * рівно дванадцять пензлів Polax.
 *
 * Група сама себе не звужує з тієї ж причини, що й бренд вище.
 */
export async function fetchTypeFacets(f: CatalogFilters): Promise<Record<string, number>> {
  if (f.search) return fetchTypeFacetsUncached(f);
  return fetchTypeFacetsCached(f);
}

async function fetchTypeFacetsUncached(f: CatalogFilters): Promise<Record<string, number>> {
  const where = await buildWhere({ ...f, types: [] });
  const rows = await prisma.product.groupBy({
    by: ["typeKey"],
    where: { ...where, typeKey: { not: null } },
    _count: { _all: true },
  });

  const out: Record<string, number> = {};
  for (const r of rows) if (r.typeKey) out[r.typeKey] = r._count._all;
  return out;
}

const fetchTypeFacetsCached = unstable_cache(fetchTypeFacetsUncached, ["catalog-type-facets"], {
  revalidate: 60,
  tags: [CATALOG_CACHE_TAG],
});

export interface AttrFacet {
  key: string;
  label: string;
  unit?: string;
  options: { value: string; label: string; count: number }[];
}

/**
 * Характеристики, за якими зараз є сенс фільтрувати, з лічильниками.
 *
 * Блоки зʼявляються контекстно: набір визначає facetsFor() за обраним розділом
 * і групою, тож «Діаметр диска» видно на болгарках і кругах, а не над усім
 * каталогом. Коли фасетів для місця немає, функція не робить жодного запиту —
 * чистий /catalog за це не платить нічого.
 *
 * Кожен фасет рахується без себе самого — так само, як бренди й розділи вище.
 */
export async function fetchAttrFacets(f: CatalogFilters): Promise<AttrFacet[]> {
  const defs = facetsFor({ section: f.section, types: f.types });
  if (!defs.length) return [];
  if (f.search) return fetchAttrFacetsUncached(f, defs);
  return fetchAttrFacetsCached(f, defs);
}

async function fetchAttrFacetsUncached(f: CatalogFilters, defs: FacetDef[]): Promise<AttrFacet[]> {
  const out = await Promise.all(defs.map((def) => facetOptions(f, def)));
  // Фасет без жодного значення показувати нема сенсу: порожній блок читається
  // як поламаний фільтр. Обране лишається завжди — інакше зняти його нічим.
  return out.filter((x) => x.options.length > 0);
}

const fetchAttrFacetsCached = unstable_cache(fetchAttrFacetsUncached, ["catalog-attr-facets"], {
  revalidate: 60,
  tags: [CATALOG_CACHE_TAG],
});

async function facetOptions(f: CatalogFilters, def: FacetDef): Promise<AttrFacet> {
  const base = await buildWhere({ ...f, attrs: omitKey(f.attrs, def.key) });
  const rows = await prisma.product.groupBy({
    by: [def.column],
    where: { ...base, [def.column]: { not: null } },
    _count: { _all: true },
  });

  const chosen = new Set(f.attrs[def.key] ?? []);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const raw = (r as Record<string, unknown>)[def.column];
    if (raw === null || raw === undefined) continue;
    counts.set(String(raw), r._count._all);
  }

  let options: { value: string; label: string; count: number }[];

  if (def.kind === "range") {
    options = (def.buckets ?? []).map((b) => {
      let n = 0;
      for (const [raw, cnt] of counts) {
        const v = Number(raw);
        if (!Number.isFinite(v)) continue;
        if (b.gte !== undefined && v < b.gte) continue;
        if (b.lt !== undefined && v >= b.lt) continue;
        n += cnt;
      }
      return { value: b.id, label: b.label, count: n };
    });
  } else if (def.kind === "enum") {
    options = (def.options ?? []).map((o) => ({ ...o, count: counts.get(o.value) ?? 0 }));
  } else {
    // number: значення беремо з бази, впорядковані як числа — «100, 125, 230»,
    // а не рядками, де «100» стоїть після «1000».
    options = [...counts.entries()]
      .map(([value, count]) => ({
        value,
        label: def.unit ? `${value} ${def.unit}` : value,
        count,
      }))
      .sort((a, b) => Number(a.value) - Number(b.value));
  }

  return {
    key: def.key,
    label: def.label,
    unit: def.unit,
    options: options.filter((o) => o.count > 0 || chosen.has(o.value)),
  };
}

function omitKey(attrs: Record<string, string[]>, key: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(attrs)) if (k !== key) out[k] = v;
  return out;
}

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
