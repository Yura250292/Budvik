"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Banknote, ChevronRight, FileCheck, MapPin, PackageCheck, PhoneCall, Truck, Undo2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { money } from "@/components/ui/Stat";
import { feedHref, isRepFeedType, REP_FEED_PREFIX, REP_FEED_TYPES } from "@/lib/rep-feed/types";
import type { RepToday } from "@/lib/rep-feed/today";

/**
 * «Сьогодні» — стрічка подій дня на головній торгового.
 *
 * Те, заради чого торговий отримав пуш удень: оплата від клієнта, проведена
 * чи зібрана накладна, повернення. Пуш веде на конкретний документ або
 * картку, а тут — усе разом за день, щоб було куди зайти й без пуша.
 *
 * Рядки — ті самі Notification, що й у дзвіночку в шапці: один запит на
 * обидва (useNotifications), інакше сторінка ходила б по список двічі.
 * Показуємо лише типи стрічки (префікс REP_) за київське сьогодні.
 *
 * Над рядками — цифри дня з /api/sales/today: замовлення (чернетки окремо,
 * бо офіс проводить їх годинами пізніше) і зібрані гроші. Це те, заради
 * чого власник просив геймефікацію: табло приходить лише ввечері, а тут
 * рахунок видно посеред дня.
 */

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  relatedId?: string | null;
};

export function useNotifications() {
  const [items, setItems] = useState<NotificationRow[]>([]);

  useEffect(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const markAllRead = useCallback(async () => {
    await fetch("/api/notifications/read-all", { method: "PATCH" }).catch(() => {});
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }, []);

  const unreadCount = items.filter((n) => !n.isRead).length;
  return { items, unreadCount, markAllRead };
}

const ICONS: Record<string, typeof Banknote> = {
  [REP_FEED_TYPES.PAYMENT]: Banknote,
  [REP_FEED_TYPES.DOC_POSTED]: FileCheck,
  [REP_FEED_TYPES.DOC_PICKED]: PackageCheck,
  [REP_FEED_TYPES.RETURN]: Undo2,
  [REP_FEED_TYPES.DOC_DELIVERED]: Truck,
  [REP_FEED_TYPES.VISIT]: MapPin,
  [REP_FEED_TYPES.CALL_LIST]: PhoneCall,
};

/** Оплата — зелена, повернення — червоне, підказки — жовті, документи — нейтральні. */
function tone(type: string): string {
  if (type === REP_FEED_TYPES.PAYMENT) return "text-ok";
  if (type === REP_FEED_TYPES.RETURN) return "text-bad";
  if (type === REP_FEED_TYPES.VISIT || type === REP_FEED_TYPES.CALL_LIST) return "text-[#B8860B]";
  return "text-cab-t2";
}

/** Цифри дня; null — ще не завантажились або впали (тоді просто без них). */
export function useToday(): RepToday | null {
  const [today, setToday] = useState<RepToday | null>(null);
  useEffect(() => {
    fetch("/api/sales/today")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setToday(d))
      .catch(() => {});
  }, []);
  return today;
}

function TodayNumbers({ today }: { today: RepToday }) {
  const { orders } = today;
  const parts: string[] = [];
  const n = orders.count + orders.draftCount;
  if (n > 0) {
    const word = n % 10 === 1 && n % 100 !== 11 ? "замовлення" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "замовлення" : "замовлень";
    const drafts = orders.draftCount > 0 ? ` (${orders.draftCount} у чернетках)` : "";
    parts.push(`${n} ${word} на ${money(orders.totalUah + orders.draftUah)} ₴${drafts}`);
  }
  if (today.collectedCount > 0) parts.push(`зібрано ${money(today.collectedUah)} ₴`);
  if (parts.length === 0) return null;
  return <p className="px-4 pb-2 text-[13px] text-cab-t2 sm:px-5">{parts.join(" · ")}</p>;
}

const MAX_ROWS = 8;

/** Київська дата рядка — порівнюємо з київським сьогодні, а не з UTC. */
function kyivDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Kyiv" });
}

function kyivClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TodayFeed({ items, today }: { items: NotificationRow[]; today: RepToday | null }) {
  const day = kyivDay(new Date().toISOString());
  const rows = items.filter(
    (n) => n.type.startsWith(REP_FEED_PREFIX) && isRepFeedType(n.type) && kyivDay(n.createdAt) === day
  );
  const hasNumbers =
    !!today && (today.orders.count + today.orders.draftCount > 0 || today.collectedCount > 0);
  if (rows.length === 0 && !hasNumbers) return null;

  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;

  return (
    <Card padded={false}>
      <div className="flex items-baseline justify-between px-4 pt-3.5 pb-1 sm:px-5">
        <h2 className="text-sm font-semibold text-bk">Сьогодні</h2>
        {rows.length > 0 && <span className="text-xs text-cab-t3">{rows.length}</span>}
      </div>
      {today && <TodayNumbers today={today} />}
      <ul className="divide-y divide-cab-line">
        {shown.map((n) => {
          const Icon = ICONS[n.type] ?? FileCheck;
          const href = feedHref(n.type, n.relatedId);
          const inner = (
            <>
              <Icon size={20} className={`mt-0.5 shrink-0 ${tone(n.type)}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-bk">{n.title}</span>
                <span className="block truncate text-xs text-cab-t2">{n.body}</span>
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-cab-t3">{kyivClock(n.createdAt)}</span>
              {href && <ChevronRight size={16} className="shrink-0 text-cab-t3" />}
            </>
          );
          const cls = `flex items-start gap-3 px-4 py-2.5 sm:px-5 ${n.isRead ? "" : "bg-[#FFF9E6]"}`;
          return (
            <li key={n.id}>
              {href ? (
                <Link href={href} className={`${cls} active:opacity-80`}>
                  {inner}
                </Link>
              ) : (
                <div className={cls}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <p className="px-4 pb-3 pt-1.5 text-[11px] text-cab-t3 sm:px-5">і ще {hidden} — у дзвіночку вгорі</p>
      )}
    </Card>
  );
}
