/**
 * Інструменти про гроші: дебіторка й продажі за період.
 *
 * Обидва рахуються ЛИШЕ по своєму торговому — repId приходить зі скоупу
 * розмови, а не з аргументів. Тому в схемах немає й натяку на «покажи
 * чужі»: те, чого модель не може попросити, вона не може й видати.
 */

import type { ToolDef } from "@/lib/assistant/types";
import { day as validDay, enumOf, int } from "@/lib/assistant/validate";
import {
  receivableRowsByRep,
  sumAging,
  toDebtorList,
} from "@/lib/analytics/money-facts";
import { BUCKET_LABELS } from "@/lib/erp/receivables";
import { payerVerdicts, verdictLabel } from "@/lib/assistant/facts/discipline-cache";
import { repSalesSummary } from "@/lib/assistant/facts/sales-summary";
import { teamBenchmark } from "@/lib/analytics/benchmark";
import { METRICS, type MetricKey } from "@/lib/analytics/benchmarkMetrics";
import { kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { shiftDay } from "@/lib/analytics/period";
import { ANALYTICS_SINCE_DAY } from "@/lib/analytics/since";
import { pct, uah, ymd } from "@/lib/assistant/format";

export const receivables: ToolDef = {
  name: "receivables",
  label: "Дивлюся борги",
  description:
    "Дебіторка торгового: підсумок, розбивка за строками і список боржників із простроченою сумою, віком найстарішої частини й вердиктом платника. Питання про борги, «хто винен», «кому нагадати про гроші».",
  parameters: {
    type: "object",
    properties: {
      sort: { type: "string", description: "overdue (за простроченою, за замовчуванням) або debt (за загальною сумою)." },
      minOverdue: { type: "integer", description: "Показувати лише тих, у кого прострочено більше за цю суму, грн." },
      limit: { type: "integer", description: "Скільки боржників повернути, до 30. За замовчуванням 15." },
    },
  },
  async run(ctx, args) {
    const sort = enumOf(args.sort, "sort", ["overdue", "debt"] as const, "overdue");
    const minOverdue = int(args.minOverdue, "minOverdue", { min: 0, max: 10_000_000, fallback: 0 });
    const limit = int(args.limit, "limit", { min: 1, max: 30, fallback: 15 });

    const [rows, discipline] = await Promise.all([
      receivableRowsByRep(ctx.scope.repId),
      payerVerdicts(),
    ]);

    const total = sumAging(rows);
    let debtors = toDebtorList(rows).filter((d) => d.debt > 0.01 && d.overdue >= minOverdue);
    if (sort === "debt") debtors = [...debtors].sort((a, b) => b.debt - a.debt);

    const synced = rows.reduce<Date | null>(
      (max, r) => (r.syncedAt && (!max || r.syncedAt > max) ? r.syncedAt : max),
      null
    );

    return {
      торговий: ctx.scope.repName,
      підсумок: {
        всього: uah(total.total),
        робоча: uah(total.current),
        прострочено: uah(total.overdue),
        частка_простроченої_відсотків: pct(total.overdueRatio),
        борг_без_відвантажень: uah(total.unknown),
        боржників: debtors.length,
        дані_1с_на: ymd(synced),
      },
      за_строками: Object.entries(total.buckets).map(([bucket, amount]) => ({
        строк: BUCKET_LABELS[bucket as keyof typeof BUCKET_LABELS] ?? bucket,
        сума: uah(amount as number),
      })),
      боржники: debtors.slice(0, limit).map((d) => ({
        клієнт_id: d.counterpartyId,
        назва: d.name,
        борг: uah(d.debt),
        прострочено: uah(d.overdue),
        робоча: uah(d.current),
        найстаріший_днів: d.oldestDays,
        борг_старший_за_історію: uah(d.unknownDebt) || null,
        вердикт: verdictLabel(discipline.verdicts.get(d.counterpartyId)),
        останній_документ: d.lastDocAt ? d.lastDocAt.slice(0, 10) : null,
      })),
      примітка:
        "борг береться з 1С загальною сумою; вік відновлено розкладанням сальдо по датах наших відвантажень, тому «найстаріший_днів» — оцінка",
    };
  },
};

export const salesSummary: ToolDef = {
  name: "sales_summary",
  label: "Рахую продажі за період",
  description:
    "Продажі торгового за період: сума, реалізації, клієнти, середній чек, вал і рентабельність, повернення, зібрані гроші, розріз по брендах, порівняння з попереднім таким самим періодом і виконання місячного плану. Рахуються РЕАЛІЗАЦІЇ (відвантажене), а не замовлення.",
  parameters: {
    type: "object",
    properties: {
      days: { type: "integer", description: "Останні N днів, 1..365. За замовчуванням 30." },
      fromIso: { type: "string", description: "Початок періоду 2026-08-01 (разом із toIso має пріоритет над days)." },
      toIso: { type: "string", description: "Кінець періоду 2026-08-31." },
      byBrand: { type: "boolean", description: "Додати розріз по брендах. За замовчуванням true." },
      compareWithTeam: {
        type: "boolean",
        description:
          "Додати місце в команді й порівняння за оборотом, чеком, поверненнями, простроченою та динамікою. Поле «позаду_вас_відсотків_команди» — яка частка колег слабша за цим показником (це НЕ відсоток виконання). Вмикай, коли питання про «чому гірше», «як я проти інших», «де провисаю».",
      },
    },
  },
  async run(ctx, args) {
    const hasRange = Boolean(args.fromIso && args.toIso);
    const days = int(args.days, "days", { min: 1, max: 365, fallback: 30 });

    let fromDay = hasRange
      ? validDay(args.fromIso, "fromIso", ctx.today)
      : shiftDay(ctx.today, -(days - 1));
    const toDay = hasRange ? validDay(args.toIso, "toIso", ctx.today) : ctx.today;
    if (fromDay > toDay) fromDay = toDay;

    // Нижня межа аналітики: до неї в базі лежать самі повернення без
    // реалізацій, і період віддав би від'ємний оборот.
    const clamped = fromDay < ANALYTICS_SINCE_DAY;
    if (clamped) fromDay = ANALYTICS_SINCE_DAY;

    const period = {
      fromDay,
      toDay,
      from: kyivDayStart(fromDay),
      to: kyivDayEnd(toDay),
      days:
        Math.round(
          (kyivDayStart(toDay).getTime() - kyivDayStart(fromDay).getTime()) / 86_400_000
        ) + 1,
      clamped,
    };

    const summary = await repSalesSummary(ctx.scope.repId, period, {
      byBrand: args.byBrand !== false,
    });

    // Порівняння з командою окремим прапорцем, а не окремим інструментом:
    // схема кожного інструмента коштує токенів у КОЖНОМУ запиті ходу, а
    // питання «як я проти інших» — це той самий період і той самий торговий.
    const team = args.compareWithTeam === true ? await teamSlice(ctx.scope.repId, period) : null;

    return {
      торговий: ctx.scope.repName,
      ...summary,
      ...(team ? { порівняння_з_командою: team } : {}),
      ...(clamped
        ? { увага: `історія реалізацій починається з ${ANALYTICS_SINCE_DAY}, період обрізано` }
        : {}),
    };
  },
};

/**
 * Місце торгового в команді — без чужих сум.
 *
 * Модель має бачити СВОЄ значення, свій перцентиль і медіану. Чужі прізвища
 * з оборотами тут зайві: питання завжди про «мене», а видача чужих чисел
 * торговому — окреме рішення, якого ніхто не ухвалював.
 */
async function teamSlice(repId: string, period: Parameters<typeof repSalesSummary>[1]) {
  const report = await teamBenchmark(period);
  const me = report.reps.find((r) => r.repId === repId);
  if (!me || !report.comparable) {
    return { примітка: "порівняння недоступне: замало торгових із продажами за період" };
  }

  const keys: MetricKey[] = [
    "revenue",
    "avgCheck",
    "collected",
    "skuPerClient",
    "overdueRatio",
    "returnRatio",
    "momentumPct",
  ];

  return {
    місце_за_оборотом: me.place,
    торгових_у_порівнянні: report.reps.length,
    показники: keys
      .filter((k) => me.ranks[k] != null)
      .map((k) => ({
        показник: METRICS[k].label,
        моє: me[k],
        позаду_вас_відсотків_команди: Math.round(me.ranks[k]!),
        медіана_команди: report.medians[k],
        більше_краще: METRICS[k].higherIsBetter,
      })),
  };
}
