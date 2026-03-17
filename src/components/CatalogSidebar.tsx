"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
  activeSort?: string;
}

type DrawerTab = "categories" | "filter";

const SORT_OPTIONS = [
  { value: "", label: "За замовчуванням", icon: "📋" },
  { value: "price-asc", label: "Найдешевші", icon: "💰" },
  { value: "price-desc", label: "Найдорожчі", icon: "💎" },
  { value: "name-asc", label: "За назвою А→Я", icon: "🔤" },
  { value: "name-desc", label: "За назвою Я→А", icon: "🔠" },
  { value: "newest", label: "Новинки", icon: "🆕" },
];

export default function CatalogSidebar({
  grouped,
  ungrouped,
  brands,
  activeCategory,
  activeBrand,
  search,
  activeSort,
}: Props) {
  const pathname = usePathname();

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("categories");
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<{ startX: number; startY: number; locked: boolean | null } | null>(null);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Lock body scroll when drawer is open (Chrome Android compatible)
  useEffect(() => {
    if (drawerOpen) {
      const scrollY = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.overflow = "hidden";
      setDragX(0);
      setIsDragging(false);
    } else {
      const scrollY = Math.abs(parseInt(document.body.style.top || "0", 10));
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.overflow = "";
      window.scrollTo(0, scrollY);
    }
    return () => {
      const scrollY = Math.abs(parseInt(document.body.style.top || "0", 10));
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.overflow = "";
      if (scrollY) window.scrollTo(0, scrollY);
    };
  }, [drawerOpen]);

  // Swipe-to-close drawer
  const onDrawerTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchRef.current = { startX: touch.clientX, startY: touch.clientY, locked: null };
    setIsDragging(false);
  }, []);

  const onDrawerTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchRef.current.startX;
    const dy = Math.abs(touch.clientY - touchRef.current.startY);

    // Determine direction lock
    if (touchRef.current.locked === null && (Math.abs(dx) > 8 || dy > 8)) {
      touchRef.current.locked = Math.abs(dx) > dy;
    }

    if (!touchRef.current.locked) return;

    // Only allow dragging to the left (closing)
    const clampedX = Math.min(0, dx);
    setDragX(clampedX);
    setIsDragging(true);
  }, []);

  const onDrawerTouchEnd = useCallback(() => {
    if (!touchRef.current) return;
    const wasDragging = isDragging;
    touchRef.current = null;

    if (!wasDragging) {
      setDragX(0);
      setIsDragging(false);
      return;
    }

    // If dragged more than 30% of drawer width, close it
    const drawerWidth = drawerRef.current?.offsetWidth || 320;
    if (Math.abs(dragX) > drawerWidth * 0.3) {
      setDragX(-drawerWidth);
      setTimeout(() => {
        setDrawerOpen(false);
        setDragX(0);
        setIsDragging(false);
      }, 200);
    } else {
      setDragX(0);
      setIsDragging(false);
    }
  }, [dragX, isDragging]);

  const toggleGroup = (index: number) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  function buildUrl(params: { category?: string; brand?: string; sort?: string }) {
    const sp = new URLSearchParams();
    if (params.category) sp.set("category", params.category);
    if (params.brand) sp.set("brand", params.brand);
    else if (activeBrand && params.category) sp.set("brand", activeBrand);
    if (search) sp.set("search", search);
    const sortVal = params.sort !== undefined ? params.sort : activeSort;
    if (sortVal) sp.set("sort", sortVal);
    const qs = sp.toString();
    return `/catalog${qs ? `?${qs}` : ""}`;
  }

  const visibleBrands = showAllBrands ? brands : brands.slice(0, 10);

  const sidebarContent = (
    <>
      {/* Categories tree */}
      <div className="bg-white rounded-xl overflow-hidden border border-[#EFEFEF] md:shadow-[0_1px_3px_rgba(0,0,0,0.03),0_6px_20px_rgba(0,0,0,0.05)]">
        <div className="px-4 py-3 border-b border-[#EFEFEF]">
          <h3 className="font-bold text-[#0A0A0A] text-sm uppercase tracking-wide">Категорії</h3>
        </div>

        <div className="p-2">
          <Link
            href="/catalog"
            className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition duration-200 ${
              !activeCategory
                ? "bg-[#FFD600] text-[#0A0A0A] font-semibold"
                : "hover:bg-[#F7F7F7] text-[#1A1A1A] active:bg-[#EFEFEF]"
            }`}
            style={{ minHeight: '44px' }}
          >
            <span>Усі товари</span>
          </Link>

          {grouped.map((group, idx) => {
            const isOpen = openGroups.has(idx);
            const hasActive = group.categories.some((c) => c.slug === activeCategory);

            return (
              <div key={group.group} className="mt-0.5">
                <button
                  onClick={() => toggleGroup(idx)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition duration-200 text-left ${
                    hasActive
                      ? "bg-[#FFD600]/10 text-[#0A0A0A]"
                      : "hover:bg-[#F7F7F7] text-[#1A1A1A] active:bg-[#EFEFEF]"
                  }`}
                  style={{ minHeight: '44px' }}
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
                  <div className="ml-7 border-l-2 border-[#EFEFEF] pl-2 pb-1">
                    {group.categories.map((cat) => (
                      <Link
                        key={cat.id}
                        href={buildUrl({ category: cat.slug })}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition duration-200 ${
                          activeCategory === cat.slug
                            ? "bg-[#FFD600] text-[#0A0A0A] font-semibold"
                            : "hover:bg-[#F7F7F7] text-[#555] active:bg-[#EFEFEF]"
                        }`}
                        style={{ minHeight: '40px' }}
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

          {ungrouped.length > 0 && (
            <div className="mt-0.5">
              <button
                onClick={() => setShowUngrouped(!showUngrouped)}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition duration-200 text-left hover:bg-[#F7F7F7] text-[#1A1A1A] active:bg-[#EFEFEF]"
                style={{ minHeight: '44px' }}
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
                <div className="ml-7 border-l-2 border-[#EFEFEF] pl-2 pb-1">
                  {ungrouped
                    .sort((a, b) => b._count.products - a._count.products)
                    .map((cat) => (
                      <Link
                        key={cat.id}
                        href={buildUrl({ category: cat.slug })}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition duration-200 ${
                          activeCategory === cat.slug
                            ? "bg-[#FFD600] text-[#0A0A0A] font-semibold"
                            : "hover:bg-[#F7F7F7] text-[#555] active:bg-[#EFEFEF]"
                        }`}
                        style={{ minHeight: '40px' }}
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
        <div className="bg-white rounded-xl overflow-hidden border border-[#EFEFEF] md:shadow-[0_1px_3px_rgba(0,0,0,0.03),0_6px_20px_rgba(0,0,0,0.05)]">
          <div className="px-4 py-3 border-b border-[#EFEFEF]">
            <h3 className="font-bold text-[#0A0A0A] text-sm uppercase tracking-wide">Бренди</h3>
          </div>
          <div className="p-2">
            {activeBrand && (
              <Link
                href={buildUrl({ category: activeCategory })}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[#FFB800] hover:bg-[#FFD600]/10 transition duration-200 mb-1 font-medium"
                style={{ minHeight: '44px' }}
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
                    : "hover:bg-[#F7F7F7] text-[#555] active:bg-[#EFEFEF]"
                }`}
                style={{ minHeight: '40px' }}
              >
                <span className="truncate">{b.brand}</span>
                <span className="text-xs text-[#9E9E9E]">{b.count}</span>
              </Link>
            ))}
            {brands.length > 10 && (
              <button
                onClick={() => setShowAllBrands(!showAllBrands)}
                className="w-full text-center text-sm text-[#FFB800] hover:text-[#FFC400] font-medium py-2.5 transition duration-200"
                style={{ minHeight: '44px' }}
              >
                {showAllBrands ? "Згорнути" : `Показати всі (${brands.length})`}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );

  const filterContent = (
    <>
      {/* Sort options */}
      <div className="bg-white rounded-xl overflow-hidden border border-[#EFEFEF] md:shadow-[0_1px_3px_rgba(0,0,0,0.03),0_6px_20px_rgba(0,0,0,0.05)]">
        <div className="px-4 py-3 border-b border-[#EFEFEF]">
          <h3 className="font-bold text-[#0A0A0A] text-sm uppercase tracking-wide">Сортування</h3>
        </div>
        <div className="p-2">
          {SORT_OPTIONS.map((opt) => (
            <Link
              key={opt.value}
              href={buildUrl({ category: activeCategory, sort: opt.value })}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition duration-200 ${
                (activeSort || "") === opt.value
                  ? "bg-[#FFD600] text-[#0A0A0A] font-semibold"
                  : "hover:bg-[#F7F7F7] text-[#1A1A1A] active:bg-[#EFEFEF]"
              }`}
              style={{ minHeight: '44px' }}
            >
              <span className="text-base flex-shrink-0">{opt.icon}</span>
              <span>{opt.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Brands filter (also in filter tab) */}
      {brands.length > 0 && (
        <div className="bg-white rounded-xl overflow-hidden border border-[#EFEFEF] md:shadow-[0_1px_3px_rgba(0,0,0,0.03),0_6px_20px_rgba(0,0,0,0.05)]">
          <div className="px-4 py-3 border-b border-[#EFEFEF]">
            <h3 className="font-bold text-[#0A0A0A] text-sm uppercase tracking-wide">Бренди</h3>
          </div>
          <div className="p-2">
            {activeBrand && (
              <Link
                href={buildUrl({ category: activeCategory })}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[#FFB800] hover:bg-[#FFD600]/10 transition duration-200 mb-1 font-medium"
                style={{ minHeight: '44px' }}
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
                    : "hover:bg-[#F7F7F7] text-[#555] active:bg-[#EFEFEF]"
                }`}
                style={{ minHeight: '40px' }}
              >
                <span className="truncate">{b.brand}</span>
                <span className="text-xs text-[#9E9E9E]">{b.count}</span>
              </Link>
            ))}
            {brands.length > 10 && (
              <button
                onClick={() => setShowAllBrands(!showAllBrands)}
                className="w-full text-center text-sm text-[#FFB800] hover:text-[#FFC400] font-medium py-2.5 transition duration-200"
                style={{ minHeight: '44px' }}
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
      {/* Mobile: Two buttons - Categories & Filter */}
      <div className="md:hidden flex gap-2">
        <button
          onClick={() => { setDrawerTab("categories"); setDrawerOpen(true); }}
          className="flex-1 flex items-center justify-center gap-2 bg-white border border-[#EFEFEF] rounded-xl px-3 py-3 text-sm font-semibold text-[#0A0A0A] active:bg-[#FAFAFA]"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.03), 0 6px 20px rgba(0,0,0,0.05)', minHeight: '48px' }}
        >
          <svg className="w-5 h-5 text-[#9E9E9E]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
          <span>Категорії</span>
          {activeCategory && <span className="w-2 h-2 rounded-full bg-[#FFD600] flex-shrink-0" />}
        </button>
        <button
          onClick={() => { setDrawerTab("filter"); setDrawerOpen(true); }}
          className="flex-1 flex items-center justify-center gap-2 bg-white border border-[#EFEFEF] rounded-xl px-3 py-3 text-sm font-semibold text-[#0A0A0A] active:bg-[#FAFAFA]"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.03), 0 6px 20px rgba(0,0,0,0.05)', minHeight: '48px' }}
        >
          <svg className="w-5 h-5 text-[#9E9E9E]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <span>Фільтр</span>
          {(activeSort || activeBrand) && <span className="w-2 h-2 rounded-full bg-[#FFD600] flex-shrink-0" />}
        </button>
      </div>

      {/* Mobile: Slide-in drawer from left */}
      <div
        ref={overlayRef}
        className={`drawer-overlay md:hidden ${drawerOpen ? "open" : ""}`}
        style={isDragging && drawerOpen ? {
          opacity: Math.max(0, 1 + dragX / (drawerRef.current?.offsetWidth || 320)),
          transition: "none",
        } : undefined}
        onClick={() => setDrawerOpen(false)}
      />
      <div
        ref={drawerRef}
        className={`drawer-panel md:hidden ${drawerOpen ? "open" : ""}`}
        style={isDragging && drawerOpen ? {
          transform: `translateX(${dragX}px)`,
          transition: "none",
        } : dragX < -10 ? {
          transform: `translateX(${dragX}px)`,
          transition: "transform 0.2s ease-out",
        } : undefined}
        onTouchStart={onDrawerTouchStart}
        onTouchMove={onDrawerTouchMove}
        onTouchEnd={onDrawerTouchEnd}
      >
        {/* Drag handle indicator */}
        <div className="flex justify-center pt-2 pb-0">
          <div className="w-8 h-1 rounded-full bg-[#DADADA]" />
        </div>
        <div className="sticky top-0 z-10 bg-white border-b border-[#EFEFEF]">
          <div className="px-4 py-3 flex items-center justify-between" style={{ minHeight: '56px' }}>
            <h2 className="font-bold text-[#0A0A0A] text-base">
              {drawerTab === "categories" ? "Категорії" : "Фільтр"}
            </h2>
            <button
              onClick={() => setDrawerOpen(false)}
              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[#F7F7F7] active:bg-[#EFEFEF] transition"
            >
              <svg className="w-5 h-5 text-[#9E9E9E]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Tab switcher inside drawer */}
          <div className="flex px-3 pb-2 gap-1">
            <button
              onClick={() => setDrawerTab("categories")}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
                drawerTab === "categories"
                  ? "bg-[#0A0A0A] text-[#FFD600]"
                  : "bg-[#F7F7F7] text-[#9E9E9E]"
              }`}
            >
              Категорії
            </button>
            <button
              onClick={() => setDrawerTab("filter")}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
                drawerTab === "filter"
                  ? "bg-[#0A0A0A] text-[#FFD600]"
                  : "bg-[#F7F7F7] text-[#9E9E9E]"
              }`}
            >
              Фільтр
            </button>
          </div>
        </div>
        <div className="p-3 space-y-3 pb-24">
          {drawerTab === "categories" ? sidebarContent : filterContent}
        </div>
      </div>

      {/* Desktop content */}
      <div className="hidden md:block space-y-4">
        {sidebarContent}
        {/* Sort options on desktop */}
        <div className="bg-white rounded-xl overflow-hidden border border-[#EFEFEF] md:shadow-[0_1px_3px_rgba(0,0,0,0.03),0_6px_20px_rgba(0,0,0,0.05)]">
          <div className="px-4 py-3 border-b border-[#EFEFEF]">
            <h3 className="font-bold text-[#0A0A0A] text-sm uppercase tracking-wide">Сортування</h3>
          </div>
          <div className="p-2">
            {SORT_OPTIONS.map((opt) => (
              <Link
                key={opt.value}
                href={buildUrl({ category: activeCategory, sort: opt.value })}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition duration-200 ${
                  (activeSort || "") === opt.value
                    ? "bg-[#FFD600] text-[#0A0A0A] font-semibold"
                    : "hover:bg-[#F7F7F7] text-[#1A1A1A] active:bg-[#EFEFEF]"
                }`}
                style={{ minHeight: '40px' }}
              >
                <span className="text-base flex-shrink-0">{opt.icon}</span>
                <span>{opt.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
