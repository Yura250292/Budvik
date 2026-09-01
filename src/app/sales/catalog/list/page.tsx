export const revalidate = 60;

import Link from "next/link";
import { SalesHeader } from "@/components/sales/SalesHeader";
import CatalogFilters from "@/components/catalog/CatalogFilters";
import ActiveFilterChips from "@/components/catalog/ActiveFilterChips";
import SalesProductList from "@/components/catalog/SalesProductList";
import SalesCatalogSearch from "@/components/sales/SalesCatalogSearch";
import { getBrandTree, getBrandTypes, getPriceBounds } from "@/lib/catalog/brand-tree";
import { getCatalogToc } from "@/lib/catalog/sections";
import { parseFilters, fetchCatalogPage, filtersToQuery, CATALOG_PAGE_SIZE } from "@/lib/catalog/query";

type SP = Record<string, string | undefined>;

/** Дефолт секції для посилань: у кабінеті «показати відсутні» увімкнено. */
const SALES_QUERY = { defaultShowAll: true } as const;

/**
 * Список товарів для показу клієнту.
 *
 * Показуємо роздрібну ціну, залишок і артикул — це те, що клієнт питає
 * першим. Фільтри ті самі, що й у вітрині: модуль один, тож посилання зі
 * змісту ведуть у той самий результат, що й ручний відбір.
 */
export default async function SalesCatalogListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  /*
    Торговий бачить увесь асортимент, а не лише наявне: відсутню позицію він
    бере під замовлення, і сховати її означало б сховати продаж. Покупцю в
    магазині навпаки — там showAll лишається вимкненим.

    Це саме дефолт, а не жорстке true, як було раніше: із жорстким галочка
    «Показати відсутні» стояла порожньою на екрані, де відсутні вже показані,
    зняти її було нічим, а чип «З відсутніми» не знімався взагалі — посилання
    вело на ту саму адресу. Тепер ?all=0 у кабінеті означає «лише наявне».
  */
  const filters = { ...parseFilters(params), showAll: params.all !== "0" };
  const page = Math.max(1, parseInt(params.page || "1", 10));

  const [{ products, total, isFuzzy }, tree, priceBounds] = await Promise.all([
    fetchCatalogPage(filters, page),
    getBrandTree(),
    getPriceBounds(),
  ]);

  const singleBrand = filters.brands.length === 1 ? filters.brands[0] : null;
  /*
   * Групи товару: у розрізі бренда, якщо обрано один, інакше — групи
   * обраного розділу. Без другої гілки торговий, що прийшов зі змісту
   * розділом, не мав чим звузити видачу на 1236 позицій оснастки.
   */
  const toc = await getCatalogToc();
  const types = singleBrand
    // shoppable: false явно — кабінет бере відсутню позицію під замовлення,
    // тож ховати від торгового групи без залишку не можна.
    ? await getBrandTypes(singleBrand, { section: filters.section, shoppable: false })
    : toc.sections.find((s) => s.id === filters.section)?.lines ?? [];
  const sectionOptions = toc.sections.map((s) => ({ id: s.id, title: s.title, count: s.total }));

  const allBrands = tree.main.concat(tree.tail);
  const activeBrands = allBrands.filter((b) => filters.brands.includes(b.slug));
  // Рятувальна видача — одна сторінка схожого, гортати там нічого.
  const totalPages = isFuzzy ? 1 : Math.ceil(total / CATALOG_PAGE_SIZE);

  const title = activeBrands.length === 1 ? activeBrands[0].name : "Каталог";
  /*
   * Чи звужено видачу чимось, крім самого запиту. На порожній видачі з
   * пошуком це вирішує, що пропонувати: скинути звуження чи змінити слово.
   */
  const narrowed =
    filters.brands.length > 0 || filters.types.length > 0 || !!filters.section || !filters.showAll;

  return (
    <div className="min-h-screen bg-background">
      <SalesHeader
        title={title}
        subtitle={`${total.toLocaleString("uk-UA")} позицій`}
        backTo="/sales/catalog"
      />

      {/* Ширше на планшеті: його тримають горизонтально й показують клієнту */}
      <div className="mx-auto max-w-lg px-4 pt-4 md:max-w-4xl lg:max-w-5xl">
        {/*
          Поле пошуку над усім, зокрема над бічною колонкою на планшеті: клієнт
          називає наступний артикул, поки торговий ще дивиться попередній.
          key перезбирає поле при зміні запиту в адресі — інакше після
          переходу з підказки в полі лишався б старий текст.
        */}
        <div className="mb-4">
          <SalesCatalogSearch key={filters.search ?? ""} initialQuery={filters.search ?? ""} />
        </div>

        {isFuzzy && (
          <p className="mb-3 text-sm text-cab-t2">
            За запитом «{filters.search}» точних збігів немає. Можливо, ви шукали:
          </p>
        )}

        {/*
          На телефоні фільтри — кнопка з панеллю зверху; від планшета вони
          стають бічною колонкою, і товар видно одночасно з фільтрами.
        */}
        <div className="flex flex-col gap-4 md:flex-row">
          <aside className="w-full flex-shrink-0 md:w-64">
            <CatalogFilters
              brands={tree.main}
              tailBrands={tree.tail}
              unbranded={tree.unbranded}
              types={types}
              sections={sectionOptions}
              priceBounds={priceBounds}
              basePath="/sales/catalog/list"
              defaultShowAll
            />
          </aside>

          <div className="min-w-0 flex-1">
        <ActiveFilterChips
          filters={filters}
          brands={allBrands}
          unbranded={tree.unbranded}
          basePath="/sales/catalog/list"
          defaultShowAll
        />

        {products.length === 0 ? (
          <div className="py-16 text-center text-g400">
            <p className="text-base">
              {filters.search ? `За запитом «${filters.search}» нічого не знайдено` : "Товарів не знайдено"}
            </p>
            {/*
              Запит + звуження — спершу пропонуємо прибрати звуження: артикул
              із підказки шукався по всьому каталогу, а список міг стояти в
              межах іншого бренда. Без звуження лишається змінити саме слово.
            */}
            {filters.search && narrowed ? (
              <Link
                href={`/sales/catalog/list?search=${encodeURIComponent(filters.search)}`}
                className="mt-2 inline-block font-medium text-[#FFB800]"
              >
                Шукати «{filters.search}» по всьому каталогу
              </Link>
            ) : (
              <>
                {filters.search && (
                  <p className="mt-1 text-sm">Спробуйте артикул без пробілів або інше слово з назви</p>
                )}
                <Link href="/sales/catalog/list" className="mt-2 inline-block font-medium text-[#FFB800]">
                  {filters.search ? "Скинути пошук" : "Скинути фільтри"}
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <SalesProductList products={products} />

            {totalPages > 1 && (
              <nav className="mt-6 flex items-center justify-center gap-2 pb-4">
                {page > 1 && (
                  <Link
                    href={`/sales/catalog/list${filtersToQuery(filters, page - 1, SALES_QUERY)}`}
                    className="flex min-h-11 items-center rounded-[10px] border border-g300 bg-white px-4 text-sm font-medium text-[#1A1A1A] active:bg-g50"
                  >
                    ← Назад
                  </Link>
                )}
                <span className="text-sm text-g500">
                  {page} / {totalPages}
                </span>
                {page < totalPages && (
                  <Link
                    href={`/sales/catalog/list${filtersToQuery(filters, page + 1, SALES_QUERY)}`}
                    className="flex min-h-11 items-center rounded-[10px] border border-g300 bg-white px-4 text-sm font-medium text-[#1A1A1A] active:bg-g50"
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
    </div>
  );
}
