"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ALL_NAV_ITEMS, type AdminRole } from "@/lib/admin-nav";
import { AdminIcon } from "../../icons";
import { WidgetBody } from "./parts";

/**
 * Швидкі дії й пошук по розділах.
 *
 * Джерело пунктів — той самий ALL_NAV_ITEMS, що й сайдбар: інакше при
 * появі нового розділу довелося б пам'ятати про два місця, і плитка
 * тихо відставала б від меню. Ролі теж беруться звідти.
 */

/** Найчастіші переходи винесені кнопками — решта доступна через пошук. */
const PINNED: Array<{ href: string; label: string; roles: AdminRole[] }> = [
  { href: "/admin/erp/sales", label: "Продаж", roles: ["ADMIN", "MANAGER", "SALES"] },
  { href: "/admin/erp/counterparties", label: "Контрагенти", roles: ["ADMIN", "MANAGER", "SALES"] },
  { href: "/admin/orders", label: "Замовлення", roles: ["ADMIN", "MANAGER", "SALES"] },
  { href: "/admin/erp/scan", label: "AI Сканер", roles: ["ADMIN", "MANAGER", "SALES"] },
  { href: "/admin/products", label: "Товари", roles: ["ADMIN", "MANAGER"] },
  { href: "/admin/sales-analytics", label: "Аналітика", roles: ["ADMIN", "MANAGER", "SALES"] },
];

/** Пошук без урахування регістру й розкладки заголовків. */
const norm = (s: string) => s.toLowerCase().trim();

export function QuickActions({ role }: { role: AdminRole }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const available = useMemo(() => ALL_NAV_ITEMS.filter((i) => i.roles.includes(role) && i.href !== "/admin"), [role]);
  const pinned = useMemo(() => PINNED.filter((p) => p.roles.includes(role)), [role]);

  const matches = useMemo(() => {
    const q = norm(query);
    if (!q) return [];
    return available.filter((i) => norm(i.title).includes(q) || (i.desc && norm(i.desc).includes(q))).slice(0, 6);
  }, [query, available]);

  // Enter відкриває перший збіг: пошук має працювати без миші.
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (matches[0]) {
      router.push(matches[0].href);
      setQuery("");
      inputRef.current?.blur();
    }
  };

  return (
    <WidgetBody title="Швидкі дії" hint="Пошук по розділах адмінки">
      <div className="flex h-full flex-col">
        <form onSubmit={onSubmit} className="mb-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Знайти розділ…"
            className="w-full rounded-lg border border-g200 px-2.5 py-1.5 text-[13px] text-bk outline-none placeholder:text-g300 focus:border-g400"
          />
        </form>

        {query ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {matches.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-g400">Нічого не знайдено</p>
            ) : (
              matches.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  onClick={() => setQuery("")}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-g50"
                >
                  <AdminIcon name={i.iconKey} className="h-4 w-4 flex-shrink-0 text-g400" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-bk">{i.title}</span>
                    {i.desc && <span className="block truncate text-[11px] text-g400">{i.desc}</span>}
                  </span>
                </Link>
              ))
            )}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-1.5">
            {pinned.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className="truncate rounded-lg border border-g200 px-2.5 py-2 text-center text-[12px] font-medium text-bk transition-colors hover:bg-g50"
              >
                {p.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </WidgetBody>
  );
}
