/**
 * Період аналітичної відповіді — і його підпис.
 *
 * Живе окремо від answers.ts, бо той самий період рахують і інструменти
 * керівника: там межі приходять аргументами моделі, а не словами питання.
 * Дві реалізації розійшлися б рівно там, де це найдорожче — у тому, що
 * означає слово «місяць».
 */

import { parseMonth, shiftDay } from "@/lib/analytics/period";
import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { ANALYTICS_SINCE_DAY } from "@/lib/analytics/since";
import { days, monthLabel } from "@/lib/assistant/text";
import { followUps } from "@/lib/assistant/md";
import type { PeriodSpec } from "@/lib/assistant/router";

/**
 * Період у тому вигляді, який очікує аналітика, — і його підпис.
 *
 * «Місяць» тут означає КАЛЕНДАРНИЙ місяць (рішення власника 06.09.2026):
 * саме так живуть план і мотивація, і саме так це слово розуміє людина.
 * Ковзні 30 днів лишаються, але тільки коли їх попросили явно.
 *
 * Підпис віддається разом із періодом навмисно: та сама відповідь раніше
 * показувала суму за 7 серпня — 6 вересня, а блок плану під нею — з
 * 1 вересня, і жодне з двох чисел не було підписане.
 */
export function periodOf(today: string, spec: PeriodSpec) {
  const clamp = (day: string) => (day < ANALYTICS_SINCE_DAY ? ANALYTICS_SINCE_DAY : day);

  if (spec.kind === "month") {
    const monthKey = spec.offset === 0 ? today.slice(0, 7) : shiftMonthKey(today.slice(0, 7), -1);
    const parsed = parseMonth(monthKey);
    const toDay = spec.offset === 0 ? today : kyivDate(parsed.to);
    return buildPeriod(
      clamp(`${monthKey}-01`),
      toDay,
      spec.offset === 0
        ? `за ${monthLabel(monthKey, today)} (1–${Number(today.slice(8, 10))})`
        : `за ${monthLabel(monthKey, today)}`
    );
  }

  if (spec.kind === "range") {
    const toDay = spec.to > today ? today : spec.to;
    const fromDay = clamp(spec.from);
    return buildPeriod(fromDay, toDay, `з ${dayMonth(fromDay)} по ${dayMonth(toDay)}`);
  }

  const fromDay = clamp(shiftDay(today, -(spec.days - 1)));
  return buildPeriod(fromDay, today, `за ${days(spec.days)} (${dayMonth(fromDay)} — ${dayMonth(today)})`);
}

export function buildPeriod(fromDay: string, toDay: string, label: string) {
  const span = Math.round(
    (new Date(`${toDay}T12:00:00Z`).getTime() - new Date(`${fromDay}T12:00:00Z`).getTime()) / 86_400_000
  );
  return {
    fromDay,
    toDay,
    from: kyivDayStart(fromDay),
    to: kyivDayEnd(toDay),
    days: Math.max(1, span + 1),
    clamped: false,
    label,
  };
}

/** Перша літера велика — підпис періоду вживається і як початок речення. */
export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** «7 серпня» — день і місяць так, як їх вимовляють. */
export function dayMonth(day: string): string {
  const MONTHS_GEN = [
    "січня", "лютого", "березня", "квітня", "травня", "червня",
    "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
  ];
  return `${Number(day.slice(8, 10))} ${MONTHS_GEN[Number(day.slice(5, 7)) - 1]}`;
}

/** «2026-09» + (−1) → «2026-08». */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Кнопки вибору періоду під аналітичною відповіддю.
 *
 * Питання торгового звучить однаково, а період у голові різний: одному
 * треба місяць, іншому «а за два». Замість того щоб учити формулювань,
 * показуємо готові.
 */
export function periodChips(question: string): string {
  return followUps(
    `${question} за 30 днів`,
    `${question} за 60 днів`,
    `${question} за минулий місяць`
  );
}

/**
 * Період із аргументів інструмента.
 *
 * Модель називає межі двома способами — «за 30 днів» і «з 01.08 по 15.08», —
 * і обидва мусять дати той самий обʼєкт, що й слова в питанні. Без
 * аргументів беремо календарний місяць: керівник питає «як іде місяць»
 * частіше, ніж «як останні 30 днів».
 */
export function periodFromArgs(today: string, args: Record<string, unknown>) {
  const from = typeof args.period_from === "string" ? args.period_from : null;
  const to = typeof args.period_to === "string" ? args.period_to : null;
  if (from && to) {
    return periodOf(today, { kind: "range", from, to });
  }

  const rawDays = typeof args.days === "number" ? args.days : Number(args.days);
  if (Number.isFinite(rawDays) && rawDays >= 1) {
    return periodOf(today, { kind: "days", days: Math.min(365, Math.round(rawDays)) });
  }

  return periodOf(today, { kind: "month", offset: 0 });
}

/** Опис періоду для JSON інструмента — так само підписаний, як у відповідях. */
export function periodFacts(period: ReturnType<typeof periodOf>) {
  return { з: period.fromDay, по: period.toDay, днів: period.days, підпис: period.label };
}
