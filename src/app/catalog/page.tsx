import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";
import Link from "next/link";
import AiSmartSearch from "@/components/ai/AiSmartSearch";
import CatalogSidebar from "@/components/CatalogSidebar";
import { groupCategories, extractBrandsFromProducts } from "@/lib/category-tree";

const PAGE_SIZE = 24;

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ category?: string; search?: string; page?: string; brand?: string }> }) {
  const params = await searchParams;
  const categorySlug = params.category;
  const search = params.search;
  const brand = params.brand;
  const page = Math.max(1, parseInt(params.page || "1", 10));

  const where: any = { isActive: true };
  if (categorySlug) where.category = { slug: categorySlug };
  if (search) where.name = { contains: search, mode: "insensitive" };
  if (brand) where.name = { contains: brand, mode: "insensitive" };

  // If both search and brand, combine them
  if (search && brand) {
    where.AND = [
      { name: { contains: search, mode: "insensitive" } },
      { name: { contains: brand, mode: "insensitive" } },
    ];
    delete where.name;
  }

  const [products, total, categories, activeCategory, brandProducts] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: [{ stock: "desc" }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.product.count({ where }),
    prisma.category.findMany({
      where: { products: { some: { isActive: true } } },
      include: { _count: { select: { products: { where: { isActive: true } } } } },
      orderBy: { name: "asc" },
    }).then((cats) => cats.filter((c) => !/^\d+$/.test(c.name))),
    categorySlug
      ? prisma.category.findUnique({ where: { slug: categorySlug } })
      : null,
    // Get products for brand extraction (from current category or all)
    prisma.product.findMany({
      where: {
        isActive: true,
        ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      },
      select: { name: true },
      take: 5000,
    }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Group categories into tree
  const { grouped, ungrouped } = groupCategories(categories);

  // Extract brands
  const brands = extractBrandsFromProducts(brandProducts);

  // Build page URL
  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (categorySlug) params.set("category", categorySlug);
    if (search) params.set("search", search);
    if (brand) params.set("brand", brand);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/catalog${qs ? `?${qs}` : ""}`;
  }

  // Breadcrumb
  const activeGroup = grouped.find((g) =>
    g.categories.some((c) => c.slug === categorySlug)
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/" className="hover:text-orange-600">Головна</Link>
        <span>/</span>
        <Link href="/catalog" className={activeCategory ? "hover:text-orange-600" : "text-gray-900 font-medium"}>
          Каталог
        </Link>
        {activeGroup && (
          <>
            <span>/</span>
            <span className="text-gray-500">{activeGroup.group}</span>
          </>
        )}
        {activeCategory && (
          <>
            <span>/</span>
            <span className="text-gray-900 font-medium">{activeCategory.name}</span>
          </>
        )}
      </nav>

      <h1 className="text-3xl font-bold text-gray-900 mb-1">
        {activeCategory ? activeCategory.name : "Каталог інструментів"}
      </h1>
      <p className="text-gray-500 mb-6">
        {total > 0 ? `Знайдено ${total} товарів` : "Товарів не знайдено"}
        {brand && <span className="ml-2 bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full text-xs font-medium">{brand}</span>}
      </p>

      {/* AI Smart Search */}
      <div className="mb-8">
        <AiSmartSearch />
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Tree sidebar */}
        <CatalogSidebar
          grouped={grouped}
          ungrouped={ungrouped}
          brands={brands}
          activeCategory={categorySlug}
          activeBrand={brand}
          search={search}
        />

        {/* Products Grid */}
        <div className="flex-1 min-w-0">
          {products.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-lg">Товарів не знайдено</p>
              <Link href="/catalog" className="text-orange-600 hover:underline mt-2 inline-block">
                Переглянути всі товари
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {products.map((product) => (
                  <ProductCard key={product.id} {...product} category={product.category} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <nav className="flex items-center justify-center gap-1 mt-10">
                  {page > 1 && (
                    <Link
                      href={pageUrl(page - 1)}
                      className="px-3 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 transition"
                    >
                      &larr; Назад
                    </Link>
                  )}

                  {paginationRange(page, totalPages).map((p, i) =>
                    p === "..." ? (
                      <span key={`dots-${i}`} className="px-2 py-2 text-gray-400 text-sm">...</span>
                    ) : (
                      <Link
                        key={p}
                        href={pageUrl(p as number)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                          p === page
                            ? "bg-orange-600 text-white"
                            : "border border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {p}
                      </Link>
                    )
                  )}

                  {page < totalPages && (
                    <Link
                      href={pageUrl(page + 1)}
                      className="px-3 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 transition"
                    >
                      Далі &rarr;
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

  const items: (number | "...")[] = [];
  items.push(1);

  if (current > 3) items.push("...");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) items.push(i);

  if (current < total - 2) items.push("...");

  items.push(total);
  return items;
}
