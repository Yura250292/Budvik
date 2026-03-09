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
  {
    href: "/dashboard/commissions",
    label: "Комісії",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
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
