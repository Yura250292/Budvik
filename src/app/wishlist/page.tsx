"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getWishlist, removeFromWishlist, WishlistItem } from "@/lib/wishlist";
import { addToCart } from "@/lib/cart";
import { formatPrice } from "@/lib/utils";

export default function WishlistPage() {
  const [items, setItems] = useState<WishlistItem[]>([]);

  useEffect(() => {
    const update = () => setItems(getWishlist());
    update();
    window.addEventListener("wishlist-updated", update);
    return () => window.removeEventListener("wishlist-updated", update);
  }, []);

  const handleAddToCart = (item: WishlistItem) => {
    addToCart({ productId: item.productId, name: item.name, price: item.price, slug: item.slug });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 md:py-10 mb-20 md:mb-0">
      <h1 className="text-2xl md:text-3xl font-bold text-[#0A0A0A] mb-6">
        <span className="flex items-center gap-2">
          <svg className="w-7 h-7 text-red-500" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
          Обране
        </span>
      </h1>

      {items.length === 0 ? (
        <div className="text-center py-20">
          <svg className="w-16 h-16 text-[#DADADA] mx-auto mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
          <p className="text-[#9E9E9E] text-lg mb-4">Список обраного порожній</p>
          <Link href="/catalog" className="inline-block bg-[#FFD600] text-[#0A0A0A] px-6 py-3 rounded-xl font-semibold hover:bg-[#FFC400] transition">
            Перейти до каталогу
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <div key={item.productId} className="flex items-center gap-4 bg-white border border-[#EFEFEF] rounded-xl p-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <Link href={`/catalog/${item.slug}`} className="flex-shrink-0 w-20 h-20 bg-[#FAFAFA] rounded-lg flex items-center justify-center overflow-hidden">
                {item.image ? (
                  <img src={item.image} alt={item.name} className="w-full h-full object-contain p-1" />
                ) : (
                  <svg className="w-10 h-10 text-[#DADADA]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                )}
              </Link>

              <div className="flex-1 min-w-0">
                <Link href={`/catalog/${item.slug}`} className="text-sm sm:text-base font-semibold text-[#0A0A0A] hover:text-[#FFB800] transition line-clamp-2">
                  {item.name}
                </Link>
                <p className="text-lg font-bold text-[#0A0A0A] mt-1">{formatPrice(item.price)}</p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleAddToCart(item)}
                  className="bg-[#FFD600] text-[#0A0A0A] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#FFC400] transition hidden sm:block"
                >
                  У кошик
                </button>
                <button
                  onClick={() => handleAddToCart(item)}
                  className="sm:hidden bg-[#FFD600] text-[#0A0A0A] p-2 rounded-lg hover:bg-[#FFC400] transition"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                  </svg>
                </button>
                <button
                  onClick={() => removeFromWishlist(item.productId)}
                  className="text-[#9E9E9E] hover:text-red-500 transition p-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
