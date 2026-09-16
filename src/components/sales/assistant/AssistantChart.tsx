"use client";

/**
 * Діаграма у відповіді помічника — з блоку ```budvik-chart.
 *
 * Окремий модуль, бо вантажиться через next/dynamic: Recharts важить
 * ~150 КБ, і торговий, який ніколи не бачить діаграм, платити за них не
 * мусить (той самий прийом, що в dashboard/widget-registry.tsx).
 *
 * Правила малювання (перевірені валідатором палітри, не на око):
 *   • кольори рядів — перші слоти CATEGORICAL у фіксованому порядку;
 *     колір іде за рядом, а не за місцем, і рядів не більше чотирьох;
 *   • одна вісь Y — два показники різного масштабу модель малює двома
 *     діаграмами (див. blocks.ts);
 *   • сітка — суцільна тонка лінія, не пунктир;
 *   • легенда є завжди, коли рядів два й більше; числа на смугах — лише
 *     в рейтингу з одного ряду, де їх небагато;
 *   • у двох кольорів палітри контраст із фоном нижче 3:1, тож у кожної
 *     діаграми є перемикач «Таблиця» — жодне число не сховане лише в
 *     підказці під пальцем.
 */

import { useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { CATEGORICAL } from "@/lib/analytics/colors";
import type { ChartSpec } from "@/lib/assistant/blocks";

const AXIS = { fontSize: 11, fill: "var(--color-cab-t3)" };
const GRID = "var(--color-cab-line)";
const INK = "var(--color-bk)";

const grouped = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 });

/** Повне значення з одиницею — для підказки й таблиці. */
export function formatValue(value: number | null | undefined, unit: string): string {
  if (value == null) return "—";
  const digits = Math.abs(value) >= 100 ? 0 : 1;
  const text = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: digits }).format(value);
  if (!unit) return text;
  return unit === "%" ? `${text} %` : `${text} ${unit}`;
}

/**
 * Коротке значення для осі й підпису: 1 250 000 → «1,3 млн».
 *
 * Гривню на осі не пишемо — вона вже в назві й у підказці, а на вузькому
 * екрані знак біля кожної поділки з'їдає місце під числа. Відсоток пишемо:
 * без нього «45» на осі читається як сума.
 */
function compact(value: number, unit: string): string {
  const a = Math.abs(value);
  const tail = unit === "%" ? " %" : "";
  if (a >= 1_000_000) return `${grouped.format(Math.round(value / 100_000) / 10)} млн`;
  if (a >= 10_000) return `${grouped.format(Math.round(value / 1000))} тис`;
  return `${grouped.format(Math.round(value * 10) / 10)}${tail}`;
}

const cut = (label: string, max: number) => (label.length > max ? `${label.slice(0, max - 1)}…` : label);

type TipPayload = Array<{ name?: string; value?: number; color?: string; payload?: Record<string, unknown> }>;

function TooltipBox({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: TipPayload;
  label?: string | number;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-cab-line bg-white px-2.5 py-2 shadow-sm">
      {label != null && label !== "" && <p className="mb-1 text-[12px] font-semibold text-bk">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-1.5 text-[12px] text-cab-t2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: entry.color }} aria-hidden />
          {entry.name}: <span className="font-semibold text-bk">{formatValue(entry.value, unit)}</span>
        </p>
      ))}
    </div>
  );
}

function ScatterTip({ active, payload, spec }: { active?: boolean; payload?: TipPayload; spec: ChartSpec }) {
  const point = payload?.[0]?.payload as { label?: string; x?: number; y?: number } | undefined;
  if (!active || !point) return null;
  return (
    <div className="rounded-lg border border-cab-line bg-white px-2.5 py-2 shadow-sm">
      <p className="mb-1 text-[12px] font-semibold text-bk">{point.label}</p>
      <p className="text-[12px] text-cab-t2">
        {spec.xLabel ?? "X"}: <span className="font-semibold text-bk">{formatValue(point.x, spec.xUnit ?? "")}</span>
      </p>
      <p className="text-[12px] text-cab-t2">
        {spec.yLabel ?? "Y"}: <span className="font-semibold text-bk">{formatValue(point.y, spec.unit)}</span>
      </p>
    </div>
  );
}

const color = (i: number) => CATEGORICAL[i] ?? CATEGORICAL[0];

export default function AssistantChart({ spec }: { spec: ChartSpec }) {
  const [asTable, setAsTable] = useState(false);
  const multi = spec.series.length > 1;

  const rows = spec.categories.map((category, i) => {
    const row: Record<string, string | number | null> = { category };
    spec.series.forEach((s, j) => {
      row[`s${j}`] = s.values[i];
    });
    return row;
  });

  const legend = multi ? (
    <Legend
      verticalAlign="top"
      align="left"
      height={26}
      iconType="circle"
      iconSize={8}
      wrapperStyle={{ fontSize: 11, color: "var(--color-cab-t2)" }}
    />
  ) : null;

  let chart: React.ReactNode = null;
  let height = 240;

  if (spec.type === "bar") {
    // Горизонтальні смуги: висота росте з кількістю рядків, а не
    // стискає їх у фіксовану коробку (інакше підписи налізають).
    const perRow = multi ? 14 * spec.series.length + 10 : 26;
    height = Math.max(140, spec.categories.length * perRow + (multi ? 56 : 30));
    const labelled = !multi && spec.categories.length <= 12;
    chart = (
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: labelled ? 64 : 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => compact(v, spec.unit)} />
        <YAxis
          type="category"
          dataKey="category"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={118}
          interval={0}
          tickFormatter={(v: string) => cut(v, 18)}
        />
        <Tooltip content={<TooltipBox unit={spec.unit} />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        {legend}
        {spec.series.map((s, j) => (
          <Bar key={j} dataKey={`s${j}`} name={s.name} fill={color(j)} radius={[0, 4, 4, 0]} maxBarSize={multi ? 12 : 20}>
            {labelled && (
              <LabelList
                dataKey={`s${j}`}
                position="right"
                style={{ fontSize: 11, fill: INK }}
                formatter={(v: unknown) => (typeof v === "number" ? compact(v, spec.unit) : "")}
              />
            )}
          </Bar>
        ))}
      </BarChart>
    );
  } else if (spec.type === "column") {
    height = multi ? 270 : 240;
    chart = (
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="category" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={6} tickFormatter={(v: string) => cut(v, 10)} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => compact(v, spec.unit)} />
        <Tooltip content={<TooltipBox unit={spec.unit} />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        {legend}
        {spec.series.map((s, j) => (
          <Bar key={j} dataKey={`s${j}`} name={s.name} fill={color(j)} radius={[4, 4, 0, 0]} maxBarSize={24} />
        ))}
      </BarChart>
    );
  } else if (spec.type === "line") {
    height = multi ? 270 : 240;
    const dots = spec.categories.length <= 12;
    chart = (
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="category" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={10} tickFormatter={(v: string) => cut(v, 10)} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => compact(v, spec.unit)} />
        <Tooltip content={<TooltipBox unit={spec.unit} />} cursor={{ stroke: GRID }} />
        {legend}
        {spec.series.map((s, j) => (
          <Line
            key={j}
            type="monotone"
            dataKey={`s${j}`}
            name={s.name}
            stroke={color(j)}
            strokeWidth={2}
            strokeLinecap="round"
            connectNulls
            dot={dots ? { r: 4, fill: color(j), stroke: "#fff", strokeWidth: 2 } : false}
            activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    );
  } else {
    height = 280;
    chart = (
      <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis
          type="number"
          dataKey="x"
          name={spec.xLabel}
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          tickFormatter={(v: number) => compact(v, spec.xUnit ?? "")}
          label={spec.xLabel ? { value: spec.xLabel, position: "insideBottom", offset: -12, style: { fontSize: 11, fill: "var(--color-cab-t3)" } } : undefined}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={spec.yLabel}
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(v: number) => compact(v, spec.unit)}
        />
        <ZAxis range={[64, 64]} />
        <Tooltip content={<ScatterTip spec={spec} />} cursor={{ stroke: GRID }} />
        <Scatter data={spec.points} fill={color(0)} stroke="#fff" strokeWidth={2} />
      </ScatterChart>
    );
  }

  return (
    <figure className="my-2.5 rounded-xl border border-cab-line bg-white p-2.5">
      <figcaption className="mb-1.5 flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-bk">
          {spec.title}
          {spec.type === "scatter" && spec.yLabel && (
            <span className="block text-[11px] font-normal text-cab-t3">
              вертикаль — {spec.yLabel}
              {spec.xLabel ? `, горизонталь — ${spec.xLabel}` : ""}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-cab-line px-2 text-[11px] font-semibold text-cab-t2"
        >
          {asTable ? <BarChart3 size={12} /> : <Table2 size={12} />}
          {asTable ? "Діаграма" : "Таблиця"}
        </button>
      </figcaption>

      {asTable ? (
        <ChartTable spec={spec} />
      ) : (
        <div style={{ height }} className="w-full">
          <ResponsiveContainer width="100%" height="100%">
            {chart as React.ReactElement}
          </ResponsiveContainer>
        </div>
      )}

      {spec.note && <p className="mt-1.5 text-[11px] leading-snug text-cab-t3">{spec.note}</p>}
    </figure>
  );
}

/** Та сама діаграма числами: рядок — підпис, колонка — ряд. */
function ChartTable({ spec }: { spec: ChartSpec }) {
  if (spec.type === "scatter") {
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px] tabular-nums">
          <thead>
            <tr>
              <th className="border-b border-cab-line px-2 py-1 text-left font-semibold">Назва</th>
              <th className="border-b border-cab-line px-2 py-1 text-right font-semibold">{spec.xLabel ?? "X"}</th>
              <th className="border-b border-cab-line px-2 py-1 text-right font-semibold">{spec.yLabel ?? "Y"}</th>
            </tr>
          </thead>
          <tbody>
            {spec.points.map((p, i) => (
              <tr key={i}>
                <td className="border-b border-cab-line px-2 py-1">{p.label}</td>
                <td className="border-b border-cab-line px-2 py-1 text-right">{formatValue(p.x, spec.xUnit ?? "")}</td>
                <td className="border-b border-cab-line px-2 py-1 text-right">{formatValue(p.y, spec.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px] tabular-nums">
        <thead>
          <tr>
            <th className="border-b border-cab-line px-2 py-1 text-left font-semibold">{spec.xLabel ?? ""}</th>
            {spec.series.map((s, j) => (
              <th key={j} className="border-b border-cab-line px-2 py-1 text-right font-semibold">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.categories.map((c, i) => (
            <tr key={i}>
              <td className="border-b border-cab-line px-2 py-1">{c}</td>
              {spec.series.map((s, j) => (
                <td key={j} className="border-b border-cab-line px-2 py-1 text-right">
                  {formatValue(s.values[i], spec.unit)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
