"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { productToConsumable, type ConsumableMode, type Consumable } from "@/lib/simulation/consumables";

interface ProductItem {
  id: string;
  name: string;
  price?: number | null;
  image?: string | null;
  category?: { slug?: string; name?: string } | null;
}

interface Props {
  mode: ConsumableMode;
  selected: Consumable[];
  onSelect: (items: Consumable[]) => void;
  materialId?: string | null;
}

export default function ConsumablePicker({ mode, selected, onSelect, materialId }: Props) {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ mode });
    if (search) params.set("search", search);

    fetch(`/api/simulate/consumables/products?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setProducts(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [mode, search]);

  const toConsumable = (product: ProductItem): Consumable => {
    return productToConsumable(product, mode);
  };

  const toggleItem = (product: ProductItem) => {
    const exists = selected.find(s => s.id === product.id);
    if (exists) {
      onSelect(selected.filter(s => s.id !== product.id));
    } else if (selected.length < 4) {
      onSelect([...selected, toConsumable(product)]);
    }
  };

  const isSelected = (id: string) => selected.some(s => s.id === id);

  const getCompat = (product: ProductItem): "optimal" | "ok" | "incompatible" | null => {
    if (!materialId) return null;
    const consumable = toConsumable(product);
    const val = consumable.materialCompat[materialId];
    if (val === 2) return "optimal";
    if (val === 1) return "ok";
    if (val === 0) return "incompatible";
    return "ok";
  };

  const compatBadge = (compat: "optimal" | "ok" | "incompatible" | null) => {
    if (!compat) return null;
    const styles = {
      optimal: "bg-green-100 text-green-700 border-green-300",
      ok: "bg-yellow-50 text-yellow-700 border-yellow-300",
      incompatible: "bg-red-50 text-red-600 border-red-300",
    };
    const labels = { optimal: "Оптимально", ok: "Підходить", incompatible: "Не сумісний" };
    return (
      <span className={`text-[9px] px-1.5 py-0.5 rounded border ${styles[compat]}`}>
        {labels[compat]}
      </span>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[#9E9E9E]">Обрано: {selected.length}/4</p>
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
          placeholder="Пошук витратного матеріалу..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#EFEFEF] bg-white text-sm focus:border-[#FFD600] focus:outline-none transition"
        />
      </div>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {selected.map(item => (
            <span key={item.id} className="inline-flex items-center gap-1.5 bg-[#FFFDE7] border border-[#FFD600] text-[#0A0A0A] text-xs font-medium px-3 py-1.5 rounded-lg">
              {item.nameUk.substring(0, 35)}
              {item.nameUk.length > 35 && "..."}
              <button onClick={() => onSelect(selected.filter(s => s.id !== item.id))} className="text-[#9E9E9E] hover:text-red-500">
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
        <div className="text-center py-12 text-[#9E9E9E]">Витратні матеріали не знайдено</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {products.map(product => {
            const compat = getCompat(product);
            const disabled = compat === "incompatible";
            const consumable = toConsumable(product);
            return (
              <button
                key={product.id}
                onClick={() => !disabled && toggleItem(product)}
                disabled={disabled || (!isSelected(product.id) && selected.length >= 4)}
                className={`p-3 rounded-xl border-2 text-left cursor-pointer active:scale-[0.98] transition-[box-shadow,border-color,background-color,transform] duration-150 ${
                  isSelected(product.id)
                    ? "border-[#FFD600] bg-[#FFFDE7] shadow-sm"
                    : disabled
                    ? "border-[#EFEFEF] bg-[#FAFAFA] opacity-50 cursor-not-allowed"
                    : "border-[#EFEFEF] bg-white hover:border-[#FFD600]/40 disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
              >
                <div className="flex gap-3">
                  {/* Product image */}
                  <div className="w-14 h-14 bg-[#FAFAFA] rounded-lg overflow-hidden flex-shrink-0">
                    {product.image ? (
                      <Image src={product.image} alt={product.name} width={56} height={56} className="w-full h-full object-contain p-1" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-[#DADADA]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="text-xs font-bold text-[#0A0A0A] line-clamp-2 leading-tight">{product.name}</h4>
                      {compatBadge(compat)}
                    </div>
                    <p className="text-[10px] text-[#777] mb-1.5 line-clamp-1">{consumable.description}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2.5 text-[10px] text-[#9E9E9E]">
                        <span>Швидк. ×{consumable.speedFactor.toFixed(1)}</span>
                        <span>Ресурс ×{consumable.durabilityFactor.toFixed(1)}</span>
                        <span>Точн. ×{consumable.precisionFactor.toFixed(1)}</span>
                      </div>
                      {product.price && (
                        <span className="text-[11px] font-semibold text-[#FFB800]">{Math.round(product.price)} грн</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
