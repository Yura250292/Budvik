"use client";

import type { ReactNode } from "react";

/** Форматування грошей: без копійок — на дашборді вони лише шум. */
export function money(value: number): string {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(Math.round(value || 0));
}

export function num(value: number, digits = 0): string {
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value || 0);
}

export function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    default: "text-bk",
    good: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-red-600",
  }[tone];

  return (
    <div className="rounded-[var(--radius-card)] border border-g200 bg-white p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-g500">{label}</span>
        {icon && <span className="text-g400">{icon}</span>}
      </div>
      <div className={`mt-2 flex items-baseline gap-1 ${toneClass}`}>
        <span className="text-2xl font-semibold tabular-nums tracking-tight">{value}</span>
        {unit && <span className="text-sm font-medium text-g500">{unit}</span>}
      </div>
      {hint && <p className="mt-1 text-xs text-g500">{hint}</p>}
    </div>
  );
}

/**
 * Прогрес виконання плану.
 *
 * Понад 100% не обрізається візуально до 100 — смуга лишається повною, але
 * підпис показує реальні 137%: інакше перевиконання не відрізнити від точного
 * влучання.
 */
export function ProgressBar({
  percent,
  label,
  showValue = true,
  height = 8,
}: {
  percent: number;
  label?: string;
  showValue?: boolean;
  height?: number;
}) {
  const safe = Number.isFinite(percent) ? percent : 0;
  const width = Math.max(0, Math.min(100, safe));

  const color =
    safe >= 100 ? "bg-emerald-500" : safe >= 70 ? "bg-primary" : safe > 0 ? "bg-amber-400" : "bg-g300";

  return (
    <div>
      {(label || showValue) && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          {label && <span className="truncate text-xs text-g600">{label}</span>}
          {showValue && (
            <span className="shrink-0 text-xs font-semibold tabular-nums text-g600">
              {num(safe)}%
            </span>
          )}
        </div>
      )}
      <div
        className="w-full overflow-hidden rounded-full bg-g200"
        style={{ height }}
        role="progressbar"
        aria-valuenow={Math.round(safe)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Виконання плану"}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${color}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

/** Горизонтальна смуга для рейтингів (частка від максимуму). */
export function RankBar({
  label,
  value,
  max,
  suffix,
  color,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  color?: string | null;
}) {
  const width = max > 0 ? Math.max(1.5, (value / max) * 100) : 0;
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="truncate text-sm text-bk">{label}</span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-bk">
          {money(value)}
          {suffix && <span className="ml-1 text-xs font-normal text-g500">{suffix}</span>}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-g100">
        <div
          className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${width}%`, backgroundColor: color || "var(--color-primary)" }}
        />
      </div>
    </div>
  );
}
