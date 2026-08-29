export const revalidate = 60;

import Link from "next/link";
import { SalesHeader } from "@/components/sales/SalesHeader";
import CatalogFilters from "@/components/catalog/CatalogFilters";
import ActiveFilterChips from "@/components/catalog/ActiveFilterChips";
import SalesProductList from "@/components/catalog/SalesProductList";
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

  const [{ products, total }, tree, priceBounds] = await Promise.all([
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
  const totalPages = Math.ceil(total / CATALOG_PAGE_SIZE);

  const title = activeBrands.length === 1 ? activeBrands[0].name : "Каталог";

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
            <p className="text-base">Товарів не знайдено</p>
            <Link href="/sales/catalog/list" className="mt-2 inline-block font-medium text-[#FFB800]">
              Скинути фільтри
            </Link>
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
