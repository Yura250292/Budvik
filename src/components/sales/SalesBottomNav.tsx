"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Нижня навігація кабінету торгового: чотири рівні вкладки.
 *
 * Центральної кнопки «Продаж» більше немає. Торгові поки не оформлюють
 * замовлення через застосунок, тож найпомітніший елемент екрана вів у
 * функцію, якою не користуються. Сторінка /sales/new лишилась на місці —
 * прибрано лише входи, тож повернути її можна одним комітом.
 *
 * «Комісії» (/dashboard/commissions) свого часу замінило «Показники»:
 * там стара ERP-схема, де комісія нараховується при підтвердженні
 * замовлення — ще до відвантаження і до будь-якої оплати. Тримати дві
 * різні суми заробітку поруч у меню означало б гарантоване питання «а
 * чому не сходиться». Тепер «Заробіток» веде в /sales/analytics/money,
 * де сума рахується зі зібраних коштів.
 */
const tabs = [
  {
    href: "/sales",
    label: "Головна",
    icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
    exact: true,
  },
  {
    href: "/sales/clients",
    label: "Клієнти",
    icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  },
  {
    // Поруч із клієнтами, бо це той самий портфель, тільки на місцевості:
    // видно, хто мовчить і чи він по дорозі сьогоднішнім маршрутом.
    href: "/sales/map",
    label: "Карта",
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
  },
  {
    href: "/sales/orders",
    label: "Документи",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    href: "/sales/analytics/money",
    label: "Заробіток",
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
    <nav
      className="safe-area-bottom fixed bottom-0 left-0 right-0 z-50"
      style={{
        background: "linear-gradient(to right, #0A0A0A, #141414, #1A1A1A)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
      }}
    >
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-1">
        {tabs.map((tab) => {
          const active = isActive(tab.href, tab.exact);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              // min-h-12: ціль дотику 48px. Раніше py-2 давало ~40px —
              // у машині в це не потрапляли без прицілювання.
              className="flex min-h-12 min-w-[64px] flex-col items-center justify-center gap-0.5 rounded-xl px-1"
            >
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={active ? 2 : 1.5}
                style={{ color: active ? "#FFD600" : "rgba(255,255,255,0.4)" }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
              </svg>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: active ? 600 : 500,
                  color: active ? "#FFD600" : "rgba(255,255,255,0.4)",
                }}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
