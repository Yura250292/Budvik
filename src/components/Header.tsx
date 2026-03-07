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
    <header className="bg-gray-900 text-white shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14 md:h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl md:text-2xl font-bold text-orange-500">BUDVIK</span>
            <span className="text-xs text-gray-400 hidden sm:block">Iнструменти</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/catalog" className="hover:text-orange-400 transition text-sm">
              Каталог
            </Link>
            {session ? (
              <>
                {(role === "ADMIN" || role === "SALES") && (
                  <Link href="/admin" className="hover:text-orange-400 transition text-sm">
                    Панель управління
                  </Link>
                )}
                <Link href="/dashboard" className="hover:text-orange-400 transition text-sm">
                  Кабінет
                </Link>
                <Link href="/dashboard/orders" className="hover:text-orange-400 transition text-sm">
                  Замовлення
                </Link>
                <Link
                  href="/dashboard/loyalty"
                  className="flex items-center gap-1 bg-orange-600 px-3 py-1 rounded-full text-sm font-semibold hover:bg-orange-500 transition"
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
            <Link href="/cart" className="relative hover:text-orange-400 transition hidden md:block">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
              </svg>
              {cartCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-orange-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </Link>

            {/* Mobile: Болти badge */}
            {session && (
              <Link
                href="/dashboard/loyalty"
                className="md:hidden flex items-center gap-1 bg-orange-600/90 px-2.5 py-1 rounded-full text-xs font-semibold"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Болти
              </Link>
            )}

            {/* Auth buttons */}
            {session ? (
              <div className="flex items-center gap-2">
                <span className="text-sm hidden lg:block">{session.user.name}</span>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="text-xs md:text-sm bg-gray-700 px-2.5 md:px-3 py-1.5 rounded hover:bg-gray-600 transition"
                >
                  Вийти
                </button>
              </div>
            ) : (
              <div className="hidden md:flex items-center gap-2">
                <Link href="/login" className="text-sm hover:text-orange-400 transition">
                  Увійти
                </Link>
                <Link href="/register" className="text-sm bg-orange-600 px-3 py-1.5 rounded hover:bg-orange-500 transition">
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
