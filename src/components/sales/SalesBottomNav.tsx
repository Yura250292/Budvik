"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  {
    href: "/sales",
    label: "Головна",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    exact: true,
  },
  {
    href: "/sales/clients",
    label: "Клієнти",
    icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  },
  {
    href: "/sales/new",
    label: "Продаж",
    icon: "M12 4v16m8-8H4",
    accent: true,
  },
  {
    href: "/sales/orders",
    label: "Документи",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  // Замінило «Комісії» (/dashboard/commissions): там стара ERP-схема, де
  // комісія нараховується при підтвердженні замовлення — ще до відвантаження
  // і до будь-якої оплати. Тримати дві різні суми заробітку поруч у меню
  // означало б гарантоване питання «а чому не сходиться». Старий звіт
  // лишився посиланням на /sales/analytics/money.
  {
    href: "/sales/analytics",
    label: "Показники",
    icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  },
];

export default function SalesBottomNav() {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 safe-area-bottom" style={{
      background: "linear-gradient(to right, #0A0A0A, #141414, #1A1A1A)",
      borderTop: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
    }}>
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">
        {tabs.map((tab) => {
          const active = isActive(tab.href, tab.exact);

          if (tab.accent) {
            return (
              <Link key={tab.href} href={tab.href} className="flex flex-col items-center gap-0.5 -mt-5">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{
                  background: "linear-gradient(135deg, #FFD600 0%, #FFA000 100%)",
                  boxShadow: "0 4px 16px rgba(255,214,0,0.4)",
                }}>
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                  </svg>
                </div>
                <span style={{ fontSize: "10px", fontWeight: 600, color: "#FFD600", marginTop: "2px" }}>{tab.label}</span>
              </Link>
            );
          }

          return (
            <Link key={tab.href} href={tab.href} className="flex flex-col items-center gap-0.5 min-w-[56px] py-2">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2 : 1.5}
                style={{ color: active ? "#FFD600" : "rgba(255,255,255,0.4)" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
              </svg>
              <span style={{
                fontSize: "10px",
                fontWeight: active ? 600 : 500,
                color: active ? "#FFD600" : "rgba(255,255,255,0.4)",
              }}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
