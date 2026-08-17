"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminIcon } from "./icons";
import { NAV_GROUPS, TOP_ITEMS, type AdminRole, type NavItem } from "@/lib/admin-nav";

const COLLAPSED_GROUPS_KEY = "budvik:admin:sidebar:collapsed-groups:v1";

/**
 * Активний пункт — ОДИН, з найдовшим збігом префікса. Перевірка кожного
 * пункту окремо підсвічувала два розділи одразу, бо шляхи бувають
 * вкладені: «Закупівлі» (/admin/procurement) і «Оборотність складу»
 * (/admin/procurement/turnover) збігаються обидва.
 */
function activeHrefOf(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const hit = href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/");
    if (hit && (!best || href.length > best.length)) best = href;
  }
  return best;
}

function NavLink({
  item,
  active,
  railCollapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  railCollapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={railCollapsed ? item.title : undefined}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center gap-3 rounded-[var(--radius-btn)] px-2.5 py-2 text-[13px] font-medium transition-colors ${
        active ? "bg-white/10 text-primary" : "text-white/65 hover:bg-white/5 hover:text-white"
      }`}
    >
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-primary" aria-hidden="true" />}
      <span className="flex-shrink-0 [&>svg]:w-[18px] [&>svg]:h-[18px]">
        <AdminIcon name={item.iconKey} />
      </span>
      {!railCollapsed && <span className="truncate">{item.title}</span>}
    </Link>
  );
}

export default function SidebarNav({
  role,
  railCollapsed = false,
  onNavigate,
}: {
  role: AdminRole;
  railCollapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "/admin";
  // SSR рендерить усі групи розгорнутими; збережений стан підтягуємо
  // після монтування, інакше отримали б розбіжність гідратації.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
      if (raw) {
        setCollapsedGroups(new Set(JSON.parse(raw) as string[]));
      } else {
        setCollapsedGroups(new Set(NAV_GROUPS.filter((g) => g.collapsedByDefault).map((g) => g.id)));
      }
    } catch {
      /* зіпсований запис — лишаємо все розгорнутим */
    }
  }, []);

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...next]));
      } catch {
        /* приватний режим — просто не зберігаємо */
      }
      return next;
    });
  };

  const topItems = TOP_ITEMS.filter((i) => i.roles.includes(role));
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)) })).filter(
    (g) => g.items.length > 0
  );
  const activeHref = activeHrefOf(
    pathname,
    [...topItems, ...groups.flatMap((g) => g.items)].map((i) => i.href)
  );

  return (
    <nav className="flex flex-col gap-1 px-2 py-3" aria-label="Розділи адмінки">
      {topItems.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          active={item.href === activeHref}
          railCollapsed={railCollapsed}
          onNavigate={onNavigate}
        />
      ))}

      {groups.map((group) => {
        const hasActiveChild = group.items.some((i) => i.href === activeHref);
        // Згорнута група з активним маршрутом все одно відкрита —
        // інакше користувач не бачить, де він знаходиться.
        const open = !collapsedGroups.has(group.id) || hasActiveChild;

        if (railCollapsed) {
          return (
            <div key={group.id} className="mt-2 border-t border-white/10 pt-2">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={item.href === activeHref}
                  railCollapsed
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          );
        }

        return (
          <div key={group.id} className="mt-2">
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              aria-expanded={open}
              className="flex w-full items-center justify-between rounded-[var(--radius-btn)] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40 transition-colors hover:text-white/70"
            >
              <span className="truncate">{group.title}</span>
              <svg
                className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-150 ${open ? "" : "-rotate-90"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {open && (
              <div className="mt-0.5 flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={item.href === activeHref}
                    railCollapsed={false}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
