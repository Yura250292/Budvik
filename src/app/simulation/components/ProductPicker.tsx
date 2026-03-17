"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import type { SimulationType } from "@/lib/simulation/specs";

interface Product {
  id: string;
  name: string;
  image?: string | null;
  price?: number;
  category?: { name: string } | null;
}

interface Props {
  simType: SimulationType;
  selected: Product[];
  onSelect: (products: Product[]) => void;
}

export default function ProductPicker({ simType, selected, onSelect }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ type: simType });
    if (search) params.set("search", search);

    fetch(`/api/simulate/products?${params}`)
      .then((r) => r.json())
      .then((data) => setProducts(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [simType, search]);

  const toggleProduct = (product: Product) => {
    const exists = selected.find((p) => p.id === product.id);
    if (exists) {
      onSelect(selected.filter((p) => p.id !== product.id));
    } else if (selected.length < 4) {
      onSelect([...selected, product]);
    }
  };

  const isSelected = (id: string) => selected.some((p) => p.id === id);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[#9E9E9E]">
          Обрано: {selected.length}/4 інструментів
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#9E9E9E]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Пошук інструменту..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#EFEFEF] bg-white text-sm focus:border-[#FFD600] focus:outline-none transition"
        />
      </div>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {selected.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 bg-[#FFFDE7] border border-[#FFD600] text-[#0A0A0A] text-xs font-medium px-3 py-1.5 rounded-lg"
            >
              {p.name.substring(0, 30)}
              {p.name.length > 30 && "..."}
              <button onClick={() => toggleProduct(p)} className="text-[#9E9E9E] hover:text-red-500">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Product grid */}
      {loading ? (
        <div className="text-center py-12 text-[#9E9E9E]">Завантаження...</div>
      ) : products.length === 0 ? (
        <div className="text-center py-12 text-[#9E9E9E]">Інструменти не знайдено</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {products.map((product) => (
            <button
              key={product.id}
              onClick={() => toggleProduct(product)}
              disabled={!isSelected(product.id) && selected.length >= 4}
              className={`p-3 rounded-xl border-2 text-left cursor-pointer active:scale-[0.98] transition-[box-shadow,border-color,background-color,transform] duration-150 ${
                isSelected(product.id)
                  ? "border-[#FFD600] bg-[#FFFDE7] shadow-sm"
                  : "border-[#EFEFEF] bg-white hover:border-[#FFD600]/40 disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              <div className="relative w-full aspect-square bg-[#FAFAFA] rounded-lg mb-2 overflow-hidden">
                {product.image ? (
                  <Image src={product.image} alt={product.name} fill className="object-contain p-1" sizes="150px" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-10 h-10 text-[#DADADA]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                  </div>
                )}
              </div>
              <h4 className="text-xs font-semibold text-[#0A0A0A] line-clamp-2 leading-tight">{product.name}</h4>
              {product.category && (
                <p className="text-[10px] text-[#9E9E9E] mt-1">{product.category.name}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
