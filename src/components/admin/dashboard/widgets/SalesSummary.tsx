"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { money } from "@/components/ui/Stat";

type Totals = {
  revenue: number;
  docs: number;
  clients: number;
  avgCheck: number;
  collected: number;
  receivableTotal: number;
  plan: { target: number; actual: number; attainment: number };
};

/**
 * Зведена за поточний місяць. Ендпоінт сам скоупить SALES до власних
 * даних (scope: "own"), тож окремої перевірки ролі тут не треба.
 */
export default function SalesSummary() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);

    fetch(`/api/admin/sales-analytics/summary?from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((data) => alive && setTotals(data?.totals ?? null))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-bk">
          Продажі за місяць
        </h3>
        <Link
          href="/admin/sales-analytics"
          className="flex-shrink-0 text-[12px] font-medium text-g400 transition-colors hover:text-bk"
        >
          Деталі →
        </Link>
      </div>

      {error ? (
        <p className="py-4 text-[13px] text-g400">Не вдалося завантажити</p>
      ) : !totals ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-g100" />
          ))}
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Metric label="Оборот" value={`${money(totals.revenue)} ₴`} />
          <Metric label="Документів" value={String(totals.docs)} />
          <Metric label="Середній чек" value={`${money(totals.avgCheck)} ₴`} />
          <Metric
            label="Дебіторка"
            value={`${money(totals.receivableTotal)} ₴`}
            tone={totals.receivableTotal > 0 ? "warn" : undefined}
          />
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] uppercase tracking-wide text-g400">{label}</p>
      <p
        className={`mt-0.5 truncate text-[17px] font-bold tabular-nums leading-tight ${
          tone === "warn" ? "text-[#C77700]" : "text-bk"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
