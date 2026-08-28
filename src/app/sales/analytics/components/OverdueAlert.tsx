"use client";

import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { money, num } from "@/components/ui/Stat";
import { BUCKET_LABELS } from "@/lib/erp/receivables";
import type { SummaryRow } from "./useSalesAnalytics";

/**
 * Прострочена дебіторка — червона смуга одразу під планом.
 *
 * Досі це число жило плиткою в самому низу головної, поруч із «середнім
 * чеком». Але прострочка — не показник, а борг, який щодня дорожчає: чим
 * старший, тим менша ймовірність його зібрати. Її місце — там, де на неї
 * дивляться до того, як почали планувати день.
 *
 * Поруч із сумою — вік найстарішої частини. Без нього 45 300 ₴ читається
 * однаково і коли це вчорашня відвантажена партія, і коли це борг, який
 * висить пів року.
 */
export function OverdueAlert({ row, href }: { row: SummaryRow; href: string }) {
  if (row.receivables.overdue <= 0) return null;

  /** Найстарший непорожній кошик: список іде від свіжого до старого. */
  const oldest = (["OVERDUE_90_PLUS", "OVERDUE_90", "OVERDUE_60", "OVERDUE_30"] as const).find(
    (b) => (row.receivables.buckets?.[b] ?? 0) > 0
  );

  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-2xl border border-bad-line bg-bad-bg px-3.5 py-3 active:opacity-80"
    >
      <AlertTriangle size={24} className="shrink-0 text-bad" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-bad-fg">
          Прострочено {money(row.receivables.overdue)} ₴
        </span>
        <span className="block text-xs text-cab-t2">
          {num(row.receivables.overdueRatio)}% дебіторки
          {oldest ? ` · найстарша частина: ${BUCKET_LABELS[oldest].toLowerCase()}` : ""}
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-bad" />
    </Link>
  );
}
