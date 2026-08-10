"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import SidebarNav from "./Sidebar";
import AdminHeader from "./AdminHeader";
import AdminBottomNav from "./AdminBottomNav";
import TabsProvider from "./tabs/TabsProvider";
import TabsBar from "./tabs/TabsBar";
import TabsViewport from "./tabs/TabsViewport";
import LinkInterceptor from "./tabs/LinkInterceptor";
import { isAdminRole, type AdminRole } from "@/lib/admin-nav";

const RAIL_KEY = "budvik:admin:sidebar:rail-collapsed:v1";

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/admin" className="flex h-14 flex-shrink-0 items-center gap-2.5 border-b border-white/10 px-3.5">
      <Image src="/logo-gold.png" alt="" width={28} height={28} className="flex-shrink-0" />
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-bold leading-tight text-white">БУДВІК</span>
          <span className="block text-[10px] uppercase tracking-wider text-white/40">Панель управління</span>
        </span>
      )}
    </Link>
  );
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname() ?? "/admin";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);

  useEffect(() => {
    try {
      setRailCollapsed(localStorage.getItem(RAIL_KEY) === "1");
    } catch {
      /* приватний режим */
    }
  }, []);

  // Мобільний drawer закривається сам при переході — інакше він
  // перекриває сторінку, на яку щойно перейшли.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [drawerOpen]);

  const toggleRail = () => {
    setRailCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {
        /* приватний режим */
      }
      return next;
    });
  };

  const role = (session?.user as { role?: string } | undefined)?.role;
  const userId = (session?.user as { id?: string } | undefined)?.id;

  if (status === "loading") {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-g200 border-t-primary" aria-label="Завантаження" />
      </div>
    );
  }

  // Доступ уже перевіряє middleware; тут — запобіжник на випадок
  // прямого рендеру шелла з іншою роллю.
  if (!isAdminRole(role)) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFEAEA]">
          <svg className="h-7 w-7 text-[#C62828]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-bk">Доступ заборонено</h1>
        <p className="mt-2 text-sm text-g400">У вас немає доступу до панелі управління</p>
      </div>
    );
  }

  const adminRole = role as AdminRole;

  return (
    <TabsProvider userId={userId} role={adminRole}>
      <LinkInterceptor role={adminRole} />
      <div className="flex h-[100dvh] overflow-hidden bg-background">
        {/* Десктопний сайдбар */}
        <aside
          className={`hidden md:flex flex-shrink-0 flex-col overflow-y-auto bg-bk transition-[width] duration-200 ${
            railCollapsed ? "w-16" : "w-[264px]"
          }`}
        >
          <SidebarBrand collapsed={railCollapsed} />
          <SidebarNav role={adminRole} railCollapsed={railCollapsed} />
        </aside>

        {/* Мобільний drawer */}
        {drawerOpen && (
          <div className="md:hidden fixed inset-0 z-[60] flex" role="dialog" aria-modal="true" aria-label="Меню розділів">
            <div
              className="absolute inset-0 bg-black/50 motion-safe:animate-[fadeIn_150ms_ease-out]"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <aside
              className="relative flex w-[280px] max-w-[84vw] flex-col overflow-y-auto overscroll-contain bg-bk shadow-2xl motion-safe:animate-[slideInLeft_200ms_cubic-bezier(0.22,1,0.36,1)]"
              style={{
                paddingTop: "env(safe-area-inset-top, 0px)",
                paddingBottom: "env(safe-area-inset-bottom, 0px)",
              }}
            >
              <SidebarBrand collapsed={false} />
              <SidebarNav role={adminRole} onNavigate={() => setDrawerOpen(false)} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <AdminHeader
            role={adminRole}
            onOpenDrawer={() => setDrawerOpen(true)}
            onToggleRail={toggleRail}
            railCollapsed={railCollapsed}
          />
          <TabsBar />
          {/*
            Власний скрол-контейнер із isolate: sticky-хедери всередині
            сторінок липнуть до верху цієї області й не можуть перекрити
            шапку шелла чи drawer, попри свій z-50.
          */}
          <main className="isolate flex-1 overflow-y-auto overflow-x-hidden">
            <TabsViewport>{children}</TabsViewport>
          </main>
          <AdminBottomNav
            role={adminRole}
            onOpenDrawer={() => setDrawerOpen(true)}
            drawerOpen={drawerOpen}
          />
        </div>
      </div>
    </TabsProvider>
  );
}
