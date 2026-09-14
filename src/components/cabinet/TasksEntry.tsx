"use client";

import Link from "next/link";
import useSWR from "swr";
import type { TaskRow } from "@/lib/meetings/types";

/**
 * Вхід у «Задачі від офісу» з головної кабінету — з лічильником відкритих.
 *
 * Спільний для торгового, водія й складу. Нижні панелі зайняті (п'ять слотів),
 * тож задачі живуть посиланням на хабі; пуш про нову задачу веде прямо на
 * сторінку.
 */

const fetcher = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" });
  return r.ok ? ((await r.json()) as { open: TaskRow[] }) : null;
};

export default function TasksEntry({ href }: { href: string }) {
  const { data } = useSWR("/api/tasks", fetcher, { dedupingInterval: 30_000 });
  const open = data?.open ?? [];
  const overdue = open.some((t) => t.overdue);

  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-2xl border border-cab-line bg-white px-3.5 py-3 text-[14px] font-semibold text-bk active:opacity-80"
    >
      <span>Задачі від офісу</span>
      <span className="flex items-center gap-2">
        {open.length > 0 && (
          <span
            className={`min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-bold ${
              overdue ? "bg-bad-bg text-bad-fg" : "bg-warn-bg text-warn-fg"
            }`}
          >
            {open.length}
          </span>
        )}
        <span className="text-cab-t3">→</span>
      </span>
    </Link>
  );
}
