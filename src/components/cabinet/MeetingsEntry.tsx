"use client";

import Link from "next/link";
import useSWR from "swr";
import type { SharedMeetingRow } from "@/lib/meetings/types";

/**
 * Вхід у «Підсумки нарад» — поруч із «Задачами від офісу», з лічильником нових.
 *
 * Поки керівник нічого не надсилав, входу немає: порожній розділ на хабі
 * водія чи складу лише забирав би місце. Пуш про нараду веде прямо на неї.
 */

const fetcher = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" });
  return r.ok ? ((await r.json()) as { items: SharedMeetingRow[] }) : null;
};

export default function MeetingsEntry({ href }: { href: string }) {
  const { data } = useSWR("/api/meetings", fetcher, { dedupingInterval: 30_000 });
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  const fresh = items.filter((m) => m.isNew).length;

  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-2xl border border-cab-line bg-white px-3.5 py-3 text-[14px] font-semibold text-bk active:opacity-80"
    >
      <span>Підсумки нарад</span>
      <span className="flex items-center gap-2">
        {fresh > 0 && (
          <span className="min-w-6 rounded-full bg-info-bg px-2 py-0.5 text-center text-xs font-bold text-info-fg">
            {fresh}
          </span>
        )}
        <span className="text-cab-t3">→</span>
      </span>
    </Link>
  );
}
