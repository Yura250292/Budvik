"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { getCart, getCartCount } from "@/lib/cart";

export default function BottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    const update = () => setCartCount(getCartCount(getCart()));
    update();
    window.addEventListener("cart-updated", update);
    return () => window.removeEventListener("cart-updated", update);
  }, []);

  const role = (session?.user as any)?.role;

  if (pathname?.startsWith("/sales")) return null;

  const isActive = (path: string) => {
    if (path === "/") return pathname === "/";
    return pathname.startsWith(path);
  };

  const activeClass = "text-[#FFD600]";
  const inactiveClass = "text-white/50";

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-gradient-to-r from-[#0A0A0A] via-[#141414] to-[#1A1A1A] border-t border-white/10 z-50 safe-area-bottom" style={{ boxShadow: '0 -2px 8px rgba(0,0,0,0.3)' }}>
      <div className="flex items-center justify-around h-16 px-2">
        {/* Home */}
        <Link href="/" className={`flex flex-col items-center gap-0.5 min-w-[56px] py-2 active:scale-90 transition-transform duration-100 ${isActive("/") && !isActive("/catalog") && !isActive("/cart") && !isActive("/dashboard") && !isActive("/admin") ? activeClass : inactiveClass}`}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <span className="text-[10px] font-medium">Головна</span>
        </Link>

        {/* Catalog */}
        <Link href="/catalog" className={`flex flex-col items-center gap-0.5 min-w-[56px] py-2 active:scale-90 transition-transform duration-100 ${isActive("/catalog") ? activeClass : inactiveClass}`}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
          <span className="text-[10px] font-medium">Каталог</span>
        </Link>

        {/* Cart */}
        <Link href="/cart" className={`flex flex-col items-center gap-0.5 min-w-[56px] py-2 relative active:scale-90 transition-transform duration-100 ${isActive("/cart") ? activeClass : inactiveClass}`}>
          <div className="relative">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
            {cartCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-[#FFD600] text-[#0A0A0A] text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                {cartCount > 9 ? "9+" : cartCount}
              </span>
            )}
          </div>
          <span className="text-[10px] font-medium">Кошик</span>
        </Link>

        {/* Simulation */}
        <Link href="/simulation" className={`flex flex-col items-center gap-0.5 min-w-[56px] py-2 active:scale-90 transition-transform duration-100 ${isActive("/simulation") ? activeClass : inactiveClass}`}>
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span className="text-[10px] font-medium">Симуляція</span>
        </Link>

        {/* 5th slot: role-specific or profile */}
        {session && role === "SALES" ? (
          <Link href="/sales" className={`flex flex-col items-center gap-0.5 min-w-[56px] py-2 active:scale-90 transition-transform duration-100 ${isActive("/sales") ? activeClass : inactiveClass}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[10px] font-medium">Торговий</span>
          </Link>
        ) : session && (role === "ADMIN" || role === "MANAGER") ? (
          <Link href="/admin" className={`flex flex-col items-center gap-0.5 min-w-[56px] py-2 active:scale-90 transition-transform duration-100 ${isActive("/admin") ? activeClass : inactiveClass}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-[10px] font-medium">Панель</span>
          </Link>
        ) : (
          <Link href={session ? "/dashboard" : "/login"} className={`flex flex-col items-center gap-0.5 min-w-[56px] py-2 active:scale-90 transition-transform duration-100 ${isActive("/dashboard") || (!session && isActive("/login")) ? activeClass : inactiveClass}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-[10px] font-medium">{session ? "Кабінет" : "Увійти"}</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
