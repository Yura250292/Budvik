/**
 * Інструменти про день і маршрут: де торговий сьогодні, куди звик їздити,
 * кого варто відвідати.
 *
 * Контекст дня свідомо один великий інструмент, а не п'ять маленьких. У
 * питанні «сплануй день» модель однаково потребує всього одразу — плану,
 * боргів, портфеля й сьогоднішніх замовлень, — і п'ять окремих викликів
 * означали б п'ять раундів і півхвилини очікування замість одного.
 */

import type { ToolDef } from "@/lib/assistant/types";
import { day as validDay, int } from "@/lib/assistant/validate";
import { resolveRouteForDay } from "@/lib/routes/resolve";
import { ordersSummaryForRep } from "@/lib/track/orders-today";
import { prisma } from "@/lib/prisma";
import { revenueByRep } from "@/lib/analytics/facts";
import { clientPortfolio } from "@/lib/analytics/clients";
import { receivableRowsByRep, sumAging } from "@/lib/analytics/money-facts";
import { repActionCandidates, ACTION_LABELS } from "@/lib/analytics/company/rep-actions";
import { attainmentPercent, runRate } from "@/lib/motivation/engine";
import { parseMonth, shiftDay } from "@/lib/analytics/period";
import { kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { pct, uah, days as roundDays } from "@/lib/assistant/format";
import { routeHabits, WEEKDAY_NAMES } from "@/lib/assistant/facts/route-habits";
import { dayRouteCandidates } from "@/lib/assistant/facts/day-candidates";
import { driverDayFacts } from "@/lib/assistant/facts/driver-day";

const DAY_MS = 86_400_000;

function omitWeight<T extends { вага: number }>(row: T): Omit<T, "вага"> {
  const { вага: _weight, ...rest } = row;
  void _weight;
  return rest;
}

export const myDayContext: ToolDef = {
  name: "my_day_context",
  label: "Дивлюся, як іде день",
  description:
    "Загальна картина дня торгового: маршрут за розкладом, замовлення й візити за сьогодні, чи відкрита зміна, виконання місячного плану, дебіторка, склад портфеля клієнтів і кілька найтерміновіших дій. Викликай першим на питання про план дня, «як у мене справи», «що робити сьогодні».",
  parameters: {
    type: "object",
    properties: {
      dayIso: { type: "string", description: "День у форматі 2026-09-04. За замовчуванням — сьогодні." },
    },
  },
  async run(ctx, args) {
    const target = validDay(args.dayIso, "dayIso", ctx.today);
    const repId = ctx.scope.repId;

    const fromDay = shiftDay(target, -29);
    const period = {
      fromDay,
      toDay: target,
      from: kyivDayStart(fromDay),
      to: kyivDayEnd(target),
      days: 30,
      clamped: false,
    };
    const monthRange = parseMonth(target.slice(0, 7));

    const [route, orders, visits, shift, monthRevenue, plan, receivables, portfolio, actions] =
      await Promise.all([
        resolveRouteForDay(repId, target),
        ordersSummaryForRep(repId, target),
        prisma.visit.findMany({
          where: { userId: repId, day: kyivDayStart(target) },
          select: {
            status: true,
            money: true,
            collectedAmount: true,
            counterparty: { select: { id: true, name: true } },
          },
        }),
        prisma.shift.findFirst({
          where: { userId: repId, status: "OPEN" },
          select: { startedAt: true, distanceKm: true },
        }),
        revenueByRep(monthRange.from, monthRange.to, repId),
        prisma.salesPlan.findFirst({
          where: {
            period: "MONTH",
            metric: "REVENUE",
            periodStart: monthRange.periodStart,
            brandId: null,
            repId,
          },
          select: { targetValue: true },
        }),
        receivableRowsByRep(repId),
        clientPortfolio(repId, period),
        repActionCandidates(repId, period),
      ]);

    const aging = sumAging(receivables);
    const target_ = plan?.targetValue ?? 0;
    const monthActual = monthRevenue[0]?.amount ?? 0;

    const isCurrentMonth = ctx.today.slice(0, 7) === target.slice(0, 7);
    const daysTotal = Math.round((monthRange.to.getTime() - monthRange.from.getTime()) / DAY_MS);
    const daysPassed = isCurrentMonth ? Number(ctx.today.slice(8, 10)) : daysTotal;
    const rate = target_ > 0 ? runRate(monthActual, target_, daysPassed, daysTotal) : null;

    const weekday = WEEKDAY_NAMES[(new Date(`${target}T12:00:00Z`).getUTCDay() + 6) % 7];

    return {
      день: target,
      день_тижня: weekday,
      торговий: ctx.scope.repName,
      маршрут_за_розкладом: route
        ? { назва: route.name, пункти: route.stops.map((s) => s.displayName ?? s.settlement) }
        : null,
      зміна: shift
        ? { стан: "відкрита", з: shift.startedAt.toISOString().slice(11, 16), км: Math.round(shift.distanceKm ?? 0) }
        : { стан: "не відкрита" },
      замовлення_сьогодні: {
        проведених: orders.count,
        сума: uah(orders.totalUah),
        чернеток: orders.draftCount,
        сума_чернеток: uah(orders.draftUah),
      },
      візити_сьогодні: visits.slice(0, 12).map((v) => ({
        клієнт_id: v.counterparty?.id ?? null,
        назва: v.counterparty?.name ?? "—",
        статус: v.status === "DONE" ? "був" : "не заїхав",
        забрав: v.collectedAmount ? uah(v.collectedAmount) : null,
      })),
      план_місяця: {
        план: uah(target_),
        факт: uah(monthActual),
        виконання_відсотків:
          target_ > 0 ? pct(attainmentPercent("REVENUE", monthActual, target_)) : null,
        лишилось_добрати: rate ? uah(rate.remaining) : null,
        треба_на_день: rate?.requiredPerDay != null ? uah(rate.requiredPerDay) : null,
        примітка: target_ > 0 ? null : "план на цей місяць не заведено",
      },
      дебіторка: {
        всього: uah(aging.total),
        прострочено: uah(aging.overdue),
        частка_простроченої_відсотків: pct(aging.overdueRatio),
        боржників: receivables.filter((r) => r.debt > 0.01).length,
      },
      портфель: portfolio.counts,
      термінові_дії: actions.slice(0, 5).map((a) => ({
        клієнт_id: a.counterpartyId,
        назва: a.name,
        дія: ACTION_LABELS[a.kind],
        чому: a.why,
        прострочено: uah(a.overdue),
      })),
    };
  },
};

export const routeHabitsTool: ToolDef = {
  name: "route_habits",
  label: "Дивлюся звичні маршрути",
  description:
    "Куди торговий звично їздить по днях тижня за останні тижні: клієнти з кількістю замовлень, відміток візитів і зупинок треку, а також шаблон маршруту, якщо він заведений. Питання «який у мене маршрут у четвер», «де я зазвичай буваю в понеділок».",
  parameters: {
    type: "object",
    properties: {
      weekday: { type: "integer", description: "День тижня 1..7 (1 — понеділок). Без нього — усі дні." },
      weeks: { type: "integer", description: "Скільки тижнів назад дивитись, 4..12. За замовчуванням 8." },
    },
  },
  async run(ctx, args) {
    const weeks = int(args.weeks, "weeks", { min: 4, max: 12, fallback: 8 });
    const weekday = args.weekday == null ? null : int(args.weekday, "weekday", { min: 1, max: 7, fallback: 1 });

    const habits = await routeHabits(ctx.scope.repId, weeks);
    const days = weekday ? habits.byWeekday.filter((d) => d.weekday === weekday) : habits.byWeekday;

    return {
      тижнів: habits.weeks,
      по_днях: days
        .filter((d) => d.clients.length > 0 || d.template)
        .map((d) => ({
          день_тижня: WEEKDAY_NAMES[d.weekday - 1],
          шаблон: d.template,
          клієнти: d.clients.map((c) => ({
            клієнт_id: c.counterpartyId,
            назва: c.name,
            замовлень: c.orders,
            візитів: c.visits,
            зупинок: c.stops,
            хвилин_на_точці: c.minutesAtPoint || null,
            останній_раз: c.lastAt,
          })),
        })),
      примітка:
        "замовлення важать більше за зупинки: зупинка каже лише, що людина стояла поруч, а замовлення — що вийшов результат",
    };
  },
};

export const dayRouteCandidatesTool: ToolDef = {
  name: "day_route_candidates",
  label: "Збираю кандидатів на день",
  description:
    "Готовий список клієнтів, до яких варто заїхати в конкретний день: звичні для цього дня тижня плюс ті, з ким терміново треба поговорити (борг, ризик втрати, давно не брав). Кожен рядок має підстави, борг і ритм. Викликай для складання плану дня — і бери клієнтів ЛИШЕ з цього списку.",
  parameters: {
    type: "object",
    properties: {
      dayIso: { type: "string", description: "День у форматі 2026-09-04. За замовчуванням — сьогодні." },
      limit: { type: "integer", description: "Скільки кандидатів повернути, до 15. За замовчуванням 12." },
    },
  },
  async run(ctx, args) {
    const target = validDay(args.dayIso, "dayIso", ctx.today);
    const limit = int(args.limit, "limit", { min: 3, max: 15, fallback: 12 });
    const result = await dayRouteCandidates(ctx.scope.repId, target, limit);
    return {
      ...result,
      // «вага» — внутрішній порядок сортування; моделі вона нічого не
      // додає, а місце в контексті займає.
      кандидати: result.кандидати.map((c) => {
        const row = omitWeight(c);
        return {
          ...row,
          днів_з_останньої: row.днів_з_останньої == null ? null : roundDays(row.днів_з_останньої),
        };
      }),
    };
  },
};

export const driverDayTool: ToolDef = {
  name: "driver_day",
  label: "Дивлюся маршрут на день",
  kinds: ["DRIVER"],
  description:
    "Маршрут водія на день: точки по порядку з адресою, телефоном і приміткою логіста, скільки грошей забрати на кожній, що вже відмічено, і каса за день. Викликай на будь-яке питання про сьогоднішню роботу водія.",
  parameters: {
    type: "object",
    properties: {
      dayIso: { type: "string", description: "День у форматі 2026-09-04. За замовчуванням — сьогодні." },
    },
  },
  async run(ctx, args) {
    const target = validDay(args.dayIso, "dayIso", ctx.today);
    const facts = await driverDayFacts(ctx.scope.repId, target);

    return {
      день: facts.day,
      маршрут: {
        джерело:
          facts.route.source === "ROUTE_SHEET"
            ? "маршрутний лист 1С"
            : facts.route.source === "DELIVERY_ROUTE"
              ? "маршрут із сайту"
              : "маршруту немає",
        номер: facts.route.number,
        авто: facts.route.vehicle,
        план_км: facts.route.plannedKm,
      },
      разом: {
        точок: facts.totals.stops,
        відмічено: facts.totals.done,
        товару_на: uah(facts.totals.amount),
        забрати_грошей: uah(facts.totals.debt),
      },
      каса: {
        зібрано: uah(facts.cash.collected),
        здано: uah(facts.cash.handed),
        на_руках: uah(facts.cash.onHands),
      },
      точки: facts.stops.map((s) => ({
        порядок: s.seq,
        клієнт_id: s.counterpartyId,
        назва: s.name,
        адреса: s.address,
        телефон: s.phone,
        вид: s.kind === "DELIVERY" ? "доставка" : s.kind === "PICKUP" ? "забрати" : "доручення",
        товару_на: uah(s.amount),
        забрати: uah(s.debt),
        примітка: s.notes,
        відмічено: s.done,
        точка_на_карті: s.hasPin,
      })),
    };
  },
};
