"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminIcon } from "./icons";
import { canAccess, type AdminRole } from "@/lib/admin-nav";
import type { IconKey } from "./icons";

/**
 * Нижня навігація панелі — тільки на телефоні.
 *
 * Раніше єдиним входом у меню був бургер у самому верху: щоб перемкнути
 * розділ на 6-дюймовому екрані, треба було тягнутися великим пальцем через
 * увесь екран. Чотири найчастіші розділи плюс «Ще» (той самий drawer)
 * лишають навігацію в зоні великого пальця.
 *
 * П'ять цілей — стеля для 360px: шосте посилання дає ширину 60px, що вже
 * менше рекомендованих 44px разом із проміжками.
 */

type Item = { href: string; label: string; iconKey: IconKey; exact?: boolean };

const ITEMS: Item[] = [
  { href: "/admin", label: "Дашборд", iconKey: "dashboard", exact: true },
  { href: "/admin/orders", label: "Замовлення", iconKey: "orders" },
  { href: "/admin/erp/sales", label: "Продаж", iconKey: "money" },
  { href: "/admin/sales-analytics", label: "Аналітика", iconKey: "chart" },
];

export default function AdminBottomNav({
  role,
  onOpenDrawer,
  drawerOpen,
}: {
  role: AdminRole;
  onOpenDrawer: () => void;
  drawerOpen: boolean;
}) {
  const pathname = usePathname() ?? "/admin";

  const isActive = (item: Item) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");

  // Торговому не показуємо розділи, які відіб'є middleware.
  const items = ITEMS.filter((i) => canAccess(i.href, role));

  return (
    <nav
      className="md:hidden flex-shrink-0 border-t border-white/10"
      style={{
        background: "linear-gradient(to right, #0A0A0A, #141414, #1A1A1A)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.25)",
      }}
      aria-label="Основні розділи"
    >
      <div className="flex h-14 items-stretch justify-around px-1">
        {items.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className="flex min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 transition-transform duration-100 active:scale-95"
              style={{ color: active ? "#FFD600" : "rgba(255,255,255,0.45)" }}
            >
              <span className="[&>svg]:h-[22px] [&>svg]:w-[22px]" aria-hidden="true">
                <AdminIcon name={item.iconKey} />
              </span>
              <span className="text-[10px] leading-none" style={{ fontWeight: active ? 700 : 500 }}>
                {item.label}
              </span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onOpenDrawer}
          aria-expanded={drawerOpen}
          aria-label="Усі розділи"
          className="flex min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 transition-transform duration-100 active:scale-95"
          style={{ color: drawerOpen ? "#FFD600" : "rgba(255,255,255,0.45)" }}
        >
          <svg className="h-[22px] w-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
          <span className="text-[10px] leading-none" style={{ fontWeight: drawerOpen ? 700 : 500 }}>
            Ще
          </span>
        </button>
      </div>
    </nav>
  );
}
