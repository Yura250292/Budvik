"use client";

/**
 * Динаміка відвідуваності по днях. Окремий модуль, бо вантажиться через
 * next/dynamic — Recharts важить більше за решту вкладки.
 *
 * Свій графік, а не TimelineChart із sales-analytics: там вісь у гривнях
 * («1,25 млн»), і 40 відвідувачів на ній виглядали б як нуль.
 */

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CATEGORICAL } from "@/lib/analytics/colors";

const AXIS = { fontSize: 11, fill: "var(--color-g500)" };
const GRID = "var(--color-g200)";

const VISITORS = CATEGORICAL[0];
const VIEWS = CATEGORICAL[2];

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
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[var(--radius-badge)] border border-g200 bg-white px-3 py-2 shadow-[var(--shadow-card)]">
      <p className="mb-1 text-xs font-semibold text-bk">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-xs text-g600">
          <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: entry.color }} />
          {entry.name}: <span className="font-semibold text-bk">{entry.value ?? 0}</span>
        </p>
      ))}
    </div>
  );
}

export default function VisitorsChart({
  data,
  height = 280,
}: {
  data: Array<{ day: string; visitors: number; pageViews: number }>;
  height?: number;
}) {
  const rows = data.map((d) => ({ ...d, label: dayLabel(d.day) }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="visitorsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={VISITORS} stopOpacity={0.28} />
            <stop offset="100%" stopColor={VISITORS} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={18} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
        <Tooltip content={<TooltipBox />} cursor={{ stroke: "var(--color-g300)" }} />
        <Area
          type="monotone"
          dataKey="visitors"
          name="Відвідувачі"
          stroke={VISITORS}
          strokeWidth={2}
          fill="url(#visitorsFill)"
        />
        {/* Перегляди лінією поверх заливки: їх завжди більше за людей, і
            двома заливками графік перетворився б на кашу. */}
        <Line type="monotone" dataKey="pageViews" name="Перегляди" stroke={VIEWS} strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
