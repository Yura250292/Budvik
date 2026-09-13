"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Banknote, ChevronRight, FileCheck, MapPin, PackageCheck, PackagePlus, PhoneCall, Route, Truck, Undo2 } from "lucide-react";
import { REP_FEED_TYPES } from "@/lib/rep-feed/types";

/**
 * Рядки стрічки подій — спільні для блоку «Сьогодні» на головній
 * торгового, сторінки /sales/feed і адмінської /admin/feed.
 *
 * Одна реалізація свідомо: іконка, колір і формат часу мусять бути
 * однаковими всюди, інакше торговий і керівник, дивлячись на ту саму
 * оплату, бачили б різні картинки.
 */

export type FeedRowData = {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  relatedId?: string | null;
  createdAt: string;
  rep?: { id: string; name: string } | null;
};

export const FEED_ICONS: Record<string, typeof Banknote> = {
  [REP_FEED_TYPES.PAYMENT]: Banknote,
  [REP_FEED_TYPES.DOC_POSTED]: FileCheck,
  [REP_FEED_TYPES.DOC_PICKED]: PackageCheck,
  [REP_FEED_TYPES.RETURN]: Undo2,
  [REP_FEED_TYPES.DOC_DELIVERED]: Truck,
  [REP_FEED_TYPES.VISIT]: MapPin,
  [REP_FEED_TYPES.CALL_LIST]: PhoneCall,
  [REP_FEED_TYPES.ARRIVAL]: PackagePlus,
  [REP_FEED_TYPES.ROUTE]: Route,
};

/** Оплата — зелена, повернення — червоне, підказки й прихід — жовті, документи — нейтральні. */
export function feedTone(type: string): string {
  if (type === REP_FEED_TYPES.PAYMENT) return "text-ok";
  if (type === REP_FEED_TYPES.RETURN) return "text-bad";
  if (type === REP_FEED_TYPES.VISIT || type === REP_FEED_TYPES.CALL_LIST || type === REP_FEED_TYPES.ARRIVAL) {
    return "text-[#B8860B]";
  }
  return "text-cab-t2";
}

/** Київська дата рядка «YYYY-MM-DD». */
export function kyivDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Kyiv" });
}

export function kyivClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** «Сьогодні», «Вчора», «пт, 11 вересня». */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Сьогодні";
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (day === y.toISOString().slice(0, 10)) return "Вчора";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("uk-UA", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "long",
  });
}

export function groupByDay<T extends FeedRowData>(rows: T[]): { day: string; label: string; rows: T[] }[] {
  const today = kyivDay(new Date().toISOString());
  const groups: { day: string; label: string; rows: T[] }[] = [];
  for (const row of rows) {
    const day = kyivDay(row.createdAt);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.rows.push(row);
    else groups.push({ day, label: dayLabel(day, today), rows: [row] });
  }
  return groups;
}

/**
 * Один рядок. `rep` — ім'я торгового для адмінки: картка візиту («Ви у
 * Химича») тоді читається як «Кулик Дмитро у Химича», решта — з іменем
 * дрібно над заголовком.
 */
export function FeedRow({
  row,
  href,
  rep,
  highlightUnread = true,
}: {
  row: FeedRowData;
  href: string | null;
  rep?: string | null;
  highlightUnread?: boolean;
}) {
  const Icon = FEED_ICONS[row.type] ?? FileCheck;
  const visit = row.title.startsWith("Ви у ");
  const title = rep && visit ? `${rep} у ${row.title.slice("Ви у ".length)}` : row.title;

  const inner = (
    <>
      <Icon size={20} className={`mt-0.5 shrink-0 ${feedTone(row.type)}`} />
      <span className="min-w-0 flex-1">
        {rep && !visit && <span className="block truncate text-[11px] font-medium text-cab-t3">{rep}</span>}
        <span className="block truncate text-[14px] font-semibold text-bk">{title}</span>
        <span className="line-clamp-2 block text-xs text-cab-t2">{row.body}</span>
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-cab-t3">{kyivClock(row.createdAt)}</span>
      {href && <ChevronRight size={16} className="shrink-0 self-center text-cab-t3" />}
    </>
  );
  const cls = `flex items-start gap-3 px-4 py-2.5 sm:px-5 ${highlightUnread && !row.isRead ? "bg-[#FFF9E6]" : ""}`;
  return href ? (
    <Link href={href} className={`${cls} active:opacity-80`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

type PageResponse<T> = { rows: T[]; nextCursor: string | null } & Record<string, unknown>;

/**
 * Сторінки стрічки з курсором. Зміна `url` (фільтр, торговий) скидає
 * список. `extra` — решта полів першої сторінки (у адмінки — перелік
 * торгових для фільтра).
 */
export function useFeedPages<T extends FeedRowData = FeedRowData>(url: string) {
  const [state, setState] = useState<{
    url: string;
    rows: T[];
    cursor: string | null;
    loading: boolean;
    error: string | null;
    extra: Record<string, unknown>;
  }>({ url, rows: [], cursor: null, loading: true, error: null, extra: {} });
  /** Лічильник «перечитати»: зміна перезапускає завантаження першої сторінки. */
  const [nonce, setNonce] = useState(0);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetch(cursor ? `${url}${sep}cursor=${encodeURIComponent(cursor)}` : url);
      const data = (await res.json().catch(() => ({}))) as PageResponse<T> & { error?: string };
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      return data;
    },
    [url]
  );

  useEffect(() => {
    let alive = true;
    fetchPage(null)
      .then((data) => {
        if (!alive) return;
        const { rows, nextCursor, ...extra } = data;
        setState({ url, rows, cursor: nextCursor, loading: false, error: null, extra });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState((s) => ({ ...s, url, rows: [], cursor: null, loading: false, error: e instanceof Error ? e.message : "Не вдалося завантажити" }));
      });
    return () => {
      alive = false;
    };
  }, [fetchPage, url, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const loadMore = useCallback(async () => {
    if (!state.cursor || state.loading) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fetchPage(state.cursor);
      setState((s) => ({ ...s, rows: [...s.rows, ...data.rows], cursor: data.nextCursor, loading: false }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Не вдалося завантажити" }));
    }
  }, [fetchPage, state.cursor, state.loading]);

  // Поки перша сторінка нового url не приїхала, старі рядки не показуємо.
  // `extra` лишаємо попередній: перелік торгових у фільтрі не має блимати.
  const fresh = state.url === url;
  return {
    rows: fresh ? state.rows : [],
    loading: fresh ? state.loading : true,
    error: fresh ? state.error : null,
    hasMore: fresh && !!state.cursor,
    extra: state.extra,
    loadMore,
    reload,
  };
}
