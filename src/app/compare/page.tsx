"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { getCompareList, removeFromCompare, clearCompare } from "@/lib/compare";
import { addToCart } from "@/lib/cart";
import { formatPrice } from "@/lib/utils";

interface FullProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  image: string | null;
  stock: number;
  powerWatts: number | null;
  rpm: number | null;
  discDiameterMm: number | null;
  chuckMm: number | null;
  weightKg: number | null;
  category: { name: string };
}

const SPEC_ROWS: { key: keyof FullProduct; label: string; format?: (v: any) => string }[] = [
  { key: "powerWatts", label: "Потужність", format: (v) => `${v} Вт` },
  { key: "rpm", label: "Обороти", format: (v) => `${v} об/хв` },
  { key: "discDiameterMm", label: "Діаметр диска", format: (v) => `${v} мм` },
  { key: "chuckMm", label: "Патрон", format: (v) => `${v} мм` },
  { key: "weightKg", label: "Вага", format: (v) => `${v} кг` },
];

export default function ComparePage() {
  const [products, setProducts] = useState<FullProduct[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProducts = async () => {
    const items = getCompareList();
    if (items.length === 0) {
      setProducts([]);
      setLoading(false);
      return;
    }
    try {
      const ids = items.map((i) => i.productId).join(",");
      const res = await fetch(`/api/products/compare?ids=${ids}`);
      const data = await res.json();
      setProducts(data);
    } catch {
      setProducts([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchProducts();
    const onUpdate = () => fetchProducts();
    window.addEventListener("compare-updated", onUpdate);
    return () => window.removeEventListener("compare-updated", onUpdate);
  }, []);

  const handleRemove = (id: string) => {
    removeFromCompare(id);
  };

  // Find spec rows where at least one product has data
  const visibleSpecs = SPEC_ROWS.filter((spec) =>
    products.some((p) => p[spec.key] != null)
  );

  // Check if descriptions are meaningful (not empty)
  const hasDescriptions = products.some((p) => p.description && p.description.length > 10);

  // Find the best (lowest) price to highlight
  const minPrice = Math.min(...products.map((p) => p.price));

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <div className="animate-pulse text-[#9E9E9E]">Завантаження...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 md:py-10 mb-20 md:mb-0">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-[#0A0A0A] flex items-center gap-2">
          <svg className="w-7 h-7 text-[#FFD600]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
          Порівняння
        </h1>
        {products.length > 0 && (
          <button onClick={clearCompare} className="text-sm text-[#9E9E9E] hover:text-red-500 transition">
            Очистити все
          </button>
        )}
      </div>

      {products.length === 0 ? (
        <div className="text-center py-20">
          <svg className="w-16 h-16 text-[#DADADA] mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
          <p className="text-[#9E9E9E] text-lg mb-4">Додайте товари для порівняння</p>
          <Link href="/catalog" className="inline-block bg-[#FFD600] text-[#0A0A0A] px-6 py-3 rounded-xl font-semibold hover:bg-[#FFC400] transition">
            Перейти до каталогу
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr>
                <th className="text-left text-sm font-medium text-[#9E9E9E] pb-4 w-32"></th>
                {products.map((p) => (
                  <th key={p.id} className="text-center pb-4 px-3">
                    <div className="bg-white border border-[#EFEFEF] rounded-xl p-4 relative" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                      <button
                        onClick={() => handleRemove(p.id)}
                        className="absolute top-2 right-2 text-[#9E9E9E] hover:text-red-500 transition"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                      <Link href={`/catalog/${p.slug}`} className="block">
                        <div className="relative w-24 h-24 mx-auto bg-[#FAFAFA] rounded-lg flex items-center justify-center mb-3 overflow-hidden">
                          {p.image ? (
                            <Image src={p.image} alt={p.name} fill className="object-contain p-1" sizes="96px" />
                          ) : (
                            <svg className="w-12 h-12 text-[#DADADA]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                          )}
                        </div>
                        <h3 className="text-sm font-semibold text-[#0A0A0A] line-clamp-2 hover:text-[#FFB800] transition">{p.name}</h3>
                      </Link>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Price */}
              <tr className="border-t border-[#EFEFEF]">
                <td className="py-4 text-sm font-medium text-[#9E9E9E]">Ціна</td>
                {products.map((p) => (
                  <td key={p.id} className="py-4 text-center">
                    <span className={`text-lg font-bold ${products.length > 1 && p.price === minPrice ? "text-green-600" : "text-[#0A0A0A]"}`}>
                      {formatPrice(p.price)}
                    </span>
                    {products.length > 1 && p.price === minPrice && (
                      <span className="block text-xs text-green-600 mt-0.5">Найкраща ціна</span>
                    )}
                  </td>
                ))}
              </tr>

              {/* Stock */}
              <tr className="border-t border-[#EFEFEF]">
                <td className="py-4 text-sm font-medium text-[#9E9E9E]">Наявність</td>
                {products.map((p) => (
                  <td key={p.id} className="py-4 text-center text-sm">
                    {p.stock > 0 ? (
                      <span className="text-green-600 font-medium">В наявності ({p.stock})</span>
                    ) : (
                      <span className="text-red-400">Немає в наявності</span>
                    )}
                  </td>
                ))}
              </tr>

              {/* Category — hide "Імпорт з 1С" */}
              <tr className="border-t border-[#EFEFEF]">
                <td className="py-4 text-sm font-medium text-[#9E9E9E]">Категорія</td>
                {products.map((p) => (
                  <td key={p.id} className="py-4 text-center text-sm text-[#555]">
                    {p.category?.name && !p.category.name.includes("Імпорт") ? p.category.name : "—"}
                  </td>
                ))}
              </tr>

              {/* Dynamic spec rows */}
              {visibleSpecs.map((spec) => (
                <tr key={spec.key} className="border-t border-[#EFEFEF]">
                  <td className="py-4 text-sm font-medium text-[#9E9E9E]">{spec.label}</td>
                  {products.map((p) => {
                    const val = p[spec.key];
                    // Find best value for highlighting
                    const allVals = products.map((pr) => pr[spec.key]).filter((v) => v != null) as number[];
                    const maxVal = Math.max(...allVals);
                    const isBest = val != null && val === maxVal && products.length > 1 && allVals.length > 1;
                    return (
                      <td key={p.id} className="py-4 text-center text-sm">
                        {val != null ? (
                          <span className={isBest ? "font-semibold text-[#0A0A0A]" : "text-[#555]"}>
                            {spec.format ? spec.format(val) : String(val)}
                            {isBest && spec.key !== "weightKg" && <span className="text-green-600 text-xs ml-1">+</span>}
                          </span>
                        ) : (
                          <span className="text-[#DADADA]">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Description - only first 200 chars */}
              {hasDescriptions && (
                <tr className="border-t border-[#EFEFEF]">
                  <td className="py-4 text-sm font-medium text-[#9E9E9E]">Опис</td>
                  {products.map((p) => {
                    const clean = p.description?.replace(/<[^>]*>/g, "").trim();
                    return (
                      <td key={p.id} className="py-4 text-center text-xs text-[#555] px-3">
                        <p className="line-clamp-4">{clean && clean.length > 10 ? clean.slice(0, 200) + "..." : "—"}</p>
                      </td>
                    );
                  })}
                </tr>
              )}

              {/* Add to cart */}
              <tr className="border-t border-[#EFEFEF]">
                <td className="py-4 text-sm font-medium text-[#9E9E9E]"></td>
                {products.map((p) => (
                  <td key={p.id} className="py-4 text-center">
                    {p.stock > 0 ? (
                      <button
                        onClick={() => addToCart({ productId: p.id, name: p.name, price: p.price, slug: p.slug, image: p.image })}
                        className="bg-[#FFD600] text-[#0A0A0A] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#FFC400] transition"
                      >
                        У кошик
                      </button>
                    ) : (
                      <span className="text-sm text-[#9E9E9E]">Недоступно</span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
