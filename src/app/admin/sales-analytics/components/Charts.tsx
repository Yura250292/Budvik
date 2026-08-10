"use client";

/**
 * Графіки аналітики. Окремий модуль, бо вантажиться через next/dynamic:
 * Recharts важить помітно більше за решту сторінки, і платити за нього на
 * вкладках без діаграм не потрібно.
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money } from "@/components/ui/Stat";

const AXIS = { fontSize: 11, fill: "var(--color-g500)" };
const GRID = "var(--color-g200)";

/** Компактні гривні для осі: 1 250 000 → 1,25 млн */
function shortMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")} млн`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1000)} тис`;
  return String(Math.round(value));
}

function dayLabel(day: string): string {
  const [, m, d] = day.split("-");
  return `${d}.${m}`;
}

function TooltipBox({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; payload?: Record<string, unknown> }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[var(--radius-badge)] border border-g200 bg-white px-3 py-2 shadow-[var(--shadow-card)]">
      <p className="mb-1 text-xs font-semibold text-bk">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-xs text-g600">
          {entry.name}: <span className="font-semibold text-bk">{money(entry.value ?? 0)}</span>
        </p>
      ))}
    </div>
  );
}

/** Динаміка обороту по днях. */
export function TimelineChart({
  data,
  height = 260,
}: {
  data: Array<{ day: string; amount: number; docs: number }>;
  height?: number;
}) {
  const rows = data.map((d) => ({ ...d, label: dayLabel(d.day) }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="amountFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={18} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={shortMoney} width={56} />
        <Tooltip content={<TooltipBox />} cursor={{ stroke: "var(--color-g300)" }} />
        <Area
          type="monotone"
          dataKey="amount"
          name="Оборот, грн"
          stroke="var(--color-primary-dark)"
          strokeWidth={2}
          fill="url(#amountFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Порівняння категорій (бренди, торгові) — горизонтальні смуги. */
export function RankingChart({
  data,
  height = 320,
  colorKey = "color",
}: {
  data: Array<{ name: string; value: number; color?: string | null }>;
  height?: number;
  colorKey?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={shortMoney} />
        <YAxis
          type="category"
          dataKey="name"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={124}
          interval={0}
        />
        <Tooltip content={<TooltipBox />} cursor={{ fill: "var(--color-g100)" }} />
        <Bar dataKey="value" name="Сума, грн" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={(entry as Record<string, unknown>)[colorKey] as string || "var(--color-primary)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** План проти факту по брендах. */
export function PlanVsActualChart({
  data,
  height = 320,
}: {
  data: Array<{ name: string; target: number; actual: number }>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={shortMoney} />
        <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={124} interval={0} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: "var(--color-g100)" }} />
        <Bar dataKey="target" name="План" fill="var(--color-g300)" radius={[0, 4, 4, 0]} maxBarSize={10} />
        <Bar dataKey="actual" name="Факт" fill="var(--color-primary)" radius={[0, 4, 4, 0]} maxBarSize={10} />
      </BarChart>
    </ResponsiveContainer>
  );
}
