"use client";

/**
 * Навігація по днях: «вчора · сьогодні · завтра» плюс будь-яка дата.
 *
 * Логіст живе в трьох днях: закриває вчорашній, веде сьогоднішній і збирає
 * завтрашній — бо 1С виписує маршрутний лист саме на завтрашній день
 * доставки. Тому три чипи, а не календар: щоденна робота має бути в один
 * клік, а календар лишається для решти.
 *
 * Головна відмінність від такої ж навігації в аналітиці змін: майбутнє тут
 * ДОЗВОЛЕНЕ. Там `max={today}` доречний — звітів за завтра не буває; тут без
 * завтрашнього дня екран втрачає половину сенсу (саме через це журнал листів
 * досі мовчки розширював період на тиждень уперед).
 */

import { kyivToday, shiftDay } from "@/components/ui/PeriodPicker";

export type DriverOption = { id: string; name: string | null };

/** Спільний вигляд кнопок ряду: 44px висоти — палець на планшеті. */
const CTL =
  "flex min-h-[38px] cursor-pointer items-center justify-center rounded-[var(--radius-btn)] border border-g200 bg-white px-3 text-[13px] text-bk transition-colors hover:bg-g50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark";

export default function DayNav({
  day,
  onDayChange,
  driverId,
  drivers,
  onDriverChange,
}: {
  /** Обраний день, YYYY-MM-DD за Києвом */
  day: string;
  onDayChange: (day: string) => void;
  driverId: string | null;
  drivers: DriverOption[];
  onDriverChange: (driverId: string | null) => void;
}) {
  const today = kyivToday();
  const quick = [
    { label: "Вчора", value: shiftDay(today, -1) },
    { label: "Сьогодні", value: today },
    { label: "Завтра", value: shiftDay(today, 1) },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={CTL}
        onClick={() => onDayChange(shiftDay(day, -1))}
        aria-label="Попередній день"
        title="Попередній день"
      >
        ‹
      </button>

      <div className="flex gap-1 rounded-[var(--radius-btn)] bg-g100 p-0.5">
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            aria-pressed={day === q.value}
            onClick={() => onDayChange(q.value)}
            className={`min-h-[34px] cursor-pointer rounded-[8px] px-3 text-[13px] transition-colors ${
              day === q.value
                ? "bg-white font-semibold text-bk shadow-sm"
                : "font-medium text-g500 hover:text-bk"
            }`}
          >
            {q.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={CTL}
        onClick={() => onDayChange(shiftDay(day, 1))}
        aria-label="Наступний день"
        title="Наступний день"
      >
        ›
      </button>

      <input
        type="date"
        value={day}
        onChange={(e) => e.target.value && onDayChange(e.target.value)}
        aria-label="Дата"
        className={`${CTL} cursor-text px-2`}
      />

      {drivers.length > 0 && (
        <select
          value={driverId ?? ""}
          onChange={(e) => onDriverChange(e.target.value || null)}
          aria-label="Водій"
          className={CTL}
        >
          <option value="">Усі водії</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name ?? "Без імені"}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
