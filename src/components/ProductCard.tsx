"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { addToCart } from "@/lib/cart";

interface ProductCardProps {
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
  category?: { name: string };
}

export default function ProductCard({ id, name, slug, description, price, wholesalePrice, isPromo, promoPrice, promoLabel, stock, image, category }: ProductCardProps) {
  const basePrice = wholesalePrice ?? price;
  const displayPrice = isPromo && promoPrice ? promoPrice : basePrice;
  const hasDiscount = displayPrice < price;

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    addToCart({ productId: id, name, price: displayPrice, slug });
  };

  return (
    <Link href={`/catalog/${slug}`} className="group block">
      <div className={`rounded-xl overflow-hidden transition-all duration-200 ease-out border ${
        stock > 0
          ? "border-[#EFEFEF] bg-white hover:shadow-[0_10px_30px_rgba(0,0,0,0.12)] hover:-translate-y-1"
          : "border-[#EFEFEF] bg-[#FAFAFA] opacity-60"
      }`}
        style={{ boxShadow: stock > 0 ? '0 1px 3px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.06)' : 'none' }}
      >
        {/* Image */}
        <div className={`h-36 sm:h-48 flex items-center justify-center relative ${stock > 0 ? "bg-[#FAFAFA]" : "bg-[#EFEFEF]"}`}>
          {image ? (
            <img
              src={image}
              alt={name}
              className="h-full w-full object-contain p-2"
              loading="lazy"
            />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-14 sm:h-20 w-14 sm:w-20 transition duration-200 ${
              stock > 0 ? "text-[#DADADA] group-hover:text-[#FFD600]" : "text-[#DADADA]"
            }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          )}
          {isPromo && stock > 0 && (
            <span className="absolute top-2 left-2 bg-[#0A0A0A] text-[#FFD600] text-[10px] sm:text-xs font-bold px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg">
              {promoLabel || "Акція"}
            </span>
          )}
        </div>

        <div className="p-3 sm:p-4">
          {/* Category badge */}
          {category && !/^\d+$/.test(category.name) && (
            <span className="inline-block text-[10px] sm:text-xs text-[#9E9E9E] bg-[#F0F0F0] px-1.5 sm:px-2 py-0.5 rounded-md mb-1.5 sm:mb-2 font-medium truncate max-w-full">
              {category.name}
            </span>
          )}

          <h3 className={`text-[13px] sm:text-[15px] font-semibold mb-1 sm:mb-1.5 line-clamp-2 transition duration-200 leading-snug ${
            stock > 0 ? "text-[#0A0A0A] group-hover:text-[#FFB800]" : "text-[#9E9E9E]"
          }`}>
            {name}
          </h3>

          {/* Description - hidden on mobile for space */}
          <p className="hidden sm:block text-sm text-[#555] mb-3 line-clamp-2 leading-relaxed">{description.replace(/<[^>]*>/g, '')}</p>

          {/* Price + button */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="min-w-0">
              <span className={`text-base sm:text-xl font-bold ${
                stock === 0 ? "text-[#9E9E9E]" : "text-[#0A0A0A]"
              }`}>
                {formatPrice(displayPrice)}
              </span>
              {hasDiscount && (
                <span className="text-[10px] sm:text-xs text-[#9E9E9E] line-through ml-1">{formatPrice(price)}</span>
              )}
              {wholesalePrice != null && wholesalePrice < price && !isPromo && (
                <span className="block text-[10px] sm:text-xs text-[#FFB800] font-medium">Оптова ціна</span>
              )}
            </div>
            {stock > 0 ? (
              <button
                onClick={handleAddToCart}
                className="bg-[#FFD600] text-[#0A0A0A] px-3 sm:px-4 py-2 rounded-[10px] text-xs sm:text-sm font-semibold hover:bg-[#FFC400] active:bg-[#FFB800] transition-all duration-200 flex-shrink-0 w-full sm:w-auto"
                style={{ minHeight: '40px' }}
              >
                У кошик
              </button>
            ) : (
              <span className="text-xs sm:text-sm text-[#9E9E9E] font-medium">Немає в наявності</span>
            )}
          </div>
          {stock > 0 && stock <= 5 && (
            <p className="text-[10px] sm:text-xs text-[#FFB800] mt-1.5 font-medium">Залишилось {stock} шт.</p>
          )}
        </div>
      </div>
    </Link>
  );
}
