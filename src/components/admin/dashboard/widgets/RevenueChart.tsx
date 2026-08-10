"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "@/components/ui/Stat";

type Row = { repId: string; repName?: string; name?: string; revenue: number };

/**
 * Оборот по торгових за поточний місяць. Стовпчики по людях читаються
 * швидше за динаміку в часі: на дашборді питання зазвичай «хто тягне»,
 * а не «як змінювалось».
 */
export default function RevenueChart() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);

    fetch(`/api/admin/sales-analytics/summary?from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((data) => {
        if (!alive) return;
        const list: Row[] = Array.isArray(data?.rows) ? data.rows : [];
        setRows(list.filter((r) => r.revenue > 0).slice(0, 10));
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  const chartData = (rows ?? []).map((r) => ({
    name: (r.repName || r.name || "—").split(" ")[0],
    revenue: Math.round(r.revenue),
  }));

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-bk">Оборот по торгових</h3>
        <Link
          href="/admin/sales-analytics"
          className="flex-shrink-0 text-[12px] font-medium text-g400 transition-colors hover:text-bk"
        >
          Аналітика →
        </Link>
      </div>

      {error ? (
        <p className="py-4 text-[13px] text-g400">Не вдалося завантажити</p>
      ) : rows === null ? (
        <div className="h-full min-h-[120px] animate-pulse rounded bg-g100" />
      ) : chartData.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-g400">Продажів за місяць ще немає</p>
      ) : (
        <div className="min-h-[120px] flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FFD600" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#FFD600" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "#9E9E9E" }}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#9E9E9E" }}
                axisLine={false}
                tickLine={false}
                width={52}
                tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}к` : String(v))}
              />
              <Tooltip
                formatter={(v) => [`${money(Number(v))} ₴`, "Оборот"] as [string, string]}
                contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #EFEFEF" }}
              />
              <Area type="monotone" dataKey="revenue" stroke="#E6C200" strokeWidth={2} fill="url(#revFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
