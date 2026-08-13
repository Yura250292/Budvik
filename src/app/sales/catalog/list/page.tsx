export const revalidate = 60;

import Link from "next/link";
import { SalesHeader } from "@/components/sales/SalesHeader";
import CatalogFilters from "@/components/catalog/CatalogFilters";
import ActiveFilterChips from "@/components/catalog/ActiveFilterChips";
import SalesProductList from "@/components/catalog/SalesProductList";
import { getBrandTree, getBrandTypes, getPriceBounds } from "@/lib/catalog/brand-tree";
import { parseFilters, fetchCatalogPage, filtersToQuery, CATALOG_PAGE_SIZE } from "@/lib/catalog/query";

type SP = Record<string, string | undefined>;

/**
 * Список товарів для показу клієнту.
 *
 * Показуємо роздрібну ціну, залишок і артикул — це те, що клієнт питає
 * першим. Фільтри ті самі, що й у вітрині: модуль один, тож посилання зі
 * змісту ведуть у той самий результат, що й ручний відбір.
 */
export default async function SalesCatalogListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const page = Math.max(1, parseInt(params.page || "1", 10));

  const [{ products, total }, tree, priceBounds] = await Promise.all([
    fetchCatalogPage(filters, page),
    getBrandTree(),
    getPriceBounds(),
  ]);

  const singleBrand = filters.brands.length === 1 ? filters.brands[0] : null;
  const types = singleBrand ? await getBrandTypes(singleBrand) : [];

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

      <div className="mx-auto max-w-lg px-4 pt-4">
        <div className="mb-3">
          <CatalogFilters
            brands={tree.main}
            tailBrands={tree.tail}
            unbranded={tree.unbranded}
            types={types}
            priceBounds={priceBounds}
            basePath="/sales/catalog/list"
          />
        </div>

        <ActiveFilterChips
          filters={filters}
          brands={allBrands}
          unbranded={tree.unbranded}
          basePath="/sales/catalog/list"
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
                    href={`/sales/catalog/list${filtersToQuery(filters, page - 1)}`}
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
                    href={`/sales/catalog/list${filtersToQuery(filters, page + 1)}`}
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
  );
}
