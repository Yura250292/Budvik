"use client";

import { useRef } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { addToCart } from "@/lib/cart";

interface PromoProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  promoPrice: number | null;
  promoLabel: string | null;
  image: string | null;
  stock: number;
  category: { name: string };
}

export default function PromoCarousel({ products }: { products: PromoProduct[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (products.length === 0) return null;

  const scroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = 320;
    scrollRef.current.scrollBy({
      left: dir === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  const handleAddToCart = (e: React.MouseEvent, product: PromoProduct) => {
    e.preventDefault();
    e.stopPropagation();
    const finalPrice = product.promoPrice ?? product.price;
    addToCart({ productId: product.id, name: product.name, price: finalPrice, slug: product.slug });
  };

  return (
    <div className="relative">
      {/* Scroll buttons */}
      {products.length > 4 && (
        <>
          <button
            onClick={() => scroll("left")}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 shadow-lg rounded-full w-10 h-10 flex items-center justify-center hover:bg-white transition -ml-3"
          >
            <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => scroll("right")}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 shadow-lg rounded-full w-10 h-10 flex items-center justify-center hover:bg-white transition -mr-3"
          >
            <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}

      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth pb-2"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {products.map((product) => {
          const finalPrice = product.promoPrice ?? product.price;
          const discount = product.promoPrice
            ? Math.round((1 - product.promoPrice / product.price) * 100)
            : 0;

          return (
            <Link
              key={product.id}
              href={`/catalog/${product.slug}`}
              className="group flex-shrink-0 w-[280px] bg-white border rounded-xl overflow-hidden hover:shadow-xl transition-all duration-300"
            >
              <div className="relative h-48 bg-gray-50 flex items-center justify-center">
                {product.image ? (
                  <img
                    src={product.image}
                    alt={product.name}
                    className="h-full w-full object-contain p-3"
                    loading="lazy"
                  />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                )}

                {/* Promo badge */}
                <div className="absolute top-2 left-2 flex flex-col gap-1">
                  {product.promoLabel && (
                    <span className="bg-black text-yellow-400 text-xs font-bold px-2.5 py-1 rounded-lg shadow-lg">
                      {product.promoLabel}
                    </span>
                  )}
                  {discount > 0 && !product.promoLabel && (
                    <span className="bg-black text-yellow-400 text-xs font-bold px-2.5 py-1 rounded-lg shadow-lg">
                      -{discount}%
                    </span>
                  )}
                </div>
              </div>

              <div className="p-4">
                <span className="text-xs text-gray-500 mb-1 block">{product.category.name}</span>
                <h3 className="font-semibold text-gray-900 group-hover:text-yellow-600 transition mb-2 line-clamp-2 text-sm">
                  {product.name}
                </h3>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-lg font-bold text-gray-900">{formatPrice(finalPrice)}</span>
                    {product.promoPrice && product.promoPrice < product.price && (
                      <span className="text-sm text-gray-400 line-through ml-1.5">{formatPrice(product.price)}</span>
                    )}
                  </div>
                  {product.stock > 0 && (
                    <button
                      onClick={(e) => handleAddToCart(e, product)}
                      className="bg-yellow-400 text-black px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-yellow-300 transition shadow-sm"
                    >
                      У кошик
                    </button>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
