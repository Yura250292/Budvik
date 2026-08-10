"use client";

import type { ReactNode } from "react";
import { STATUS, attainmentStatus, type StatusKey } from "@/lib/analytics/colors";

/**
 * Напівкруглий індикатор виконання (180°).
 *
 * Чому не <circle> + strokeDasharray + -rotate-90, як у ResultCard: на
 * повному колі це працює, на півколі довелося б рахувати частку від 2πr і
 * ще й зміщувати strokeDashoffset. Дві формули замість однієї, і кожна
 * зміна радіуса ламає обидві.
 *
 * Тут — <path> з дугою і pathLength={100}. SVG переозначає «довжину»
 * шляху на 100, тож strokeDasharray стає буквально відсотками: жодного
 * π у коді й повна незалежність від розміру.
 *
 * ПЕРЕВИКОНАННЯ. Понад 100% малюється другою дугою поверх першої —
 * інакше 137% і 100% виглядали б однаково, а це різні новини. Друга дуга
 * темніша за першу: перевиконання має читатися як «ще один шар», а не як
 * інший показник.
 *
 * КОЛІР. Береться з attainmentStatus() — тими самими порогами, що й
 * бейджі у зведеній адміна. Колір ніколи не єдиний носій сенсу: у чаші
 * дуги завжди стоїть число.
 */

export type GaugeSize = "hero" | "compact";

/** Геометрія на розмір. viewBox фіксований, масштаб — через CSS-ширину. */
const GEOM = {
  hero: { w: 240, h: 136, cx: 120, cy: 120, r: 104, track: 14, arc: 14, gap: 6, top: 56 },
  compact: { w: 120, h: 70, cx: 60, cy: 62, r: 50, track: 9, arc: 9, gap: 4, top: 26 },
} as const;

/** Дуга від 180° до 0°: зліва → через верх → направо. */
function semicirclePath(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
}

/** Темніший відтінок для дуги перевиконання: множимо канали на 0.72. */
function darken(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.max(0, Math.round(c * 0.72))
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function Gauge({
  percent,
  size = "hero",
  label,
  valueText,
  caption,
  color,
  hasTarget = true,
  children,
}: {
  /** Виконання у відсотках. Може бути > 100 і не обмежується зверху. */
  percent: number;
  size?: GaugeSize;
  /** Доступний підпис — обов'язковий, читається скрінрідером. */
  label: string;
  /** Що написати в чаші. За замовчуванням — «68%». */
  valueText?: string;
  /** Дрібний рядок під числом: «612 000 з 900 000». */
  caption?: string;
  /**
   * Явний колір дуги. Задається для КАТЕГОРІЇ (колір фірми) — тоді дуга
   * несе тотожність, а не стан, і стан читається з числа поруч.
   * Не заданий — колір беремо зі стану виконання.
   */
  color?: string | null;
  /** false — плану немає; дуга сіра, а не «провалена». */
  hasTarget?: boolean;
  /** Довільний вміст замість числа (напр. сума грошей). */
  children?: ReactNode;
}) {
  const g = GEOM[size];
  const safe = Number.isFinite(percent) ? Math.max(0, percent) : 0;

  const status: StatusKey = attainmentStatus(safe, hasTarget);
  const baseColor = !hasTarget ? "var(--color-g300)" : color || STATUS[status].mark;

  const primary = Math.min(100, safe);
  const overflow = Math.min(100, Math.max(0, safe - 100));
  const overflowColor = baseColor.startsWith("#") ? darken(baseColor) : baseColor;

  const d = semicirclePath(g.cx, g.cy, g.r);
  const text = valueText ?? `${Math.round(safe)}%`;

  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: g.w, maxWidth: "100%" }}>
      <svg
        viewBox={`0 0 ${g.w} ${g.h}`}
        className="w-full"
        role="progressbar"
        aria-valuenow={Math.round(safe)}
        aria-valuemin={0}
        aria-valuemax={100}
        /* valuemax=100 при valuenow=137 формально суперечливе — саме тому
           скрінрідер читає valuetext, і перевиконання озвучується коректно. */
        aria-valuetext={hasTarget ? `${Math.round(safe)} відсотків` : "план не задано"}
        aria-label={label}
      >
        {/* Доріжка */}
        <path d={d} fill="none" stroke="var(--color-g200)" strokeWidth={g.track} strokeLinecap="round" />

        {/* Основна дуга: 0..100 */}
        <path
          d={d}
          fill="none"
          stroke={baseColor}
          strokeWidth={g.arc}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${primary} 100`}
          className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none"
        />

        {/* Перевиконання: другий шар поверх повної дуги */}
        {overflow > 0 && (
          <path
            d={d}
            fill="none"
            stroke={overflowColor}
            strokeWidth={Math.max(3, g.arc - g.gap)}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${overflow} 100`}
            className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none"
          />
        )}
      </svg>

      {/* Число в чаші дуги. aria-hidden — значення вже озвучене на svg. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 flex flex-col items-center px-2"
        style={{ top: g.top }}
      >
        {children ?? (
          <span
            className={`font-semibold tabular-nums tracking-tight ${
              size === "hero" ? "text-3xl" : "text-base"
            }`}
            style={{ color: hasTarget ? STATUS[status].fg : "var(--color-g400)" }}
          >
            {hasTarget ? text : "—"}
          </span>
        )}
        {caption && (
          <span
            className={`mt-0.5 text-center tabular-nums text-g500 ${
              size === "hero" ? "text-xs" : "text-[10px]"
            }`}
          >
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Кільце фірми: дуга кольору бренду + назва + відсоток текстом.
 *
 * Колір тут — тотожність (яка фірма), а не стан (як справи), тож стан
 * дублюється відсотком у чаші. Інакше дальтонік бачив би шість
 * однакових дуг.
 */
export function BrandGauge({
  name,
  percent,
  color,
  hasTarget,
  caption,
  footer,
}: {
  name: string;
  percent: number;
  color: string;
  hasTarget: boolean;
  caption?: string;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-[var(--radius-card)] border border-g200 bg-white p-3 shadow-[var(--shadow-card)]">
      <Gauge
        size="compact"
        percent={percent}
        color={color}
        hasTarget={hasTarget}
        label={`${name}: виконання плану`}
        caption={caption}
      />
      <span className="flex w-full min-w-0 items-center justify-center gap-1.5">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-xs font-medium text-bk">{name}</span>
      </span>
      {footer}
    </div>
  );
}
