"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { readShiftState, useIsNativeApp } from "@/lib/useIsNativeApp";

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
 * чому не сходиться». Заробіток рахується зі зібраних коштів і живе в
 * /sales/analytics/money.
 *
 * П'ять вкладок — стеля для телефона, шоста ріже цілі дотику. Тому місце
 * «Заробітку» зайняв каталог: заробіток дивляться раз на день і з головної
 * (плитка в MetricGrid), а каталог відкривають у кожному візиті — він
 * заміняє вісім паперових каталогів, які торговий возить у машині.
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
    href: "/sales/catalog",
    label: "Каталог",
    icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  },
];

/** Спідометр — вхід у нативний екран зміни. */
const SHIFT_ICON =
  "M12 3a9 9 0 100 18 9 9 0 000-18zm0 0v3m6.364.636l-2.121 2.121M21 12h-3M12 12l4.5-4.5";

export default function SalesBottomNav() {
  const pathname = usePathname();
  const isApp = useIsNativeApp();
  const [shiftOpen, setShiftOpen] = useState(false);

  /**
   * Стан зміни перечитуємо при кожній навігації: торговий міг щойно
   * відкрити зміну на нативному екрані й повернутись у кабінет.
   */
  useEffect(() => {
    if (!isApp) return;
    setShiftOpen(readShiftState()?.open ?? false);
  }, [isApp, pathname]);

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
          const minW = isApp ? "min-w-[56px]" : "min-w-[64px]";
          const active = isActive(tab.href, tab.exact);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              // min-h-12: ціль дотику 48px. Раніше py-2 давало ~40px —
              // у машині в це не потрапляли без прицілювання.
              className={`flex min-h-12 ${minW} flex-col items-center justify-center gap-0.5 rounded-xl px-1`}
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

        {/*
          Шоста вкладка живе тільки в застосунку. Стеля з п'яти вкладок
          писалась для телефона у звичайному браузері; тут інший випадок —
          без цієї кнопки нативний екран зміни не має входу взагалі, бо
          іншої навігації в застосунку немає. Цілі дотику лишаються 48px,
          звужується лише горизонтальний запас (56px замість 64px).

          Це кнопка, а не Link: вона нікуди не веде в межах сайту, а
          гукає натив через міст. Активною не буває — нативний екран
          відкривається поверх, і кабінет лишається на тій самій сторінці.
        */}
        {isApp && (
          <button
            type="button"
            onClick={() => window.BudvikApp?.openShift()}
            aria-label="Зміна"
            className="relative flex min-h-12 min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-xl px-1"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              style={{ color: "rgba(255,255,255,0.4)" }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={SHIFT_ICON} />
            </svg>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 500,
                color: "rgba(255,255,255,0.4)",
              }}
            >
              Зміна
            </span>
            {/* Крапка, поки зміна відкрита: єдиний спосіб побачити з
                кабінету, що трек пишеться. */}
            {shiftOpen && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 6,
                  right: 12,
                  width: 8,
                  height: 8,
                  borderRadius: 9999,
                  background: "#FFD600",
                }}
              />
            )}
          </button>
        )}
      </div>
    </nav>
  );
}
