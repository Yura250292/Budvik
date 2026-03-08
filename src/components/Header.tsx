"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { getCart, getCartCount } from "@/lib/cart";

export default function Header() {
  const { data: session } = useSession();
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    const update = () => setCartCount(getCartCount(getCart()));
    update();
    window.addEventListener("cart-updated", update);
    return () => window.removeEventListener("cart-updated", update);
  }, []);

  const role = (session?.user as any)?.role;

  return (
    <header className="bg-gradient-to-r from-[#0A0A0A] via-[#141414] to-[#1A1A1A] text-white sticky top-0 z-50 border-b border-white/10" style={{ boxShadow: '0 1px 6px rgba(0,0,0,0.2)' }}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14 md:h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5">
            <span className="text-xl md:text-2xl font-bold text-[#FFD600]">BUDVIK</span>
            <span className="text-xs text-[#9E9E9E] hidden sm:block">Iнструменти</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8">
            <Link href="/catalog" className="text-white/80 hover:text-[#FFD600] transition duration-200 text-sm font-medium">
              Каталог
            </Link>
            <Link href="/ai/wizard" className="text-white/80 hover:text-[#FFD600] transition duration-200 text-sm font-medium flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
              AI Підбір
            </Link>
            {session ? (
              <>
                {(role === "ADMIN" || role === "SALES") && (
                  <Link href="/admin" className="text-white/80 hover:text-[#FFD600] transition duration-200 text-sm font-medium">
                    Панель управління
                  </Link>
                )}
                <Link href="/dashboard" className="text-white/80 hover:text-[#FFD600] transition duration-200 text-sm font-medium">
                  Кабінет
                </Link>
                <Link href="/dashboard/orders" className="text-white/80 hover:text-[#FFD600] transition duration-200 text-sm font-medium">
                  Замовлення
                </Link>
                <Link
                  href="/dashboard/loyalty"
                  className="flex items-center gap-1.5 bg-[#FFD600] text-[#0A0A0A] px-3.5 py-1.5 rounded-lg text-sm font-semibold hover:bg-[#FFC400] transition duration-200"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Болти
                </Link>
              </>
            ) : null}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* Cart - desktop only */}
            <Link href="/cart" className="relative hidden md:flex items-center justify-center bg-[#FFD600] hover:bg-[#FFC400] text-[#0A0A0A] rounded-lg px-3 py-2 transition duration-200">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
              </svg>
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-white text-[#0A0A0A] text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                  {cartCount}
                </span>
              )}
            </Link>

            {/* Mobile: Болти badge */}
            {session && (
              <Link
                href="/dashboard/loyalty"
                className="md:hidden flex items-center gap-1 bg-[#FFD600] text-[#0A0A0A] px-2.5 py-1.5 rounded-lg text-xs font-semibold"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Болти
              </Link>
            )}

            {/* Auth buttons */}
            {session ? (
              <div className="flex items-center gap-2.5">
                <span className="text-sm hidden lg:block text-white/90 font-medium">
                  {session.user.name}
                  {role === "WHOLESALE" && (
                    <span className="ml-1.5 bg-[#FFD600] text-[#0A0A0A] text-[10px] px-1.5 py-0.5 rounded-md font-semibold">ОПТ</span>
                  )}
                </span>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="text-xs md:text-sm bg-white/10 border border-white/20 text-white px-3 py-1.5 rounded-[10px] hover:bg-white/20 transition duration-200 font-medium"
                >
                  Вийти
                </button>
              </div>
            ) : (
              <div className="hidden md:flex items-center gap-2.5">
                <Link href="/login" className="text-sm text-white/80 hover:text-[#FFD600] transition duration-200 font-medium">
                  Увійти
                </Link>
                <Link href="/register" className="text-sm bg-[#FFD600] text-[#0A0A0A] px-4 py-2 rounded-[10px] font-semibold hover:bg-[#FFC400] transition duration-200">
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
