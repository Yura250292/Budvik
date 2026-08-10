"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, num } from "@/components/ui/Stat";
import { categoricalColor, NEUTRAL } from "@/lib/analytics/colors";
import { useDashboardData } from "../DashboardData";
import { Bar, WidgetBody } from "./parts";

const ANALYTICS = "/admin/sales-analytics";

const dayFmt = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", timeZone: "Europe/Kyiv" });

/** Динаміка обороту по днях — той самий ряд, що на вкладці «Огляд». */
export function RevenueTimeline() {
  const { overview, period } = useDashboardData();
  const rows = overview.data?.timeline ?? [];
  const data = rows.map((r) => ({
    day: dayFmt.format(new Date(`${r.day}T12:00:00Z`)),
    amount: Math.round(r.amount),
    docs: r.docs,
  }));

  return (
    <WidgetBody
      title="Динаміка обороту"
      hint="За київською добою"
      href={`${ANALYTICS}?tab=overview&from=${period.from}&to=${period.to}`}
      loading={overview.loading}
      error={overview.error}
      empty={!!overview.data && data.length === 0}
    >
      <div className="h-full min-h-[130px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
            <defs>
              <linearGradient id="dashRevFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FFD600" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#FFD600" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#9E9E9E" }} axisLine={false} tickLine={false} minTickGap={18} />
            <YAxis
              tick={{ fontSize: 10, fill: "#9E9E9E" }}
              axisLine={false}
              tickLine={false}
              width={48}
              tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}к` : String(v))}
            />
            <Tooltip
              formatter={(v, name) =>
                (name === "amount" ? [`${money(Number(v))} ₴`, "Оборот"] : [num(Number(v)), "Док."]) as [string, string]
              }
              contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #EFEFEF" }}
            />
            <Area type="monotone" dataKey="amount" stroke="#E6C200" strokeWidth={2} fill="url(#dashRevFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </WidgetBody>
  );
}

/**
 * Продажі по фірмах (брендах).
 * Сума тут менша за оборот документів — рахується з позицій, без знижок;
 * так само, як на вкладці «Огляд».
 */
export function BrandsWidget() {
  const { overview, period } = useDashboardData();
  const rows = (overview.data?.byBrand ?? []).slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.amount));

  return (
    <WidgetBody
      title="Продажі по фірмах"
      hint="З позицій документів, без знижок"
      href={`${ANALYTICS}?tab=overview&from=${period.from}&to=${period.to}`}
      loading={overview.loading}
      error={overview.error}
      empty={!!overview.data && rows.length === 0}
    >
      <div className="h-full overflow-y-auto">
        {rows.map((r, i) => (
          <Bar
            key={r.brand}
            label={r.brand}
            value={r.amount}
            max={max}
            display={money(r.amount)}
            suffix={`${num(r.qty)} шт.`}
            color={r.color || (r.brand === "Без бренду" ? NEUTRAL : categoricalColor(i))}
          />
        ))}
      </div>
    </WidgetBody>
  );
}

/** Топ клієнтів за оборотом. */
export function TopClients() {
  const { overview, period } = useDashboardData();
  const rows = (overview.data?.topClients ?? []).slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.amount));

  return (
    <WidgetBody
      title="Топ клієнтів"
      hint="За оборотом періоду"
      href={`${ANALYTICS}?tab=overview&from=${period.from}&to=${period.to}`}
      loading={overview.loading}
      error={overview.error}
      empty={!!overview.data && rows.length === 0}
    >
      <div className="h-full overflow-y-auto">
        {rows.map((c) => (
          <Bar
            key={c.name}
            label={c.name}
            value={c.amount}
            max={max}
            display={money(c.amount)}
            suffix={`${num(c.docs)} док.`}
            color={NEUTRAL}
          />
        ))}
      </div>
    </WidgetBody>
  );
}

/** Топ товарів за сумою. */
export function TopProducts() {
  const { overview, period } = useDashboardData();
  const rows = (overview.data?.topProducts ?? []).slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.amount));

  return (
    <WidgetBody
      title="Топ товарів"
      hint="За сумою продажів"
      href={`${ANALYTICS}?tab=overview&from=${period.from}&to=${period.to}`}
      loading={overview.loading}
      error={overview.error}
      empty={!!overview.data && rows.length === 0}
    >
      <div className="h-full overflow-y-auto">
        {rows.map((p) => (
          <Bar
            key={`${p.name}-${p.sku}`}
            label={p.name}
            value={p.amount}
            max={max}
            display={money(p.amount)}
            suffix={`${num(p.qty)} шт.`}
            color={NEUTRAL}
          />
        ))}
      </div>
    </WidgetBody>
  );
}
