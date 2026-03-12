export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import ProductCard from "@/components/ProductCard";
import CatalogGrid from "@/components/CatalogGrid";
import Link from "next/link";
import AiSmartSearch from "@/components/ai/AiSmartSearch";
import CatalogSidebar from "@/components/CatalogSidebar";
import { groupCategories, extractBrandsFromProducts } from "@/lib/category-tree";
import { getBrandDiscounts, getWholesalePrice } from "@/lib/wholesale-pricing";

const PAGE_SIZE = 24;

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ category?: string; search?: string; page?: string; brand?: string; sort?: string }> }) {
  const params = await searchParams;
  const categorySlug = params.category;
  const search = params.search;
  const brand = params.brand;
  const sort = params.sort;
  const page = Math.max(1, parseInt(params.page || "1", 10));

  const where: any = { isActive: true };
  if (categorySlug) where.category = { slug: categorySlug };
  if (search) {
    // Search in product name and category name only (not description — too many false positives)
    const searchTerms = search
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w: string) => w.length > 1);

    if (searchTerms.length > 1) {
      // Multi-word: require ALL terms to match in name or category
      where.AND = [
        ...(where.AND || []),
        ...searchTerms.map((term: string) => ({
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { category: { name: { contains: term, mode: "insensitive" } } },
          ],
        })),
      ];
    } else {
      // Single word: match in name or category
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { category: { name: { contains: search, mode: "insensitive" } } },
      ];
    }
  }
  if (brand && !search) {
    where.name = { contains: brand, mode: "insensitive" };
  }

  // If both search and brand, add brand filter
  if (search && brand) {
    where.AND = [
      { name: { contains: brand, mode: "insensitive" } },
    ];
  }

  // Build orderBy based on sort param
  const orderByMap: Record<string, any[]> = {
    "price-asc": [{ price: "asc" }],
    "price-desc": [{ price: "desc" }],
    "name-asc": [{ name: "asc" }],
    "name-desc": [{ name: "desc" }],
    "newest": [{ createdAt: "desc" }],
  };
  // Default: priority (high first) → in stock first → name
  const orderBy = orderByMap[sort || ""] || [{ priority: "desc" }, { stock: "desc" }, { name: "asc" }];

  // Daily rotation seed for default sort — shifts products so visitors see different items each day
  const useRotation = !sort;
  const daySeed = Math.floor(Date.now() / (1000 * 60 * 60 * 24)); // changes daily

  const session = await getServerSession(authOptions);
  const isWholesale = session?.user?.role === "WHOLESALE";
  const brandDiscounts = isWholesale ? await getBrandDiscounts() : new Map<string, number>();

  // For default sort: fetch products with images first, then fill remaining slots
  const isDefaultSort = !sort;
  const skip = (page - 1) * PAGE_SIZE;

  let rawProducts: any[];
  let total: number;

  if (isDefaultSort) {
    // Two-pass fetch: products with images first, then without
    const whereHasImage = { ...where, AND: [...(where.AND || []), { image: { not: null } }, { NOT: { image: "" } }] };
    const whereNoImage = { ...where, AND: [...(where.AND || []), { OR: [{ image: null }, { image: "" }] }] };

    const [totalAll, totalWithImage] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.count({ where: whereHasImage }),
    ]);
    total = totalAll;

    if (skip < totalWithImage) {
      // This page starts within "with image" products
      const withImageProducts = await prisma.product.findMany({
        where: whereHasImage,
        include: { category: true },
        orderBy,
        skip,
        take: PAGE_SIZE,
      });
      if (withImageProducts.length < PAGE_SIZE) {
        // Fill remaining slots with no-image products
        const remaining = PAGE_SIZE - withImageProducts.length;
        const noImageProducts = await prisma.product.findMany({
          where: whereNoImage,
          include: { category: true },
          orderBy,
          take: remaining,
        });
        rawProducts = [...withImageProducts, ...noImageProducts];
      } else {
        rawProducts = withImageProducts;
      }
    } else {
      // This page is entirely in "no image" territory
      const noImageSkip = skip - totalWithImage;
      rawProducts = await prisma.product.findMany({
        where: whereNoImage,
        include: { category: true },
        orderBy,
        skip: noImageSkip,
        take: PAGE_SIZE,
      });
    }
  } else {
    [rawProducts, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: true },
        orderBy,
        skip,
        take: PAGE_SIZE,
      }),
      prisma.product.count({ where }),
    ]);
  }

  const [categories, activeCategory, brandProducts] = await Promise.all([
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
      take: 300,
    }),
  ]);

  // Daily rotation: on default sort + page 1, shuffle non-priority products
  let products = rawProducts;
  if (useRotation && page === 1) {
    const pinned = rawProducts.filter((p: any) => p.priority > 0);
    const regular = rawProducts.filter((p: any) => p.priority === 0);
    // Deterministic shuffle based on day — same order all day, different next day
    const shuffled = regular
      .map((p: any) => ({ p, sort: hashCode(p.id + daySeed) }))
      .sort((a: any, b: any) => a.sort - b.sort)
      .map(({ p }: any) => p);
    // In-stock first within shuffled (images already prioritized by DB query)
    const inStock = shuffled.filter((p: any) => p.stock > 0);
    const outOfStock = shuffled.filter((p: any) => p.stock <= 0);
    products = [...pinned, ...inStock, ...outOfStock];
  }

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
    if (sort) params.set("sort", sort);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/catalog${qs ? `?${qs}` : ""}`;
  }

  // Flat list of all categories for mobile pills
  const allCategories = [
    ...grouped.flatMap((g) => g.categories),
    ...ungrouped,
  ].sort((a, b) => b._count.products - a._count.products);

  // Build URL helper for sort/category pills
  function buildSortUrl(p: { category?: string; brand?: string; sort?: string }) {
    const sp = new URLSearchParams();
    if (p.category) sp.set("category", p.category);
    if (search) sp.set("search", search);
    if (p.brand) sp.set("brand", p.brand);
    if (p.sort) sp.set("sort", p.sort);
    const qs = sp.toString();
    return `/catalog${qs ? `?${qs}` : ""}`;
  }

  // Breadcrumb
  const activeGroup = grouped.find((g) =>
    g.categories.some((c) => c.slug === categorySlug)
  );

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
      {/* Breadcrumb */}
      <nav className="breadcrumb-scroll flex items-center gap-2 text-sm text-[#9E9E9E] mb-4 sm:mb-6">
        <Link href="/" className="hover:text-[#FFB800] transition duration-200">Головна</Link>
        <span className="text-[#DADADA]">/</span>
        <Link href="/catalog" className={activeCategory ? "hover:text-[#FFB800] transition duration-200" : "text-[#0A0A0A] font-medium"}>
          Каталог
        </Link>
        {activeGroup && (
          <>
            <span className="text-[#DADADA]">/</span>
            <span className="text-[#9E9E9E]">{activeGroup.group}</span>
          </>
        )}
        {activeCategory && (
          <>
            <span className="text-[#DADADA]">/</span>
            <span className="text-[#0A0A0A] font-medium">{activeCategory.name}</span>
          </>
        )}
        {search && (
          <>
            <span className="text-[#DADADA]">/</span>
            <span className="text-[#0A0A0A] font-medium">Пошук</span>
          </>
        )}
      </nav>

      <h1 className="text-2xl sm:text-3xl font-bold text-[#0A0A0A] mb-1">
        {search ? `Результати пошуку: "${search}"` : activeCategory ? activeCategory.name : "Каталог інструментів"}
      </h1>
      <p className="text-sm sm:text-base text-[#9E9E9E] mb-4 sm:mb-8">
        {total > 0 ? `Знайдено ${total} товарів` : "Товарів не знайдено"}
        {brand && <span className="ml-2 bg-[#FFD600]/15 text-[#0A0A0A] px-2.5 py-0.5 rounded-md text-xs font-semibold">{brand}</span>}
      </p>

      {/* AI Smart Search */}
      <div className="mb-4 sm:mb-8">
        <AiSmartSearch currentSearch={search} />
      </div>

      {/* Mobile: Category pills */}
      <div className="md:hidden mb-3 -mx-3 px-3">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          <Link
            href={buildSortUrl({ sort })}
            className={`flex-shrink-0 px-3 py-2 rounded-full text-xs font-semibold border transition ${
              !categorySlug
                ? "bg-[#0A0A0A] text-[#FFD600] border-[#0A0A0A]"
                : "bg-white text-[#555] border-[#E0E0E0] active:bg-[#F5F5F5]"
            }`}
          >
            Усі
          </Link>
          {allCategories.map((cat) => (
            <Link
              key={cat.id}
              href={buildSortUrl({ category: cat.slug, sort })}
              className={`flex-shrink-0 px-3 py-2 rounded-full text-xs font-semibold border transition whitespace-nowrap ${
                categorySlug === cat.slug
                  ? "bg-[#0A0A0A] text-[#FFD600] border-[#0A0A0A]"
                  : "bg-white text-[#555] border-[#E0E0E0] active:bg-[#F5F5F5]"
              }`}
            >
              {cat.name}
            </Link>
          ))}
        </div>
      </div>

      {/* Sort pills — visible on both mobile and desktop */}
      <div className="mb-4 -mx-3 px-3 sm:mx-0 sm:px-0">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide items-center">
          <span className="flex-shrink-0 text-xs text-[#9E9E9E] font-medium mr-1 hidden sm:inline">Сортування:</span>
          {[
            { value: "", label: "За замовч." },
            { value: "price-asc", label: "Дешевші" },
            { value: "price-desc", label: "Дорожчі" },
            { value: "newest", label: "Новинки" },
            { value: "name-asc", label: "А → Я" },
          ].map((opt) => (
            <Link
              key={opt.value}
              href={buildSortUrl({ category: categorySlug, brand, sort: opt.value })}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition whitespace-nowrap ${
                (sort || "") === opt.value
                  ? "bg-[#FFD600] text-[#0A0A0A] border-[#FFD600] font-semibold"
                  : "bg-white text-[#555] border-[#E0E0E0] hover:bg-[#FAFAFA] active:bg-[#F0F0F0]"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 sm:gap-8">
        {/* Tree sidebar */}
        <CatalogSidebar
          grouped={grouped}
          ungrouped={ungrouped}
          brands={brands}
          activeCategory={categorySlug}
          activeBrand={brand}
          search={search}
          activeSort={sort}
        />

        {/* Products Grid */}
        <div className="flex-1 min-w-0">
          {products.length === 0 ? (
            <div className="text-center py-16 text-[#9E9E9E]">
              <p className="text-lg">Товарів не знайдено</p>
              <Link href="/catalog" className="text-[#FFB800] hover:text-[#FFC400] font-medium mt-2 inline-block transition duration-200">
                Переглянути всі товари
              </Link>
            </div>
          ) : (
            <>
              <CatalogGrid
                products={products.map((product) => ({
                  ...product,
                  wholesalePrice: isWholesale
                    ? getWholesalePrice(product.price, product.name, brandDiscounts, product.wholesalePrice)
                    : undefined,
                }))}
              />

              {/* Pagination */}
              {totalPages > 1 && (
                <nav className="flex items-center justify-center gap-1.5 mt-12">
                  {page > 1 && (
                    <Link
                      href={pageUrl(page - 1)}
                      className="px-4 py-2.5 rounded-[10px] border border-[#DADADA] bg-white text-sm hover:bg-[#FAFAFA] transition duration-200 font-medium text-[#1A1A1A]"
                    >
                      &larr; Назад
                    </Link>
                  )}

                  {paginationRange(page, totalPages).map((p, i) =>
                    p === "..." ? (
                      <span key={`dots-${i}`} className="px-2 py-2 text-[#9E9E9E] text-sm">...</span>
                    ) : (
                      <Link
                        key={p}
                        href={pageUrl(p as number)}
                        className={`px-3.5 py-2.5 rounded-[10px] text-sm font-medium transition duration-200 ${
                          p === page
                            ? "bg-[#0A0A0A] text-[#FFD600]"
                            : "border border-[#DADADA] bg-white hover:bg-[#FAFAFA] text-[#1A1A1A]"
                        }`}
                      >
                        {p}
                      </Link>
                    )
                  )}

                  {page < totalPages && (
                    <Link
                      href={pageUrl(page + 1)}
                      className="px-4 py-2.5 rounded-[10px] border border-[#DADADA] bg-white text-sm hover:bg-[#FAFAFA] transition duration-200 font-medium text-[#1A1A1A]"
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

// Simple deterministic hash for daily rotation
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
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
