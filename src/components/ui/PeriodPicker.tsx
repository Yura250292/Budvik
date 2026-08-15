"use client";

import { useState } from "react";

/**
 * Вибір періоду: пресети + довільний діапазон.
 *
 * Працює у форматі YYYY-MM-DD за київським часом — тим самим, який очікує
 * parsePeriod на сервері. Пресети рахуються від київського «сьогодні», а не
 * від UTC: інакше після 21:00 «сьогодні» показувало б завтрашню дату.
 */

const KYIV_TZ = "Europe/Kyiv";

export function kyivToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shift(day: string, deltaDays: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export type Period = { from: string; to: string };

/**
 * Найраніша дата, за яку аналітика має дані.
 *
 * Реалізації з 1С бекфілились із січня 2026, а повернення — із 2023-го, тож
 * раніші місяці складаються з самих мінусів. Сервер усе одно підтягує початок
 * періоду (parsePeriod), але без цієї межі календар пропонував би обрати
 * 2024 рік і мовчки повертав би січень 2026 — вибір, який нікуди не веде.
 *
 * Значення дублює ANALYTICS_SINCE_DAY із lib/analytics/since.ts: клієнтський
 * компонент не може імпортувати серверний модуль, тож при зміні межі
 * (після глибокого бекфілу реалізацій) правити треба обидва місця.
 */
export const ANALYTICS_SINCE_DAY = "2026-01-01";

/** Не даємо пресету зазирнути глибше за наявну історію. */
function clampDay(day: string): string {
  return day < ANALYTICS_SINCE_DAY ? ANALYTICS_SINCE_DAY : day;
}

export const PRESETS: Array<{ key: string; label: string; make: () => Period }> = [
  { key: "today", label: "Сьогодні", make: () => ({ from: kyivToday(), to: kyivToday() }) },
  { key: "week", label: "7 днів", make: () => ({ from: shift(kyivToday(), -6), to: kyivToday() }) },
  { key: "month", label: "30 днів", make: () => ({ from: shift(kyivToday(), -29), to: kyivToday() }) },
  {
    key: "curmonth",
    label: "Цей місяць",
    make: () => ({ from: `${kyivToday().slice(0, 7)}-01`, to: kyivToday() }),
  },
  { key: "quarter", label: "90 днів", make: () => ({ from: clampDay(shift(kyivToday(), -89)), to: kyivToday() }) },
  { key: "year", label: "Рік", make: () => ({ from: clampDay(shift(kyivToday(), -364)), to: kyivToday() }) },
];

export function PeriodPicker({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  const [custom, setCustom] = useState(false);

  const activePreset = PRESETS.find((p) => {
    const made = p.make();
    return made.from === value.from && made.to === value.to;
  });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESETS.map((preset) => {
        const active = !custom && activePreset?.key === preset.key;
        return (
          <button
            key={preset.key}
            type="button"
            onClick={() => {
              setCustom(false);
              onChange(preset.make());
            }}
            aria-pressed={active}
            className={`cursor-pointer rounded-[var(--radius-btn)] px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark ${
              active
                ? "bg-bk text-white"
                : "border border-g200 bg-white text-g600 hover:border-g300 hover:text-bk"
            }`}
          >
            {preset.label}
          </button>
        );
      })}

      <button
        type="button"
        onClick={() => setCustom((v) => !v)}
        aria-pressed={custom}
        className={`cursor-pointer rounded-[var(--radius-btn)] px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark ${
          custom ? "bg-bk text-white" : "border border-g200 bg-white text-g600 hover:border-g300 hover:text-bk"
        }`}
      >
        Період
      </button>

      {custom && (
        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="period-from">
            Дата початку
          </label>
          <input
            id="period-from"
            type="date"
            value={value.from}
            min={ANALYTICS_SINCE_DAY}
            max={value.to}
            onChange={(e) => onChange({ ...value, from: clampDay(e.target.value) })}
            className="rounded-[var(--radius-btn)] border border-g200 bg-white px-2 py-1.5 text-xs text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
          />
          <span className="text-xs text-g400">—</span>
          <label className="sr-only" htmlFor="period-to">
            Дата кінця
          </label>
          <input
            id="period-to"
            type="date"
            value={value.to}
            min={value.from}
            max={kyivToday()}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className="rounded-[var(--radius-btn)] border border-g200 bg-white px-2 py-1.5 text-xs text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
          />
        </div>
      )}

      {value.from === ANALYTICS_SINCE_DAY && (
        <span className="text-xs text-g400" title="Реалізації з 1С завантажені з січня 2026. За раніші місяці в базі є лише повернення, тож оборот за них показувати не можна.">
          дані з січня 2026
        </span>
      )}
    </div>
  );
}
