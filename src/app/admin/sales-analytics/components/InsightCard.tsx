"use client";

import { money, num } from "@/components/ui/Stat";
import { STATUS, type StatusKey } from "@/lib/analytics/colors";
import type { Insight, InsightSeverity, InsightUnit } from "@/lib/ai/insights";

/**
 * Одна картка інсайту.
 *
 * Винесено з InsightsPanel, бо той самий вигляд потрібен у двох місцях:
 * у свіжому аналізі й у збереженому звіті з архіву. Дублювати розмітку
 * означало б, що колись вони розійдуться — і той самий інсайт виглядатиме
 * по-різному залежно від того, звідки на нього дивишся.
 */

export const SEVERITY_META: Record<InsightSeverity, { label: string; status: StatusKey }> = {
  critical: { label: "Критично", status: "bad" },
  warning: { label: "Увага", status: "warn" },
  info: { label: "До відома", status: "info" },
  positive: { label: "Добре", status: "good" },
};

/** Найгостріші зверху — керівник читає згори вниз і не мусить шукати. */
export const SEVERITY_ORDER: InsightSeverity[] = ["critical", "warning", "info", "positive"];

export function sortInsights(list: Insight[]): Insight[] {
  return [...list].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );
}

export function formatValue(value: number, unit: InsightUnit): string {
  if (unit === "uah") return `${money(value)} ₴`;
  if (unit === "pct") return `${num(Math.round(value))}%`;
  if (unit === "days") return `${num(value)} дн.`;
  return num(value);
}

export function InsightCard({ insight }: { insight: Insight }) {
  const meta = SEVERITY_META[insight.severity] ?? SEVERITY_META.info;
  const tone = STATUS[meta.status];
  const evidence = Array.isArray(insight.evidence) ? insight.evidence : [];

  return (
    <li
      className="rounded-[var(--radius-card)] border p-3"
      style={{ borderColor: tone.border, backgroundColor: tone.bg }}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className="rounded-[var(--radius-badge)] px-1.5 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: tone.mark, color: "#fff" }}
        >
          {meta.label}
        </span>
        <span className="font-semibold text-bk">{insight.title}</span>
      </div>

      <p className="mt-1.5 text-sm text-g600">{insight.detail}</p>

      {evidence.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {evidence.map((e, i) => (
            <span
              key={`${e.label}-${i}`}
              className="inline-flex items-baseline gap-1.5 rounded-[var(--radius-badge)] border border-white/60 bg-white/70 px-2 py-1 text-xs"
            >
              <span className="text-g600">{e.label}</span>
              <span className="font-semibold tabular-nums text-bk">
                {formatValue(e.value, e.unit)}
              </span>
            </span>
          ))}
        </div>
      )}

      {insight.action && (
        <p className="mt-2 text-sm font-medium" style={{ color: tone.fg }}>
          → {insight.action}
        </p>
      )}
    </li>
  );
}
