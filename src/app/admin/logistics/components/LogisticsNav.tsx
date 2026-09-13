"use client";

/**
 * Смужка підрозділів «Логістики».
 *
 * Пункти беруться з групи `logistics` у admin-nav — того самого джерела, що й
 * сайдбар, тож назви в меню і на сторінці не розійдуться.
 *
 * Посилання несуть поточний період (?from=&to=): «Зміни за серпень» →
 * «Паливо» мають відкрити паливо за серпень, а не за поточний місяць.
 * Сторінки, яким період не потрібен, його просто не читають.
 */

import { Fragment } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NAV_GROUPS } from "@/lib/admin-nav";

const ITEMS = NAV_GROUPS.find((g) => g.id === "logistics")?.items ?? [];

/**
 * Перед цим пунктом — риска: далі службове (стан планшетів, архів бота),
 * а не щоденна робота логіста.
 */
const DIVIDER_BEFORE = "/admin/logistics/devices";

export function LogisticsNav() {
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const from = params.get("from");
  const to = params.get("to");
  const carry = from && to ? `?from=${from}&to=${to}` : "";

  return (
    <nav
      className="-mx-4 flex gap-5 overflow-x-auto border-b border-g200 px-4 sm:mx-0 sm:px-0"
      aria-label="Підрозділи логістики"
    >
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Fragment key={item.href}>
            {item.href === DIVIDER_BEFORE && (
              <span aria-hidden className="ml-1 h-4 shrink-0 self-center border-l border-g200" />
            )}
            <Link
              href={`${item.href}${carry}`}
              aria-current={active ? "page" : undefined}
              title={item.desc}
              className={`-mb-px shrink-0 cursor-pointer whitespace-nowrap border-b-2 px-0.5 pb-2.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark ${
                active
                  ? "border-bk font-semibold text-bk"
                  : "border-transparent font-medium text-g500 hover:text-bk"
              }`}
            >
              {item.title}
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}
