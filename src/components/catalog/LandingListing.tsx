import Link from "next/link";
import CatalogGrid from "@/components/CatalogGrid";
import { CATALOG_PAGE_SIZE } from "@/lib/catalog/query";

/**
 * Сітка товарів з пагінацією для SEO-лендінгів бренда і типу.
 *
 * Це навмисно не вся сторінка каталогу: лендінг живе на власному чистому
 * URL, і пагінація тут ходить по `${basePath}?page=N`, а не по клубку
 * query-фільтрів. Фільтрувати глибше людина йде у /catalog — посилання на
 * нього дає сторінка-господар.
 */
export default function LandingListing({
  products,
  total,
  page,
  basePath,
}: {
  products: Parameters<typeof CatalogGrid>[0]["products"];
  total: number;
  page: number;
  basePath: string;
}) {
  const totalPages = Math.ceil(total / CATALOG_PAGE_SIZE);
  const pageHref = (p: number) => (p <= 1 ? basePath : `${basePath}?page=${p}`);

  if (products.length === 0) {
    return (
      <div className="py-16 text-center text-[#9E9E9E]">
        <p className="text-lg">Товарів не знайдено</p>
        <Link
          href="/catalog"
          className="mt-2 inline-block font-medium text-[#FFB800] transition hover:text-[#FFC400]"
        >
          Перейти в каталог
        </Link>
      </div>
    );
  }

  return (
    <>
      <CatalogGrid products={products} />

      {totalPages > 1 && (
        <nav className="mt-12 flex items-center justify-center gap-1.5">
          {page > 1 && (
            <Link
              href={pageHref(page - 1)}
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
                href={pageHref(p as number)}
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
              href={pageHref(page + 1)}
              className="rounded-[10px] border border-[#DADADA] bg-white px-4 py-2.5 text-sm font-medium text-[#1A1A1A] transition hover:bg-[#FAFAFA]"
            >
              Далі →
            </Link>
          )}
        </nav>
      )}
    </>
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
