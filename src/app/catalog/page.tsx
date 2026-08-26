// 15 хвилин замість хвилини: після обміну з 1С сторінку і так скидає
// revalidatePath("/catalog") у sync-ingest, тож часте вікно лише палило
// рендери під ботами.
export const revalidate = 900;

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CatalogGrid from "@/components/CatalogGrid";
import AiSmartSearch from "@/components/ai/AiSmartSearch";
import CatalogFilters from "@/components/catalog/CatalogFilters";
import CatalogBreadcrumbs, { sectionOfTypes } from "@/components/catalog/CatalogBreadcrumbs";
import ActiveFilterChips from "@/components/catalog/ActiveFilterChips";
import SearchTracker from "@/components/webstats/SearchTracker";
import { getBrandTree, getBrandTypes, getPriceBounds } from "@/lib/catalog/brand-tree";
import { getCatalogToc } from "@/lib/catalog/sections";
import { parseFilters, fetchCatalogPage, filtersToQuery, CATALOG_PAGE_SIZE } from "@/lib/catalog/query";

type SP = Record<string, string | undefined>;

/**
 * Метатеги каталогу залежать від фільтрів, тож рахуються на запит.
 *
 * Індексується лише чистий /catalog: комбінації фільтрів — нескінченні
 * дублі однієї видачі, їм noindex,follow (робот іде далі по посиланнях на
 * товари, але сторінку в індекс не кладе). Видача одного бренда чи типу
 * канонікалом показує на свою «справжню» сторінку /brand/... чи
 * /catalog/typ/... — саме вони мають збирати позиції.
 */
export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  const params = await searchParams;
  const f = parseFilters(params);

  const noExtras = (skip: "brand" | "type") =>
    (skip === "brand" || !f.brands.length) &&
    (skip === "type" || !f.types.length) &&
    !f.search && f.priceMin === undefined && f.priceMax === undefined &&
    !f.showAll && !f.withImage && !f.categorySlug && !f.sort && !params.page;

  const onlyBrand = f.brands.length === 1 && f.brands[0] !== "none" && noExtras("brand");
  const onlyType = f.types.length === 1 && noExtras("type");
  const isFiltered =
    f.brands.length > 0 || f.types.length > 0 || !!f.search ||
    f.priceMin !== undefined || f.priceMax !== undefined ||
    f.showAll || f.withImage || !!f.categorySlug || !!f.sort || !!params.page;

  return {
    title: f.search ? `Пошук: ${f.search}` : "Каталог інструментів",
    description:
      "Каталог електро та ручного інструменту Budvik27: понад 40 000 товарів з цінами й наявністю. Перфоратори, болгарки, шуруповерти, ручний інструмент і оснастка.",
    alternates: {
      canonical: onlyBrand
        ? `/brand/${f.brands[0]}`
        : onlyType
          ? `/catalog/typ/${encodeURIComponent(f.types[0])}`
          : "/catalog",
    },
    robots: isFiltered ? { index: false, follow: true } : undefined,
  };
}

/**
 * Вітрина каталогу.
 *
 * Раніше бренди тут були фікцією: список із 50 зашитих назв, порахований
 * підрядком у назвах 300 випадкових товарів, а фільтр робив
 * `name contains «YATO»`. Це ловило чужі товари, де бренд згаданий у
 * сумісності, і губило ті, де в назві його немає. Тепер бренд береться з
 * таблиці Brand через brandId — тієї самої, якою вже користуються закупівлі
 * й аналітика.
 */
/**
 * Стеля номера сторінки.
 *
 * Без неї `?page=99999` — це окремий живий рендер із запитом у базу, і робот
 * може згенерувати їх скільки завгодно. 20.08 краулер Meta зробив 27,9 тис.
 * звернень до /catalog за годину — 78% усього трафіку сайту. Ста сторінок по
 * 24 товари вистачає будь-якій людині: глибше йдуть фільтром, а не гортанням.
 */
const MAX_PAGE = 100;

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const requestedPage = Math.max(1, parseInt(params.page || "1", 10));
  if (requestedPage > MAX_PAGE) notFound();
  const page = requestedPage;

  // Групи товарів показуємо в розрізі обраного бренда: «свердло» всередині
  // YATO — осмислений фільтр, а «свердло» по всьому каталогу на 49 тис.
  // позицій лише повторює пошук.
  //
  // Сесії тут навмисно немає: читання cookies мовчки вимикає ISR для всієї
  // сторінки, і 98% роздрібних відвідувачів чекали б живий рендер заради
  // оптової ціни для 2%. Оптовик добирає свою знижку на клієнті
  // (useWholesaleDiscounts у ProductCard).
  const singleBrand = filters.brands.length === 1 ? filters.brands[0] : null;
  const [{ products: rawProducts, total, isFuzzy }, tree, priceBounds, brandTypes, toc] = await Promise.all([
    fetchCatalogPage(filters, page),
    getBrandTree(),
    getPriceBounds(),
    singleBrand ? getBrandTypes(singleBrand) : Promise.resolve([]),
    getCatalogToc(),
  ]);

  /*
   * Дерево каталогу для лівої колонки.
   *
   * Групи товару досі з'являлись лише всередині одного бренда — тобто на
   * чистому /catalog фільтрувати не було чим, і єдиним способом звузити
   * видачу лишався бренд. Тепер, коли обрано розділ, показуємо його типи:
   * «Різальний інструмент» → круг, диск, свердло, бур. Це той самий зміст,
   * що на вітрині й на /catalog/zmist, тож числа скрізь однакові.
   */
  const sectionOptions = toc.sections.map((s) => ({
    id: s.id,
    title: s.title,
    types: s.types,
    count: s.total,
  }));
  const activeSection = sectionOfTypes(filters.types, sectionOptions);
  const sectionLines = activeSection
    ? toc.sections.find((s) => s.id === activeSection.id)?.lines ?? []
    : [];
  const wholeSection =
    activeSection &&
    filters.types.length === activeSection.types.length &&
    activeSection.types.every((t) => filters.types.includes(t));
  // Бренд звужує сильніше за розділ: якщо обрано один бренд, групи беремо в
  // його розрізі — «свердло» всередині YATO, а не по всьому каталогу.
  const types = singleBrand ? brandTypes : sectionLines;

  // Картці потрібен лише короткий анонс без розмітки — повний опис у
  // пропсах їхав би в HTML двічі (розмітка + RSC-payload для гідрації).
  const products = rawProducts.map((p) => ({
    ...p,
    description: p.description.replace(/<[^>]*>/g, "").slice(0, 220),
  }));

  // Приблизна видача — це одна купка схожих товарів, а не зріз каталогу:
  // сторінки по ній не мають сенсу, «Далі» вело б у порожнечу.
  const totalPages = isFuzzy ? 1 : Math.ceil(total / CATALOG_PAGE_SIZE);
  const allBrands = tree.main.concat(tree.tail);
  const activeBrands = allBrands.filter((b) => filters.brands.includes(b.slug));

  const title =
    activeBrands.length === 1
      ? activeBrands[0].name
      : filters.search
        ? `Пошук: «${filters.search}»`
        : wholeSection && activeSection
          ? activeSection.title
          : filters.types.length === 1
            ? filters.types[0].charAt(0).toUpperCase() + filters.types[0].slice(1)
            : "Каталог інструментів";

  const SORTS = [
    { value: "", label: "Рекомендовані" },
    { value: "price-asc", label: "Дешевші" },
    { value: "price-desc", label: "Дорожчі" },
    { value: "newest", label: "Новинки" },
    { value: "name-asc", label: "А → Я" },
  ];

  return (
    <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-8">
      {/* Запит і кількість знахідок для аналітики: сюди сходяться всі три
          поля пошуку, а нуль результатів — готовий список того, чого в
          каталозі бракує. */}
      {filters.search && <SearchTracker query={filters.search} total={total} />}
      <CatalogBreadcrumbs filters={filters} sections={sectionOptions} brandName={activeBrands[0]?.name ?? null} />

      <div className="mb-4">
        <h1 className="mb-1 text-2xl font-bold text-[#0A0A0A] sm:text-3xl">{title}</h1>
        <p className="text-sm text-[#9E9E9E] sm:text-base">
          {isFuzzy
            ? `За запитом «${filters.search}» точних збігів немає. Можливо, ви шукали:`
            : total > 0
              ? `Знайдено ${total.toLocaleString("uk-UA")} товарів`
              : "Товарів не знайдено"}
        </p>
      </div>

      <div className="mb-3 sm:mb-4">
        <AiSmartSearch currentSearch={filters.search} />
      </div>

      {/*
        Вхід у зміст за розділами. Головний спосіб орієнтуватись, коли людина
        не знає назви: 49 тис. позицій сіткою і фільтр за брендами не
        відповідають на питання «а що у вас є з малярного».
      */}
      <Link
        href="/catalog/zmist"
        className="mb-4 flex min-h-12 items-center justify-center gap-2 rounded-[10px] border border-[#E0E0E0] bg-white px-4 text-sm font-bold text-[#0A0A0A] transition hover:border-[#FFD600] hover:bg-[#FFD600]/10 active:bg-[#FFD600]/15 sm:mb-6"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
        </svg>
        Каталог за розділами
      </Link>

      <div className="mb-4">
        <div className="scrollbar-hide -mx-3 flex items-center gap-2 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0">
          <span className="mr-1 hidden flex-shrink-0 text-xs font-medium text-[#9E9E9E] sm:inline">
            Сортування:
          </span>
          {SORTS.map((opt) => (
            <Link
              key={opt.value}
              href={`/catalog${filtersToQuery({ ...filters, sort: opt.value })}`}
              // Сортування — двері в нескінченний простір адрес каталогу, і
              // саме з чистого /catalog робот у них заходить. Для людини
              // посилання лишається звичайним.
              rel="nofollow"
              className={`flex-shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                (filters.sort || "") === opt.value
                  ? "border-[#FFD600] bg-[#FFD600] font-semibold text-[#0A0A0A]"
                  : "border-[#E0E0E0] bg-white text-[#555] hover:bg-[#FAFAFA]"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      <ActiveFilterChips filters={filters} brands={allBrands} unbranded={tree.unbranded} sections={sectionOptions} />

      <div className="flex flex-col gap-4 sm:gap-6 md:flex-row">
        <aside className="w-full flex-shrink-0 md:w-72">
          <CatalogFilters
            brands={tree.main}
            tailBrands={tree.tail}
            unbranded={tree.unbranded}
            types={types}
            sections={sectionOptions}
            priceBounds={priceBounds}
          />
        </aside>

        <div className="min-w-0 flex-1">
          {products.length === 0 ? (
            <div className="py-16 text-center text-[#9E9E9E]">
              <p className="text-lg">Товарів не знайдено</p>
              <Link
                href="/catalog"
                className="mt-2 inline-block font-medium text-[#FFB800] transition hover:text-[#FFC400]"
              >
                Скинути фільтри
              </Link>
            </div>
          ) : (
            <>
              <CatalogGrid products={products} />

              {totalPages > 1 && (
                <nav className="mt-12 flex items-center justify-center gap-1.5">
                  {page > 1 && (
                    <Link
                      href={`/catalog${filtersToQuery(filters, page - 1)}`}
                      rel="nofollow"
                      className="rounded-[10px] border border-[#DADADA] bg-white px-4 py-2.5 text-sm font-medium text-[#1A1A1A] transition hover:bg-[#FAFAFA]"
                    >
                      ← Назад
                    </Link>
                  )}
                  {paginationRange(page, totalPages).map((p, i) =>
                    p === "..." ? (
                      <span key={`dots-${i}`} className="px-2 py-2 text-sm text-[#9E9E9E]">…</span>
                    ) : (
                      <Link
                        key={p}
                        href={`/catalog${filtersToQuery(filters, p as number)}`}
                        rel="nofollow"
                        className={`rounded-[10px] px-3.5 py-2.5 text-sm font-medium transition ${
                          p === page
                            ? "bg-[#0A0A0A] text-[#FFD600]"
                            : "border border-[#DADADA] bg-white text-[#1A1A1A] hover:bg-[#FAFAFA]"
                        }`}
                      >
                        {p}
                      </Link>
                    )
                  )}
                  {page < totalPages && (
                    <Link
                      href={`/catalog${filtersToQuery(filters, page + 1)}`}
                      rel="nofollow"
                      className="rounded-[10px] border border-[#DADADA] bg-white px-4 py-2.5 text-sm font-medium text-[#1A1A1A] transition hover:bg-[#FAFAFA]"
                    >
                      Далі →
                    </Link>
                  )}
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function paginationRange(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: (number | "...")[] = [1];
  if (current > 3) items.push("...");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) items.push(i);
  if (current < total - 2) items.push("...");
  items.push(total);
  return items;
}
