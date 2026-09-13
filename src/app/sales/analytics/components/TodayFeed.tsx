"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { money } from "@/components/ui/Stat";
import { FeedRow, kyivDay } from "@/components/feed/FeedList";
import { feedHref, isRepFeedType, REP_FEED_PREFIX } from "@/lib/rep-feed/types";
import type { RepToday } from "@/lib/rep-feed/today";

/**
 * «Сьогодні» — стрічка подій дня на головній торгового.
 *
 * Те, заради чого торговий отримав пуш удень: оплата від клієнта, проведена
 * чи зібрана накладна, повернення, картка візиту, список дзвінків. Пуш веде
 * на конкретний документ або картку, а тут — усе разом за день. Повна
 * історія з фільтрами — окрема сторінка /sales/feed.
 *
 * Рядки — ті самі Notification, що й у дзвіночку в шапці: один запит на
 * обидва (useNotifications), інакше сторінка ходила б по список двічі.
 *
 * Над рядками — цифри дня з /api/sales/today: замовлення (чернетки окремо,
 * бо офіс проводить їх годинами пізніше) і зібрані гроші.
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

function ordersWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "замовлення";
  if (m10 === 1 && m100 !== 11) return "замовлення";
  return "замовлень";
}

export function hasTodayNumbers(today: RepToday | null): boolean {
  return !!today && (today.orders.count + today.orders.draftCount > 0 || today.collectedCount > 0);
}

export function TodayNumbers({ today }: { today: RepToday }) {
  const { orders } = today;
  const parts: string[] = [];
  const n = orders.count + orders.draftCount;
  if (n > 0) {
    const drafts = orders.draftCount > 0 ? ` (${orders.draftCount} у чернетках)` : "";
    parts.push(`${n} ${ordersWord(n)} на ${money(orders.totalUah + orders.draftUah)} ₴${drafts}`);
  }
  if (today.collectedCount > 0) parts.push(`зібрано ${money(today.collectedUah)} ₴`);
  if (parts.length === 0) return null;
  return <p className="px-4 pb-2 text-[13px] text-cab-t2 sm:px-5">{parts.join(" · ")}</p>;
}

const MAX_ROWS = 8;

export function TodayFeed({ items, today }: { items: NotificationRow[]; today: RepToday | null }) {
  const day = kyivDay(new Date().toISOString());
  const rows = items.filter(
    (n) => n.type.startsWith(REP_FEED_PREFIX) && isRepFeedType(n.type) && kyivDay(n.createdAt) === day
  );
  if (rows.length === 0 && !hasTodayNumbers(today)) return null;

  const shown = rows.slice(0, MAX_ROWS);

  return (
    <Card padded={false}>
      <div className="flex items-baseline justify-between px-4 pt-3.5 pb-1 sm:px-5">
        <h2 className="text-sm font-semibold text-bk">Сьогодні</h2>
        <Link href="/sales/feed" className="text-xs font-semibold text-cab-t2 active:opacity-70">
          Уся стрічка{rows.length > 0 ? ` · ${rows.length}` : ""} →
        </Link>
      </div>
      {today && <TodayNumbers today={today} />}
      {shown.length > 0 && (
        <ul className="divide-y divide-cab-line">
          {shown.map((n) => (
            <li key={n.id}>
              <FeedRow row={n} href={feedHref(n.type, n.relatedId)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
