"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import Breadcrumbs from "./Breadcrumbs";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/lib/useProfile";
import { titleForPath, type AdminRole } from "@/lib/admin-nav";
import { usePathname } from "next/navigation";

const ROLE_LABEL: Record<AdminRole, string> = {
  ADMIN: "Адміністратор",
  MANAGER: "Менеджер",
  SALES: "Торговий менеджер",
};

/**
 * Статична шапка панелі: не скролиться разом зі сторінкою (сидить у
 * flex-колонці шелла над власним скрол-контейнером), тож профіль і вихід
 * доступні з будь-якої точки довгого списку.
 *
 * На телефоні хлібні крихти не влазять поруч із бургером і аватаркою, тому
 * там показуємо тільки заголовок поточного розділу, а крихти — від sm.
 */
export default function AdminHeader({
  role,
  onOpenDrawer,
  onToggleRail,
  railCollapsed,
}: {
  role: AdminRole;
  onOpenDrawer: () => void;
  onToggleRail: () => void;
  railCollapsed: boolean;
}) {
  const { data: session } = useSession();
  const pathname = usePathname() ?? "/admin";
  const profile = useProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  // Меню закривається на переході — інакше воно висить над новою сторінкою.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const name = profile?.name || session?.user?.name || session?.user?.email || "Користувач";

  return (
    <header
      className="flex-shrink-0 border-b border-g200 bg-white"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="flex h-14 items-center gap-2 px-2 sm:px-4">
        <button
          type="button"
          onClick={onOpenDrawer}
          className="md:hidden flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[var(--radius-btn)] text-g500 transition-colors hover:bg-g50 hover:text-bk active:bg-g100"
          aria-label="Відкрити меню"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onToggleRail}
          className="hidden md:flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[var(--radius-btn)] text-g500 transition-colors hover:bg-g50 hover:text-bk"
          aria-label={railCollapsed ? "Розгорнути меню" : "Згорнути меню"}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5M3.75 12h16.5M3.75 18.75h16.5" />
          </svg>
        </button>

        {/* Телефон: заголовок розділу замість крихт — вони не влазять */}
        <h1 className="sm:hidden min-w-0 flex-1 truncate text-[15px] font-bold text-bk">
          {titleForPath(pathname)}
        </h1>
        <div className="hidden sm:flex min-w-0 flex-1">
          <Breadcrumbs />
        </div>

        <div className="flex flex-shrink-0 items-center gap-1.5">
          {(role === "ADMIN" || role === "MANAGER") && (
            <Link
              href="/manager"
              className="hidden lg:flex items-center gap-1.5 rounded-[var(--radius-btn)] px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #374151, #1F2937)" }}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Менеджер
            </Link>
          )}

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Профіль і налаштування"
              className="flex min-h-11 items-center gap-2 rounded-[var(--radius-btn)] py-1 pl-1 pr-1 transition-colors hover:bg-g50 active:bg-g100 xl:pr-2"
            >
              <Avatar name={name} id={profile?.id} src={profile?.avatarUrl} color={profile?.color} size={34} />
              <span className="hidden xl:block min-w-0 max-w-[160px] text-left">
                <span className="block truncate text-[13px] font-semibold leading-tight text-bk">{name}</span>
                <span className="block text-[11px] leading-tight text-g500">{ROLE_LABEL[role]}</span>
              </span>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-1.5 w-[min(280px,calc(100vw-1rem))] overflow-hidden rounded-[var(--radius-card)] border border-g200 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
              >
                <div className="flex items-center gap-3 border-b border-g200 px-3.5 py-3">
                  <Avatar name={name} id={profile?.id} src={profile?.avatarUrl} color={profile?.color} size={40} />
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-bk">{name}</p>
                    <p className="text-[12px] text-g500">{ROLE_LABEL[role]}</p>
                    {profile?.email && <p className="truncate text-[11px] text-g400">{profile.email}</p>}
                  </div>
                </div>

                <Link
                  href="/sales/profile"
                  role="menuitem"
                  className="flex min-h-11 items-center gap-2.5 px-3.5 text-[14px] font-medium text-bk transition-colors hover:bg-g50 active:bg-g100"
                  onClick={() => setMenuOpen(false)}
                >
                  <svg className="h-4.5 w-4.5 text-g500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                  Мій профіль
                </Link>

                <Link
                  href="/sales/profile#password"
                  role="menuitem"
                  className="flex min-h-11 items-center gap-2.5 border-t border-g200 px-3.5 text-[14px] font-medium text-bk transition-colors hover:bg-g50 active:bg-g100"
                  onClick={() => setMenuOpen(false)}
                >
                  <svg className="h-4.5 w-4.5 text-g500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  Змінити пароль
                </Link>

                {(role === "ADMIN" || role === "MANAGER") && (
                  <Link
                    href="/manager"
                    role="menuitem"
                    className="flex min-h-11 items-center gap-2.5 border-t border-g200 px-3.5 text-[14px] font-medium text-bk transition-colors hover:bg-g50 active:bg-g100 lg:hidden"
                    onClick={() => setMenuOpen(false)}
                  >
                    <svg className="h-4.5 w-4.5 text-g500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Кабінет менеджера
                  </Link>
                )}

                <Link
                  href="/"
                  role="menuitem"
                  className="flex min-h-11 items-center gap-2.5 border-t border-g200 px-3.5 text-[14px] font-medium text-bk transition-colors hover:bg-g50 active:bg-g100"
                  onClick={() => setMenuOpen(false)}
                >
                  <svg className="h-4.5 w-4.5 text-g500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  На сайт
                </Link>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="flex min-h-11 w-full items-center gap-2.5 border-t border-g200 px-3.5 text-left text-[14px] font-medium text-red-600 transition-colors hover:bg-red-50 active:bg-red-100"
                >
                  <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Вийти
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
