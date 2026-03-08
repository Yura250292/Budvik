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
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const sidebarContent = (
    <>
      {/* Categories tree */}
      <div className="bg-white rounded-xl overflow-hidden border border-[#EFEFEF]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.03), 0 6px 20px rgba(0,0,0,0.05)' }}>
        <div className="px-5 py-4 border-b border-[#EFEFEF]">
          <h3 className="font-bold text-[#0A0A0A] text-sm uppercase tracking-wide">Категорії</h3>
        </div>

        <div className="p-3">
          {/* All products */}
          <Link
            href="/catalog"
            className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition duration-200 ${
              !activeCategory
                ? "bg-[#FFD600] text-[#0A0A0A] font-semibold"
                : "hover:bg-[#F7F7F7] text-[#1A1A1A]"
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
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition duration-200 text-left ${
                    hasActive
                      ? "bg-[#FFD600]/10 text-[#0A0A0A]"
                      : "hover:bg-[#F7F7F7] text-[#1A1A1A]"
                  }`}
                  style={{ minHeight: '42px' }}
                >
                  <span className="text-base flex-shrink-0">{group.icon}</span>
                  <span className="flex-1 truncate">{group.group}</span>
                  <span className="text-xs text-[#9E9E9E] mr-1">{group.totalProducts}</span>
                  <svg
                    className={`w-4 h-4 text-[#9E9E9E] transition-transform duration-200 flex-shrink-0 ${
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
                  <div className="ml-7 border-l-2 border-[#EFEFEF] pl-2.5 pb-1">
                    {group.categories.map((cat) => (
                      <Link
                        key={cat.id}
                        href={buildUrl({ category: cat.slug })}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition duration-200 ${
                          activeCategory === cat.slug
                            ? "bg-[#FFD600] text-[#0A0A0A] font-semibold"
                            : "hover:bg-[#F7F7F7] text-[#555]"
                        }`}
                      >
                        <span className="truncate">{cat.name}</span>
                        <span className="text-xs text-[#9E9E9E] ml-2 flex-shrink-0">{cat._count.products}</span>
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
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition duration-200 text-left hover:bg-[#F7F7F7] text-[#1A1A1A]"
                style={{ minHeight: '42px' }}
              >
                <span className="text-base flex-shrink-0">📦</span>
                <span className="flex-1">Інше</span>
                <span className="text-xs text-[#9E9E9E] mr-1">
                  {ungrouped.reduce((s, c) => s + c._count.products, 0)}
                </span>
                <svg
                  className={`w-4 h-4 text-[#9E9E9E] transition-transform duration-200 flex-shrink-0 ${
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
                <div className="ml-7 border-l-2 border-[#EFEFEF] pl-2.5 pb-1">
                  {ungrouped
                    .sort((a, b) => b._count.products - a._count.products)
                    .map((cat) => (
                      <Link
                        key={cat.id}
                        href={buildUrl({ category: cat.slug })}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition duration-200 ${
                          activeCategory === cat.slug
                            ? "bg-[#FFD600] text-[#0A0A0A] font-semibold"
                            : "hover:bg-[#F7F7F7] text-[#555]"
                        }`}
                      >
                        <span className="truncate">{cat.name}</span>
                        <span className="text-xs text-[#9E9E9E] ml-2 flex-shrink-0">{cat._count.products}</span>
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
        <div className="bg-white rounded-xl overflow-hidden border border-[#EFEFEF]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.03), 0 6px 20px rgba(0,0,0,0.05)' }}>
          <div className="px-5 py-4 border-b border-[#EFEFEF]">
            <h3 className="font-bold text-[#0A0A0A] text-sm uppercase tracking-wide">Бренди</h3>
          </div>
          <div className="p-3">
            {activeBrand && (
              <Link
                href={buildUrl({ category: activeCategory })}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[#FFB800] hover:bg-[#FFD600]/10 transition duration-200 mb-1 font-medium"
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
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition duration-200 ${
                  activeBrand === b.brand
                    ? "bg-[#FFD600] text-[#0A0A0A] font-semibold"
                    : "hover:bg-[#F7F7F7] text-[#555]"
                }`}
              >
                <span>{b.brand}</span>
                <span className="text-xs text-[#9E9E9E]">{b.count}</span>
              </Link>
            ))}
            {brands.length > 10 && (
              <button
                onClick={() => setShowAllBrands(!showAllBrands)}
                className="w-full text-center text-sm text-[#FFB800] hover:text-[#FFC400] font-medium py-2.5 transition duration-200"
              >
                {showAllBrands ? "Згорнути" : `Показати всі (${brands.length})`}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );

  return (
    <aside className="w-full md:w-72 flex-shrink-0">
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="md:hidden w-full flex items-center justify-between bg-white border border-[#EFEFEF] rounded-xl px-4 py-3 mb-3 text-sm font-semibold text-[#0A0A0A] transition duration-200"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.03), 0 6px 20px rgba(0,0,0,0.05)', minHeight: '44px' }}
      >
        <span className="flex items-center gap-2">
          <svg className="w-5 h-5 text-[#9E9E9E]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Фільтри
        </span>
        <svg className={`w-5 h-5 text-[#9E9E9E] transition-transform duration-200 ${mobileOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Mobile content */}
      <div className={`md:hidden ${mobileOpen ? "block" : "hidden"}`}>
        <div className="space-y-4 mb-4">
          {sidebarContent}
        </div>
      </div>

      {/* Desktop content */}
      <div className="hidden md:block space-y-4">
        {sidebarContent}
      </div>
    </aside>
  );
}
