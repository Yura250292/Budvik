"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/lib/useProfile";
import { useIsNativeApp } from "@/lib/useIsNativeApp";

/**
 * Аватарка з меню у шапці торгового.
 *
 * Раніше жила лише на головній /sales, тож зі списку клієнтів чи документів
 * до профілю й виходу треба було спершу повернутися на головну. Тепер вона
 * у самій шапці — тобто на всіх екранах секції.
 */
export default function SalesProfileMenu() {
  const profile = useProfile();
  const pathname = usePathname();
  const isApp = useIsNativeApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const name = profile?.name ?? "Профіль";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Профіль і налаштування"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
      >
        {profile ? (
          <Avatar name={profile.name} id={profile.id} src={profile.avatarUrl} color={profile.color} size={30} />
        ) : (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(260px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white shadow-[0_8px_32px_rgba(0,0,0,0.2)]"
        >
          <div className="flex items-center gap-3 border-b border-g200 px-4 py-3">
            {profile && (
              <Avatar name={profile.name} id={profile.id} src={profile.avatarUrl} color={profile.color} size={40} />
            )}
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-bk">{name}</p>
              <p className="text-[12px] text-g500">Торговий менеджер</p>
            </div>
          </div>

          <Link
            href="/sales/profile"
            role="menuitem"
            className="flex min-h-11 items-center gap-2.5 px-4 text-[14px] font-medium text-bk active:bg-g100"
            onClick={() => setOpen(false)}
          >
            <svg className="h-4.5 w-4.5 text-g500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            Мій профіль
          </Link>

          <Link
            href="/sales/profile#password"
            role="menuitem"
            className="flex min-h-11 items-center gap-2.5 border-t border-g200 px-4 text-[14px] font-medium text-bk active:bg-g100"
            onClick={() => setOpen(false)}
          >
            <svg className="h-4.5 w-4.5 text-g500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Змінити пароль
          </Link>

          {/* Усередині застосунку пункт зайвий — він уже встановлений. */}
          {!isApp && (
            <Link
              href="/sales/app"
              role="menuitem"
              className="flex min-h-11 items-center gap-2.5 border-t border-g200 px-4 text-[14px] font-medium text-bk active:bg-g100"
              onClick={() => setOpen(false)}
            >
              <svg className="h-4.5 w-4.5 text-g500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Застосунок
            </Link>
          )}

          {/* У застосунку вітрини магазину немає — назад у кабінет з неї
              не було б чим повернутись. */}
          {!isApp && (
            <Link
              href="/"
              role="menuitem"
              className="flex min-h-11 items-center gap-2.5 border-t border-g200 px-4 text-[14px] font-medium text-bk active:bg-g100"
              onClick={() => setOpen(false)}
            >
              <svg className="h-4.5 w-4.5 text-g500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              На сайт
            </Link>
          )}

          <button
            type="button"
            role="menuitem"
            /*
             * У застосунку вихід веде через натив: signOut стер би лише
             * кукі, а токен пристрою лишився б — застосунок опинився б
             * «наполовину залогіненим» і мовчки писав би трек далі.
             */
            onClick={() =>
              isApp ? window.BudvikApp?.logout() : signOut({ callbackUrl: "/" })
            }
            className="flex min-h-11 w-full items-center gap-2.5 border-t border-g200 px-4 text-left text-[14px] font-medium text-red-600 active:bg-red-50"
          >
            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Вийти
          </button>
        </div>
      )}
    </div>
  );
}
