"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import { formatPrice } from "@/lib/utils";
import { addToCart } from "@/lib/cart";
import { toggleWishlist, isInWishlist } from "@/lib/wishlist";
import { toggleCompare, isInCompare } from "@/lib/compare";
import { useSession } from "next-auth/react";

type ViewMode = "grid" | "list" | "gallery";

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
  viewMode?: ViewMode;
}

export default function ProductCard({ id, name, slug, description, price, wholesalePrice, isPromo, promoPrice, promoLabel, stock, image, category, viewMode = "grid" }: ProductCardProps) {
  const { data: session } = useSession();
  const isWholesale = (session?.user as any)?.role === "WHOLESALE";
  const basePrice = wholesalePrice ?? price;
  const displayPrice = isPromo && promoPrice ? promoPrice : basePrice;
  const hasDiscount = displayPrice < price;

  const [inWishlist, setInWishlist] = useState(false);
  const [inCompare, setInCompare] = useState(false);
  const [compareFull, setCompareFull] = useState(false);

  useEffect(() => {
    setInWishlist(isInWishlist(id));
    setInCompare(isInCompare(id));
    const onW = () => setInWishlist(isInWishlist(id));
    const onC = () => setInCompare(isInCompare(id));
    window.addEventListener("wishlist-updated", onW);
    window.addEventListener("compare-updated", onC);
    return () => {
      window.removeEventListener("wishlist-updated", onW);
      window.removeEventListener("compare-updated", onC);
    };
  }, [id]);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    addToCart({ productId: id, name, price: displayPrice, slug });
  };

  const handleWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    toggleWishlist({ productId: id, name, slug, price: displayPrice, image });
  };

  const handleCompare = (e: React.MouseEvent) => {
    e.preventDefault();
    const result = toggleCompare({ productId: id, name, slug, price: displayPrice, image, category: category?.name, description: description.replace(/<[^>]*>/g, '').slice(0, 200) });
    if (result.full) {
      setCompareFull(true);
      setTimeout(() => setCompareFull(false), 2000);
    }
  };

  const plainDesc = description.replace(/<[^>]*>/g, '');

  // ── LIST VIEW ──
  if (viewMode === "list") {
    return (
      <Link href={`/catalog/${slug}`} className="group block">
        <div className={`flex rounded-xl overflow-hidden border transition-all duration-200 ${
          stock > 0
            ? "border-[#EFEFEF] bg-white hover:shadow-md"
            : "border-[#EFEFEF] bg-[#FAFAFA] opacity-60"
        }`}>
          {/* Thumbnail */}
          <div className={`w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0 flex items-center justify-center relative ${stock > 0 ? "bg-[#FAFAFA]" : "bg-[#EFEFEF]"}`}>
            {image ? (
              <Image src={image} alt={name} className="h-full w-full object-contain p-1.5" width={96} height={96} loading="lazy" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-[#DADADA]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            )}
            {isPromo && stock > 0 && (
              <span className="absolute top-1 left-1 bg-[#0A0A0A] text-[#FFD600] text-[7px] font-bold px-1 py-0.5 rounded">
                {promoLabel || "Акція"}
              </span>
            )}
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0 p-2 sm:p-3 flex flex-col justify-between">
            <div>
              <h3 className={`text-xs sm:text-sm font-semibold line-clamp-1 transition ${stock > 0 ? "text-[#0A0A0A] group-hover:text-[#FFB800]" : "text-[#9E9E9E]"}`}>
                {name}
              </h3>
              <p className="text-[10px] sm:text-xs text-[#777] line-clamp-1 mt-0.5">{plainDesc}</p>
            </div>
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-baseline gap-1">
                {stock > 0 || displayPrice > 0 ? (
                  <>
                    <span className={`text-sm sm:text-base font-bold ${stock === 0 ? "text-[#9E9E9E]" : "text-[#0A0A0A]"}`}>
                      {formatPrice(displayPrice)}
                    </span>
                    {hasDiscount && (
                      <span className="text-[9px] sm:text-xs text-[#9E9E9E] line-through">{formatPrice(price)}</span>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-[#BDBDBD]">Ціна не вказана</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {stock > 0 && (
                  <>
                    <button onClick={handleWishlist} className={`w-6 h-6 rounded-full flex items-center justify-center transition ${inWishlist ? "text-red-500" : "text-[#BDBDBD] hover:text-red-400"}`}>
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={inWishlist ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                    </button>
                    <button onClick={handleAddToCart} className="btn-primary px-2.5 py-1 text-[10px] sm:text-xs">
                      У кошик
                    </button>
                  </>
                )}
                {stock === 0 && <span className="text-[10px] text-[#9E9E9E]">Немає</span>}
              </div>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  // ── GALLERY VIEW ──
  if (viewMode === "gallery") {
    return (
      <Link href={`/catalog/${slug}`} className="group block">
        <div className={`rounded-xl overflow-hidden border transition-all duration-200 ${
          stock > 0
            ? "border-[#EFEFEF] bg-white hover:shadow-lg hover:-translate-y-0.5"
            : "border-[#EFEFEF] bg-[#FAFAFA] opacity-60"
        }`} style={{ boxShadow: stock > 0 ? '0 1px 3px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.06)' : 'none' }}>
          {/* Large image */}
          <div className={`h-52 sm:h-72 flex items-center justify-center relative ${stock > 0 ? "bg-[#FAFAFA]" : "bg-[#EFEFEF]"}`}>
            {image ? (
              <Image src={image} alt={name} className="h-full w-full object-contain p-4" width={288} height={288} loading="lazy" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-20 w-20 transition ${stock > 0 ? "text-[#DADADA] group-hover:text-[#FFD600]" : "text-[#DADADA]"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            )}
            {isPromo && stock > 0 && (
              <span className="absolute top-2 left-2 bg-[#0A0A0A] text-[#FFD600] text-xs font-bold px-2.5 py-1 rounded-lg">
                {promoLabel || "Акція"}
              </span>
            )}
            {/* Action buttons */}
            {stock > 0 && (
              <div className="absolute top-2 right-2 flex flex-col gap-1.5">
                <button onClick={handleWishlist} className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${inWishlist ? "bg-red-500 text-white shadow-md" : "bg-white/90 text-[#9E9E9E] hover:text-red-500 shadow-sm"}`}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill={inWishlist ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </button>
                <button onClick={handleCompare} className={`w-8 h-8 rounded-full flex items-center justify-center transition-all relative ${inCompare ? "bg-[#FFD600] text-[#0A0A0A] shadow-md" : "bg-white/90 text-[#9E9E9E] hover:text-[#FFD600] shadow-sm"}`}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          {/* Info */}
          <div className="p-3 sm:p-5">
            {category && !/^\d+$/.test(category.name) && (
              <span className="inline-block text-[10px] sm:text-xs text-[#9E9E9E] bg-[#F0F0F0] px-2 py-0.5 rounded-md mb-2 font-medium">{category.name}</span>
            )}
            <h3 className={`text-sm sm:text-lg font-semibold mb-1 transition ${stock > 0 ? "text-[#0A0A0A] group-hover:text-[#FFB800]" : "text-[#9E9E9E]"}`}>
              {name}
            </h3>
            <p className="text-xs sm:text-sm text-[#555] mb-3 line-clamp-2">{plainDesc}</p>
            <div className="flex items-center justify-between">
              <div>
                {stock > 0 || displayPrice > 0 ? (
                  <>
                    <span className={`text-base sm:text-xl font-bold ${stock === 0 ? "text-[#9E9E9E]" : "text-[#0A0A0A]"}`}>
                      {formatPrice(displayPrice)}
                    </span>
                    {hasDiscount && (
                      <span className="text-[10px] sm:text-xs text-[#9E9E9E] line-through ml-1">{formatPrice(price)}</span>
                    )}
                    {wholesalePrice != null && wholesalePrice < price && !isPromo && (
                      <span className="block text-[10px] sm:text-xs text-[#FFB800] font-medium">Оптова ціна</span>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-[#BDBDBD]">Ціна не вказана</span>
                )}
              </div>
              {stock > 0 ? (
                <button onClick={handleAddToCart} className="btn-primary px-3 py-1.5 text-xs flex-shrink-0">
                  У кошик
                </button>
              ) : (
                <span className="text-sm text-[#9E9E9E] font-medium">Немає в наявності</span>
              )}
            </div>
          </div>
        </div>
      </Link>
    );
  }

  // ── GRID VIEW (default) ──
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
        <div className={`h-28 sm:h-48 flex items-center justify-center relative ${stock > 0 ? "bg-[#FAFAFA]" : "bg-[#EFEFEF]"}`}>
          {image ? (
            <Image
              src={image}
              alt={name}
              className="h-full w-full object-contain p-2"
              width={192}
              height={192}
              loading="lazy"
            />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-10 sm:h-20 w-10 sm:w-20 transition duration-200 ${
              stock > 0 ? "text-[#DADADA] group-hover:text-[#FFD600]" : "text-[#DADADA]"
            }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          )}
          {isPromo && stock > 0 && (
            <span className="absolute top-1 left-1 sm:top-2 sm:left-2 bg-[#0A0A0A] text-[#FFD600] text-[8px] sm:text-xs font-bold px-1 sm:px-2.5 py-0.5 sm:py-1 rounded sm:rounded-lg">
              {promoLabel || "Акція"}
            </span>
          )}

          {/* Wishlist & Compare buttons */}
          {stock > 0 && (
            <div className="absolute top-1 right-1 sm:top-2 sm:right-2 flex flex-col gap-1">
              <button
                onClick={handleWishlist}
                className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-all duration-200 ${
                  inWishlist
                    ? "bg-red-500 text-white shadow-md"
                    : "bg-white/90 text-[#9E9E9E] hover:text-red-500 shadow-sm hover:shadow-md"
                }`}
                title={inWishlist ? "Видалити з обраного" : "Додати в обране"}
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill={inWishlist ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </button>
              <button
                onClick={handleCompare}
                className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-all duration-200 relative ${
                  inCompare
                    ? "bg-[#FFD600] text-[#0A0A0A] shadow-md"
                    : "bg-white/90 text-[#9E9E9E] hover:text-[#FFD600] shadow-sm hover:shadow-md"
                }`}
                title={inCompare ? "Видалити з порівняння" : "Додати до порівняння"}
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                </svg>
                {compareFull && (
                  <span className="absolute -bottom-8 right-0 bg-[#0A0A0A] text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
                    Макс. 4
                  </span>
                )}
              </button>
            </div>
          )}
        </div>

        <div className="p-2 sm:p-4">
          {/* Category badge */}
          {category && !/^\d+$/.test(category.name) && (
            <span className="inline-block text-[8px] sm:text-xs text-[#9E9E9E] bg-[#F0F0F0] px-1 sm:px-2 py-0.5 rounded mb-1 sm:mb-2 font-medium truncate max-w-full">
              {category.name}
            </span>
          )}

          <h3 className={`text-[11px] sm:text-[15px] font-semibold mb-0.5 sm:mb-1.5 line-clamp-2 transition duration-200 leading-tight sm:leading-snug ${
            stock > 0 ? "text-[#0A0A0A] group-hover:text-[#FFB800]" : "text-[#9E9E9E]"
          }`}>
            {name}
          </h3>

          {/* Description - hidden on mobile for space */}
          <p className="hidden sm:block text-sm text-[#555] mb-3 line-clamp-2 leading-relaxed">{plainDesc}</p>

          {/* Price + button */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
            <div className="min-w-0">
              {stock > 0 || displayPrice > 0 ? (
                <>
                  <span className={`text-[12px] sm:text-lg font-bold ${
                    stock === 0 ? "text-[#9E9E9E]" : "text-[#0A0A0A]"
                  }`}>
                    {formatPrice(displayPrice)}
                  </span>
                  {hasDiscount && (
                    <span className="text-[8px] sm:text-[10px] text-[#9E9E9E] line-through ml-0.5 sm:ml-1">{formatPrice(price)}</span>
                  )}
                  {wholesalePrice != null && wholesalePrice < price && !isPromo && (
                    <span className="block text-[8px] sm:text-[10px] text-[#FFB800] font-medium">Оптова ціна</span>
                  )}
                </>
              ) : (
                <span className="text-[10px] sm:text-sm text-[#BDBDBD]">Ціна не вказана</span>
              )}
            </div>
            {stock > 0 ? (
              <button
                onClick={handleAddToCart}
                className="btn-primary px-2 sm:px-3 py-1 sm:py-1.5 text-[9px] sm:text-xs flex-shrink-0 w-full sm:w-auto"
              >
                У кошик
              </button>
            ) : (
              <span className="text-[10px] sm:text-sm text-[#9E9E9E] font-medium">Немає в наявності</span>
            )}
          </div>
          {isWholesale && stock > 0 && stock <= 5 && (
            <p className="text-[8px] sm:text-xs text-[#FFB800] mt-1 sm:mt-1.5 font-medium">Залишилось {stock} шт.</p>
          )}
        </div>
      </div>
    </Link>
  );
}
