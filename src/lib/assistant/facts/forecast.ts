/**
 * Куди прийде місяць, якщо темп збережеться.
 *
 * Питання торгового звучить не «скільки я вже зробив», а «чи витягну» — і
 * відповідь на нього це три числа: темп на день, прогноз на кінець місяця
 * і скільки треба щодня, щоб закрити ціль. Решта — прикраси.
 *
 * ЦІЛЬ БЕРЕТЬСЯ ЗВІДКИ Є. Плани в базі заводять не завжди (на вересень
 * 2026 їх немає жодного), а прогноз потрібен щодня. Тому коли плану на
 * місяць немає, орієнтиром стає минулий місяць: «вийде на 8% більше, ніж
 * у серпні» — це чесна відповідь, а мовчання чи нуль — ні.
 *
 * БОНУС — З ПРАВИЛ СХЕМИ, А НЕ З ГОЛОВИ. Пороги беруться з активних
 * правил мотивації торгового (PLAN_BONUS_*, TIERED_PERCENT). Немає схеми
 * або правил — немає й розмови про бонус: вигаданий поріг гірший за його
 * відсутність, бо на нього почнуть орієнтуватися.
 */

import { prisma } from "@/lib/prisma";
import { revenueByRep } from "@/lib/analytics/facts";
import { collectedByRepBrand, collectedTotals } from "@/lib/analytics/money-facts";
import { parseMonth } from "@/lib/analytics/period";
import { attainmentPercent, runRate, type RunRate } from "@/lib/motivation/engine";
import { resolveSchemes } from "@/lib/motivation/period-facts";
import { kyivDate } from "@/lib/date/kyiv";
import { pct, uah } from "@/lib/assistant/format";

const DAY_MS = 86_400_000;

/** Правила, у яких є поріг виконання плану — тобто те, що читається як бонус. */
const BONUS_TYPES = new Set(["PLAN_BONUS_FIXED", "PLAN_BONUS_PERCENT", "TIERED_PERCENT"]);

export type ForecastMetric = {
  ключ: "revenue" | "collected";
  назва: string;
  факт: number;
  темп_на_день: number;
  прогноз: number;
  минулий_місяць: number;
  зміна_до_минулого_відсотків: number | null;
  план: number;
  виконання_відсотків: number | null;
  прогнозоване_виконання_відсотків: number | null;
  треба_на_день: number | null;
  лишилось_добрати: number | null;
};

export type MonthForecast = {
  місяць: string;
  минулий_місяць: string;
  днів_минуло: number;
  днів_усього: number;
  днів_лишилось: number;
  показники: ForecastMetric[];
  бонуси: Array<{ правило: string; поріг_відсотків: number; прогноз_відсотків: number | null; спрацює: boolean | null }>;
  примітка: string | null;
};

/** Прогноз місяця по обороту й зібраних грошах. */
export async function monthForecast(repId: string, today: string): Promise<MonthForecast> {
  const monthKey = today.slice(0, 7);
  const month = parseMonth(monthKey);
  const prevKey = shiftMonth(monthKey, -1);
  const prev = parseMonth(prevKey);

  const [now, before, collectedNow, collectedBefore, plans, schemes] = await Promise.all([
    revenueByRep(month.from, month.to, repId),
    revenueByRep(prev.from, prev.to, repId),
    collectedByRepBrand(month.from, month.to, repId),
    collectedByRepBrand(prev.from, prev.to, repId),
    prisma.salesPlan.findMany({
      where: { period: "MONTH", periodStart: month.periodStart, brandId: null, repId },
      select: { metric: true, targetValue: true },
    }),
    resolveSchemes([repId], month.to),
  ]);

  const daysTotal = Math.round((month.to.getTime() - month.from.getTime()) / DAY_MS);
  const isCurrentMonth = kyivDate(new Date()).slice(0, 7) === monthKey;
  const daysPassed = isCurrentMonth ? Number(today.slice(8, 10)) : daysTotal;

  const targetOf = (metric: "REVENUE" | "COLLECTED_AMOUNT") =>
    plans.find((p) => p.metric === metric)?.targetValue ?? 0;

  const build = (
    ключ: ForecastMetric["ключ"],
    назва: string,
    factValue: number,
    prevValue: number,
    target: number
  ): { row: ForecastMetric; rate: RunRate } => {
    const rate = runRate(factValue, target, daysPassed, daysTotal);
    return {
      rate,
      row: {
        ключ,
        назва,
        факт: uah(factValue),
        темп_на_день: uah(rate.actualPerDay),
        прогноз: uah(rate.projected),
        минулий_місяць: uah(prevValue),
        зміна_до_минулого_відсотків:
          prevValue > 0 ? pct(((rate.projected - prevValue) / prevValue) * 100) : null,
        план: uah(target),
        виконання_відсотків:
          target > 0 ? pct(attainmentPercent(ключ === "revenue" ? "REVENUE" : "COLLECTED_AMOUNT", factValue, target)) : null,
        прогнозоване_виконання_відсотків: target > 0 ? pct(rate.projectedAttainment) : null,
        треба_на_день: rate.requiredPerDay != null ? uah(rate.requiredPerDay) : null,
        лишилось_добрати: target > 0 ? uah(rate.remaining) : null,
      },
    };
  };

  const revenue = build(
    "revenue",
    "Оборот",
    now[0]?.amount ?? 0,
    before[0]?.amount ?? 0,
    targetOf("REVENUE")
  );
  const collected = build(
    "collected",
    "Зібрано грошей",
    collectedTotals(collectedNow).get(repId)?.amount ?? 0,
    collectedTotals(collectedBefore).get(repId)?.amount ?? 0,
    targetOf("COLLECTED_AMOUNT")
  );

  const rules = (schemes.get(repId)?.rules ?? []).filter((r) => BONUS_TYPES.has(r.type));
  const бонуси = rules.map((r) => {
    const поріг = r.thresholdFrom ?? 100;
    const прогноз =
      r.planMetric === "COLLECTED_AMOUNT"
        ? collected.row.прогнозоване_виконання_відсотків
        : revenue.row.прогнозоване_виконання_відсотків;
    return {
      правило: r.type === "PLAN_BONUS_FIXED" ? `Бонус ${uah(r.value)} ₴ за план` : r.type === "PLAN_BONUS_PERCENT" ? `Бонус ${r.value} % за план` : `Ставка ${r.value} % від виконання`,
      поріг_відсотків: pct(поріг),
      прогноз_відсотків: прогноз,
      спрацює: прогноз == null ? null : прогноз >= поріг,
    };
  });

  const noPlan = revenue.row.план === 0 && collected.row.план === 0;

  return {
    місяць: monthKey,
    минулий_місяць: prevKey,
    днів_минуло: daysPassed,
    днів_усього: daysTotal,
    днів_лишилось: Math.max(0, daysTotal - daysPassed),
    показники: [revenue.row, collected.row],
    бонуси,
    примітка: noPlan
      ? "плану на цей місяць немає — орієнтир минулий місяць"
      : rules.length === 0
        ? "схема мотивації без правил — бонус не рахується"
        : null,
  };
}

/** Ключ місяця зі зсувом: «2026-09» + (−1) → «2026-08». */
function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
