"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Нижня навігація кабінету водія: чотири розділи, і тільки вони.
 *
 * До цього водій користувався меню вітрини — «Каталог», «Кошик»,
 * «Болти» — і потрапляв у кабінет покупця, де його підписували як
 * «Клієнт». Тут лише те, що потрібно на маршруті.
 *
 * Меню є на ВСІХ екранах водія, включно з картою дня. Спершу на
 * /driver/tablet його ховали заради висоти карти, а вихід дали кнопкою в
 * шапці — але водій на планшеті шукає перехід унизу, там, де він на решті
 * екранів, і кнопку в кутку просто не помічав. Сталі 4rem зрозуміліші за
 * виграні пікселі.
 */
const tabs = [
  {
    href: "/driver",
    label: "Сьогодні",
    // Вантажівка
    icon: "M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12",
    exact: true,
  },
  {
    href: "/driver/map",
    label: "Клієнти",
    // Складена мапа
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
  },
  {
    href: "/driver/history",
    label: "Історія",
    // Годинник зі стрілкою назад
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    href: "/driver/profile",
    label: "Акаунт",
    // Людина
    icon: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z",
  },
];

export default function DriverBottomNav() {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

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
              // min-h-12: ціль дотику 48px — у машині в менше не влучають
              className="flex min-h-12 min-w-[64px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl px-1"
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
