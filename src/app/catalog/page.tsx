export const revalidate = 60;

import Link from "next/link";
import CatalogGrid from "@/components/CatalogGrid";
import AiSmartSearch from "@/components/ai/AiSmartSearch";
import CatalogFilters from "@/components/catalog/CatalogFilters";
import ActiveFilterChips from "@/components/catalog/ActiveFilterChips";
import { getBrandTree, getBrandTypes, getPriceBounds } from "@/lib/catalog/brand-tree";
import { parseFilters, fetchCatalogPage, filtersToQuery, CATALOG_PAGE_SIZE } from "@/lib/catalog/query";

type SP = Record<string, string | undefined>;

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
export default async function CatalogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const page = Math.max(1, parseInt(params.page || "1", 10));

  // Групи товарів показуємо в розрізі обраного бренда: «свердло» всередині
  // YATO — осмислений фільтр, а «свердло» по всьому каталогу на 49 тис.
  // позицій лише повторює пошук.
  //
  // Сесії тут навмисно немає: читання cookies мовчки вимикає ISR для всієї
  // сторінки, і 98% роздрібних відвідувачів чекали б живий рендер заради
  // оптової ціни для 2%. Оптовик добирає свою знижку на клієнті
  // (useWholesaleDiscounts у ProductCard).
  const singleBrand = filters.brands.length === 1 ? filters.brands[0] : null;
  const [{ products: rawProducts, total, isFuzzy }, tree, priceBounds, types] = await Promise.all([
    fetchCatalogPage(filters, page),
    getBrandTree(),
    getPriceBounds(),
    singleBrand ? getBrandTypes(singleBrand) : Promise.resolve([]),
  ]);

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
        : "Каталог інструментів";

  const SORTS = [
    { value: "", label: "За замовч." },
    { value: "price-asc", label: "Дешевші" },
    { value: "price-desc", label: "Дорожчі" },
    { value: "newest", label: "Новинки" },
    { value: "name-asc", label: "А → Я" },
  ];

  return (
    <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-8">
      <nav className="breadcrumb-scroll mb-4 flex items-center gap-2 text-sm text-[#9E9E9E] sm:mb-6">
        <Link href="/" className="transition duration-200 hover:text-[#FFB800]">Головна</Link>
        <span className="text-[#DADADA]">/</span>
        <Link href="/catalog" className="font-medium text-[#0A0A0A]">Каталог</Link>
        {activeBrands.length === 1 && (
          <>
            <span className="text-[#DADADA]">/</span>
            <span className="font-medium text-[#0A0A0A]">{activeBrands[0].name}</span>
          </>
        )}
      </nav>

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

      <ActiveFilterChips filters={filters} brands={allBrands} unbranded={tree.unbranded} />

      <div className="flex flex-col gap-4 sm:gap-6 md:flex-row">
        <aside className="w-full flex-shrink-0 md:w-72">
          <CatalogFilters
            brands={tree.main}
            tailBrands={tree.tail}
            unbranded={tree.unbranded}
            types={types}
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
