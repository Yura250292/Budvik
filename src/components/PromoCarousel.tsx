"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
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
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white shadow-lg rounded-xl w-10 h-10 flex items-center justify-center hover:bg-[#FAFAFA] transition duration-200 -ml-3 border border-[#EFEFEF]"
          >
            <svg className="w-5 h-5 text-[#1A1A1A]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => scroll("right")}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white shadow-lg rounded-xl w-10 h-10 flex items-center justify-center hover:bg-[#FAFAFA] transition duration-200 -mr-3 border border-[#EFEFEF]"
          >
            <svg className="w-5 h-5 text-[#1A1A1A]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
              className="group flex-shrink-0 w-[200px] sm:w-[280px] bg-white border border-[#EFEFEF] rounded-xl overflow-hidden hover:-translate-y-1 active:scale-[0.98] transition-[box-shadow,border-color,transform] duration-150"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.06)' }}
            >
              <div className="relative h-36 sm:h-48 bg-[#FAFAFA] flex items-center justify-center overflow-hidden">
                {product.image ? (
                  <Image
                    src={product.image}
                    alt={product.name}
                    fill
                    className="object-contain p-3"
                    sizes="(max-width: 640px) 200px, 280px"
                  />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 text-[#DADADA]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                )}

                {/* Promo badge */}
                <div className="absolute top-3 left-3 flex flex-col gap-1">
                  {product.promoLabel && (
                    <span className="bg-[#0A0A0A] text-[#FFD600] text-xs font-bold px-2.5 py-1 rounded-lg">
                      {product.promoLabel}
                    </span>
                  )}
                  {discount > 0 && !product.promoLabel && (
                    <span className="bg-[#0A0A0A] text-[#FFD600] text-xs font-bold px-2.5 py-1 rounded-lg">
                      -{discount}%
                    </span>
                  )}
                </div>
              </div>

              <div className="p-3 sm:p-4">
                <span className="inline-block text-[10px] sm:text-xs text-[#9E9E9E] bg-[#F0F0F0] px-1.5 sm:px-2 py-0.5 rounded-md mb-1.5 sm:mb-2 font-medium truncate max-w-full">{product.category.name}</span>
                <h3 className="font-semibold text-[#0A0A0A] group-hover:text-[#FFB800] transition duration-200 mb-2 line-clamp-2 text-[13px] sm:text-sm leading-snug">
                  {product.name}
                </h3>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2">
                  <div className="min-w-0">
                    <span className="text-base sm:text-xl font-bold text-[#0A0A0A]">{formatPrice(finalPrice)}</span>
                    {product.promoPrice && product.promoPrice < product.price && (
                      <span className="text-[10px] sm:text-sm text-[#9E9E9E] line-through ml-1">{formatPrice(product.price)}</span>
                    )}
                  </div>
                  {product.stock > 0 && (
                    <button
                      onClick={(e) => handleAddToCart(e, product)}
                      className="bg-[#FFD600] text-[#0A0A0A] px-3 sm:px-4 py-2 rounded-[10px] text-xs sm:text-sm font-semibold hover:bg-[#FFC400] active:bg-[#FFB800] active:scale-[0.97] transition-[background-color,transform] duration-150 w-full sm:w-auto"
                      style={{ minHeight: '40px' }}
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
