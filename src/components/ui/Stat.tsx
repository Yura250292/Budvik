"use client";

import type { ReactNode } from "react";
import { STATUS, attainmentStatus, type StatusKey } from "@/lib/analytics/colors";

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

/**
 * Картка показника.
 *
 * `accent` — тонка смужка зліва: вона розділяє групи показників (гроші,
 * логістика, план) швидше, ніж читання підписів. `tone` фарбує саме число
 * і застосовується лише там, де значення справді має стан.
 */
export function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  tone = "default",
  accent,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | StatusKey;
  accent?: string;
}) {
  const valueColor = tone === "default" || tone === "neutral" ? undefined : STATUS[tone as StatusKey].mark;

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-g200 bg-white p-4 shadow-[var(--shadow-card)]">
      {accent && (
        <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: accent }} />
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-g500">{label}</span>
        {icon && <span className="text-g400">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-1" style={valueColor ? { color: valueColor } : undefined}>
        <span className={`text-2xl font-semibold tabular-nums tracking-tight ${valueColor ? "" : "text-bk"}`}>
          {value}
        </span>
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

  // Колір несе стан: виконано / досяжно / відстає / провалено. Відсоток
  // поруч дублює його текстом — колір ніколи не єдиний носій сенсу.
  const status = attainmentStatus(safe, safe > 0);
  const color = STATUS[status].mark;

  return (
    <div>
      {(label || showValue) && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          {label && <span className="truncate text-xs text-g600">{label}</span>}
          {showValue && (
            <span
              className="shrink-0 text-xs font-semibold tabular-nums"
              style={{ color: safe > 0 ? STATUS[status].fg : "var(--color-g500)" }}
            >
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
          className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${width}%`, backgroundColor: safe > 0 ? color : "var(--color-g300)" }}
        />
      </div>
    </div>
  );
}

/**
 * Горизонтальна смуга для рейтингів (частка від максимуму).
 *
 * Колір — тотожність ряду, а не його ранг: якщо фільтр змінить склад
 * списку, «SOMA FIX» лишиться того самого кольору, а не перефарбується
 * через те, що піднявся на позицію вище.
 */
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
  const barColor = color || "var(--color-g400)";

  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: barColor }} />
          <span className="truncate text-sm text-bk">{label}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-bk">
          {money(value)}
          {suffix && <span className="ml-1 text-xs font-normal text-g500">{suffix}</span>}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-g100">
        <div
          className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${width}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}
