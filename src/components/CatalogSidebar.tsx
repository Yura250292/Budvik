"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface CategoryItem {
  id: string;
  name: string;
  slug: string;
  _count: { products: number };
}

interface GroupedCategory {
  group: string;
  icon: string;
  categories: CategoryItem[];
  totalProducts: number;
}

interface BrandItem {
  brand: string;
  count: number;
}

interface Props {
  grouped: GroupedCategory[];
  ungrouped: CategoryItem[];
  brands: BrandItem[];
  activeCategory?: string;
  activeBrand?: string;
  search?: string;
}

export default function CatalogSidebar({
  grouped,
  ungrouped,
  brands,
  activeCategory,
  activeBrand,
  search,
}: Props) {
  // Find which group contains the active category
  const activeGroupIndex = grouped.findIndex((g) =>
    g.categories.some((c) => c.slug === activeCategory)
  );

  const [openGroups, setOpenGroups] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    if (activeGroupIndex >= 0) initial.add(activeGroupIndex);
    return initial;
  });

  const [showAllBrands, setShowAllBrands] = useState(false);
  const [showUngrouped, setShowUngrouped] = useState(false);

  const toggleGroup = (index: number) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  function buildUrl(params: { category?: string; brand?: string }) {
    const sp = new URLSearchParams();
    if (params.category) sp.set("category", params.category);
    if (params.brand) sp.set("brand", params.brand);
    else if (activeBrand && params.category) sp.set("brand", activeBrand);
    if (search) sp.set("search", search);
    const qs = sp.toString();
    return `/catalog${qs ? `?${qs}` : ""}`;
  }

  const visibleBrands = showAllBrands ? brands : brands.slice(0, 10);

  return (
    <aside className="w-full md:w-72 flex-shrink-0 space-y-4">
      {/* Categories tree */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b">
          <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wide">Категорії</h3>
        </div>

        <div className="p-2">
          {/* All products */}
          <Link
            href="/catalog"
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition ${
              !activeCategory
                ? "bg-yellow-50 text-yellow-700 font-semibold"
                : "hover:bg-gray-50 text-gray-700"
            }`}
          >
            <span>Усі товари</span>
          </Link>

          {/* Grouped categories */}
          {grouped.map((group, idx) => {
            const isOpen = openGroups.has(idx);
            const hasActive = group.categories.some((c) => c.slug === activeCategory);

            return (
              <div key={group.group} className="mt-1">
                <button
                  onClick={() => toggleGroup(idx)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition text-left ${
                    hasActive
                      ? "bg-yellow-50 text-yellow-700"
                      : "hover:bg-gray-50 text-gray-800"
                  }`}
                >
                  <span className="text-base flex-shrink-0">{group.icon}</span>
                  <span className="flex-1 truncate">{group.group}</span>
                  <span className="text-xs text-gray-400 mr-1">{group.totalProducts}</span>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${
                      isOpen ? "rotate-90" : ""
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="ml-7 border-l border-gray-200 pl-2 pb-1">
                    {group.categories.map((cat) => (
                      <Link
                        key={cat.id}
                        href={buildUrl({ category: cat.slug })}
                        className={`flex items-center justify-between px-3 py-1.5 rounded text-sm transition ${
                          activeCategory === cat.slug
                            ? "bg-yellow-100 text-yellow-700 font-medium"
                            : "hover:bg-gray-50 text-gray-600"
                        }`}
                      >
                        <span className="truncate">{cat.name}</span>
                        <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{cat._count.products}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Ungrouped categories */}
          {ungrouped.length > 0 && (
            <div className="mt-1">
              <button
                onClick={() => setShowUngrouped(!showUngrouped)}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition text-left hover:bg-gray-50 text-gray-800"
              >
                <span className="text-base flex-shrink-0">📦</span>
                <span className="flex-1">Інше</span>
                <span className="text-xs text-gray-400 mr-1">
                  {ungrouped.reduce((s, c) => s + c._count.products, 0)}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${
                    showUngrouped ? "rotate-90" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {showUngrouped && (
                <div className="ml-7 border-l border-gray-200 pl-2 pb-1">
                  {ungrouped
                    .sort((a, b) => b._count.products - a._count.products)
                    .map((cat) => (
                      <Link
                        key={cat.id}
                        href={buildUrl({ category: cat.slug })}
                        className={`flex items-center justify-between px-3 py-1.5 rounded text-sm transition ${
                          activeCategory === cat.slug
                            ? "bg-yellow-100 text-yellow-700 font-medium"
                            : "hover:bg-gray-50 text-gray-600"
                        }`}
                      >
                        <span className="truncate">{cat.name}</span>
                        <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{cat._count.products}</span>
                      </Link>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Brands filter */}
      {brands.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b">
            <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wide">Бренди</h3>
          </div>
          <div className="p-2">
            {activeBrand && (
              <Link
                href={buildUrl({ category: activeCategory })}
                className="flex items-center gap-2 px-3 py-1.5 rounded text-sm text-yellow-600 hover:bg-yellow-50 transition mb-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Скинути фільтр
              </Link>
            )}
            {visibleBrands.map((b) => (
              <Link
                key={b.brand}
                href={buildUrl({ category: activeCategory, brand: b.brand })}
                className={`flex items-center justify-between px-3 py-1.5 rounded text-sm transition ${
                  activeBrand === b.brand
                    ? "bg-yellow-100 text-yellow-700 font-medium"
                    : "hover:bg-gray-50 text-gray-600"
                }`}
              >
                <span>{b.brand}</span>
                <span className="text-xs text-gray-400">{b.count}</span>
              </Link>
            ))}
            {brands.length > 10 && (
              <button
                onClick={() => setShowAllBrands(!showAllBrands)}
                className="w-full text-center text-sm text-yellow-600 hover:underline py-2"
              >
                {showAllBrands ? "Згорнути" : `Показати всі (${brands.length})`}
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
