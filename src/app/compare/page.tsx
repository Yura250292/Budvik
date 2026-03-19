"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { getCompareList, removeFromCompare, clearCompare, CompareItem } from "@/lib/compare";
import { addToCart } from "@/lib/cart";
import { formatPrice } from "@/lib/utils";

export default function ComparePage() {
  const [items, setItems] = useState<CompareItem[]>([]);

  useEffect(() => {
    const update = () => setItems(getCompareList());
    update();
    window.addEventListener("compare-updated", update);
    return () => window.removeEventListener("compare-updated", update);
  }, []);

  const handleAddToCart = (item: CompareItem) => {
    addToCart({ productId: item.productId, name: item.name, price: item.price, slug: item.slug, image: item.image });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 md:py-10 mb-20 md:mb-0">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-[#0A0A0A] flex items-center gap-2">
          <svg className="w-7 h-7 text-[#FFD600]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
          Порівняння
        </h1>
        {items.length > 0 && (
          <button onClick={clearCompare} className="text-sm text-[#9E9E9E] hover:text-red-500 transition">
            Очистити все
          </button>
        )}
      </div>

      {items.length === 0 ? (
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
                {items.map((item) => (
                  <th key={item.productId} className="text-center pb-4 px-3">
                    <div className="bg-white border border-[#EFEFEF] rounded-xl p-4 relative" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                      <button
                        onClick={() => removeFromCompare(item.productId)}
                        className="absolute top-2 right-2 text-[#9E9E9E] hover:text-red-500 transition"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                      <Link href={`/catalog/${item.slug}`} className="block">
                        <div className="relative w-24 h-24 mx-auto bg-[#FAFAFA] rounded-lg flex items-center justify-center mb-3 overflow-hidden">
                          {item.image ? (
                            <Image src={item.image} alt={item.name} fill className="object-contain p-1" sizes="96px" />
                          ) : (
                            <svg className="w-12 h-12 text-[#DADADA]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                          )}
                        </div>
                        <h3 className="text-sm font-semibold text-[#0A0A0A] line-clamp-2 hover:text-[#FFB800] transition">{item.name}</h3>
                      </Link>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[#EFEFEF]">
                <td className="py-4 text-sm font-medium text-[#9E9E9E]">Ціна</td>
                {items.map((item) => (
                  <td key={item.productId} className="py-4 text-center">
                    <span className="text-lg font-bold text-[#0A0A0A]">{formatPrice(item.price)}</span>
                  </td>
                ))}
              </tr>
              <tr className="border-t border-[#EFEFEF]">
                <td className="py-4 text-sm font-medium text-[#9E9E9E]">Категорія</td>
                {items.map((item) => (
                  <td key={item.productId} className="py-4 text-center text-sm text-[#555]">
                    {item.category || "—"}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-[#EFEFEF]">
                <td className="py-4 text-sm font-medium text-[#9E9E9E]">Опис</td>
                {items.map((item) => (
                  <td key={item.productId} className="py-4 text-center text-xs text-[#555] px-3">
                    <p className="line-clamp-4">{item.description || "—"}</p>
                  </td>
                ))}
              </tr>
              <tr className="border-t border-[#EFEFEF]">
                <td className="py-4 text-sm font-medium text-[#9E9E9E]"></td>
                {items.map((item) => (
                  <td key={item.productId} className="py-4 text-center">
                    <button
                      onClick={() => handleAddToCart(item)}
                      className="bg-[#FFD600] text-[#0A0A0A] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#FFC400] transition"
                    >
                      У кошик
                    </button>
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
