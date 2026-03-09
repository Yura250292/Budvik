"use client";

import { useState, useEffect } from "react";
import ProductCard from "@/components/ProductCard";

type ViewMode = "grid" | "list" | "gallery";

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  wholesalePrice?: number | null;
  isPromo?: boolean;
  promoPrice?: number | null;
  promoLabel?: string | null;
  stock: number;
  image?: string | null;
  category?: { name: string } | null;
}

export default function CatalogGrid({ products }: { products: Product[] }) {
  const [view, setView] = useState<ViewMode>("grid");

  useEffect(() => {
    const saved = localStorage.getItem("catalog-view") as ViewMode | null;
    if (saved && ["grid", "list", "gallery"].includes(saved)) {
      setView(saved);
    }
  }, []);

  const changeView = (v: ViewMode) => {
    setView(v);
    localStorage.setItem("catalog-view", v);
  };

  const gridClass =
    view === "grid"
      ? "grid grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-6"
      : view === "gallery"
        ? "grid grid-cols-1 gap-3 md:gap-4"
        : "flex flex-col gap-2 md:gap-3";

  return (
    <>
      {/* View mode switcher */}
      <div className="flex items-center justify-end gap-1 mb-3">
        <span className="text-xs text-[#9E9E9E] mr-1 hidden sm:inline">Вигляд:</span>
        {/* Grid / Tile */}
        <button
          onClick={() => changeView("grid")}
          className={`p-1.5 rounded-lg transition ${view === "grid" ? "bg-[#0A0A0A] text-[#FFD600]" : "bg-[#F0F0F0] text-[#9E9E9E] hover:text-[#555]"}`}
          title="Плитка"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <rect x="0" y="0" width="4.5" height="4.5" rx="1" />
            <rect x="5.75" y="0" width="4.5" height="4.5" rx="1" />
            <rect x="11.5" y="0" width="4.5" height="4.5" rx="1" />
            <rect x="0" y="5.75" width="4.5" height="4.5" rx="1" />
            <rect x="5.75" y="5.75" width="4.5" height="4.5" rx="1" />
            <rect x="11.5" y="5.75" width="4.5" height="4.5" rx="1" />
            <rect x="0" y="11.5" width="4.5" height="4.5" rx="1" />
            <rect x="5.75" y="11.5" width="4.5" height="4.5" rx="1" />
            <rect x="11.5" y="11.5" width="4.5" height="4.5" rx="1" />
          </svg>
        </button>
        {/* List */}
        <button
          onClick={() => changeView("list")}
          className={`p-1.5 rounded-lg transition ${view === "list" ? "bg-[#0A0A0A] text-[#FFD600]" : "bg-[#F0F0F0] text-[#9E9E9E] hover:text-[#555]"}`}
          title="Список"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <rect x="0" y="0.5" width="16" height="3" rx="1" />
            <rect x="0" y="6.5" width="16" height="3" rx="1" />
            <rect x="0" y="12.5" width="16" height="3" rx="1" />
          </svg>
        </button>
        {/* Gallery */}
        <button
          onClick={() => changeView("gallery")}
          className={`p-1.5 rounded-lg transition ${view === "gallery" ? "bg-[#0A0A0A] text-[#FFD600]" : "bg-[#F0F0F0] text-[#9E9E9E] hover:text-[#555]"}`}
          title="Галерея"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <rect x="0" y="0" width="16" height="7" rx="1.5" />
            <rect x="0" y="9" width="16" height="7" rx="1.5" />
          </svg>
        </button>
      </div>

      {/* Products */}
      <div className={gridClass}>
        {products.map((product) => (
          <ProductCard
            key={product.id}
            {...product}
            category={product.category ?? undefined}
            viewMode={view}
          />
        ))}
      </div>
    </>
  );
}
