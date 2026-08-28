"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Нижня навігація кабінету — плаваюча чорна капсула з макета.
 *
 * Не смуга на всю ширину, як було: капсула відривається від списку, який під
 * нею прокручується, і на планшеті в машині видно, що список триває далі, а
 * не обрізаний. Висота цілі дотику лишилася 52 px — у машині в менше не
 * влучають.
 *
 * Спільна для торгового й водія: два різні компоненти давали б два різні
 * відступи вже після першої правки.
 */

export type TabDef = {
  href?: string;
  label: string;
  icon: ReactNode;
  /** Активною вважається лише точна адреса (головна секції). */
  exact?: boolean;
  /** Кнопка без адреси — гукає застосунок через міст. */
  onClick?: () => void;
  /** Крапка в кутку: зміна відкрита, є непрочитане. */
  live?: boolean;
};

/** Висота панелі з полем — стільки місця екран мусить лишити під собою. */
export const TAB_BAR_SPACE = "calc(80px + env(safe-area-inset-bottom, 0px))";

export function TabBar({ tabs, wide = false }: { tabs: TabDef[]; wide?: boolean }) {
  const pathname = usePathname();
  const isActive = (t: TabDef) =>
    !!t.href && (t.exact ? pathname === t.href : pathname.startsWith(t.href));

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 px-3 pt-1"
      style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))" }}
    >
      <div
        className="mx-auto flex max-w-lg items-center justify-around rounded-[32px] bg-bk p-1.5"
        style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}
      >
        {tabs.map((t) => {
          const active = isActive(t);
          const cls = `relative flex ${wide ? "w-[72px]" : "w-[58px]"} h-[52px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-2`;
          const style = active ? { background: "rgba(255,214,0,0.12)" } : undefined;
          const color = active ? "#FFD600" : "rgba(255,255,255,0.5)";

          const inner = (
            <>
              <span style={{ color }}>{t.icon}</span>
              <span
                className="text-[10px]"
                style={{ color, fontWeight: active ? 600 : 500 }}
              >
                {t.label}
              </span>
              {t.live && (
                <span
                  aria-hidden
                  className="absolute right-2.5 top-1.5 h-2 w-2 rounded-full bg-primary"
                />
              )}
            </>
          );

          if (!t.href) {
            return (
              <button key={t.label} type="button" onClick={t.onClick} aria-label={t.label} className={cls} style={style}>
                {inner}
              </button>
            );
          }
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cls}
              style={style}
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
