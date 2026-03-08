"use client";

import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { getCart, getCartCount } from "@/lib/cart";
import { getWishlistCount } from "@/lib/wishlist";
import { getCompareCount } from "@/lib/compare";

export default function Header() {
  const { data: session } = useSession();
  const [cartCount, setCartCount] = useState(0);
  const [wishlistCount, setWishlistCount] = useState(0);
  const [compareCount, setCompareCount] = useState(0);

  useEffect(() => {
    const updateCart = () => setCartCount(getCartCount(getCart()));
    const updateWish = () => setWishlistCount(getWishlistCount());
    const updateComp = () => setCompareCount(getCompareCount());
    updateCart(); updateWish(); updateComp();
    window.addEventListener("cart-updated", updateCart);
    window.addEventListener("wishlist-updated", updateWish);
    window.addEventListener("compare-updated", updateComp);
    return () => {
      window.removeEventListener("cart-updated", updateCart);
      window.removeEventListener("wishlist-updated", updateWish);
      window.removeEventListener("compare-updated", updateComp);
    };
  }, []);

  const role = (session?.user as any)?.role;

  const navLinkClass = "text-white/80 hover:text-[#FFD600] transition text-sm font-medium text-center";

  return (
    <header className="bg-gradient-to-r from-[#0A0A0A] via-[#141414] to-[#1A1A1A] text-white sticky top-0 z-50 border-b border-white/10" style={{ boxShadow: '0 1px 6px rgba(0,0,0,0.2)' }}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14 md:h-16 gap-3">
          {/* Logo */}
          <Link href="/" className="flex flex-col items-center flex-shrink-0">
            <Image src="/logo.png" alt="БУДВІК" width={36} height={36} className="h-8 w-auto md:h-9 logo-gold" />
            <span className="text-[9px] md:text-[10px] font-bold leading-tight mt-0.5 logo-subtitle-animated">Ваш світ інструментів</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-4 lg:gap-5 flex-shrink-0">
            <Link href="/catalog" className={navLinkClass}>Каталог</Link>
            <Link href="/ai/wizard" className={`${navLinkClass} flex items-center gap-1`}>
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                {/* Mini viking helmet */}
                <path d="M4 14C4 8.5 8 4 12 4C16 4 20 8.5 20 14V16H4V14Z" fill="#FFD600" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M4 12H20" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M4 12L1 6" stroke="#FFD600" strokeWidth="2" strokeLinecap="round"/>
                <path d="M20 12L23 6" stroke="#FFD600" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span className="whitespace-nowrap">AI&nbsp;Підбір</span>
            </Link>
            {session ? (
              <>
                {(role === "ADMIN" || role === "SALES") && (
                  <Link href="/admin" className={navLinkClass}>Панель</Link>
                )}
                <Link href="/dashboard" className={navLinkClass}>Кабінет</Link>
                <Link href="/dashboard/orders" className={navLinkClass}>Замовлення</Link>
              </>
            ) : null}
          </nav>

          {/* Right side: icons + auth */}
          <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
            {/* Wishlist - desktop */}
            <Link href="/wishlist" className="relative hidden md:flex items-center justify-center text-white/60 hover:text-red-400 transition p-1.5" title="Обране">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill={wishlistCount > 0 ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              {wishlistCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                  {wishlistCount}
                </span>
              )}
            </Link>

            {/* Compare - desktop, only show when items added */}
            {compareCount > 0 && (
              <Link href="/compare" className="relative hidden md:flex items-center justify-center text-[#FFD600] transition p-1.5" title="Порівняння">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                </svg>
                <span className="absolute -top-0.5 -right-0.5 bg-[#FFD600] text-[#0A0A0A] text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                  {compareCount}
                </span>
              </Link>
            )}

            {/* Болти badge */}
            {session && (
              <Link
                href="/dashboard/loyalty"
                className="flex items-center gap-1 bg-[#FFD600] text-[#0A0A0A] px-2.5 py-1.5 rounded-lg text-xs font-semibold hover:bg-[#FFC400] transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="hidden md:inline">Болти</span>
              </Link>
            )}

            {/* Cart */}
            <Link href="/cart" className="relative hidden md:flex items-center justify-center bg-[#FFD600] hover:bg-[#FFC400] text-[#0A0A0A] rounded-lg px-2.5 py-1.5 transition">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
              </svg>
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-white text-[#0A0A0A] text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                  {cartCount}
                </span>
              )}
            </Link>

            {/* Auth buttons */}
            {session ? (
              <div className="flex items-center gap-2">
                <span className="text-sm hidden xl:block text-white/90 font-medium">
                  {session.user.name}
                  {role === "WHOLESALE" && (
                    <span className="ml-1.5 bg-[#FFD600] text-[#0A0A0A] text-[10px] px-1.5 py-0.5 rounded-md font-semibold">ОПТ</span>
                  )}
                </span>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="text-xs md:text-sm bg-white/10 border border-white/20 text-white px-3 py-1.5 rounded-[10px] hover:bg-white/20 transition font-medium"
                >
                  Вийти
                </button>
              </div>
            ) : (
              <div className="hidden md:flex items-center gap-2">
                <Link href="/login" className="text-sm text-white/80 hover:text-[#FFD600] transition font-medium">
                  Увійти
                </Link>
                <Link href="/register" className="text-sm bg-[#FFD600] text-[#0A0A0A] px-3.5 py-1.5 rounded-[10px] font-semibold hover:bg-[#FFC400] transition">
                  Реєстрація
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
