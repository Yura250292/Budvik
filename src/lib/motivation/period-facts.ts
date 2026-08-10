/**
 * Місток між базою і рушієм мотивації.
 *
 * Рушій (engine.ts) — чиста функція: дай їй правила і факти за період,
 * отримаєш нарахування. Досі фактів ніхто не збирав, тож рушій не мав
 * жодного виклику. Тут вони збираються.
 *
 * Дві різні часові рамки, і це навмисно:
 *   • зібрані кошти — за точний обраний період;
 *   • виконання планів — за КАЛЕНДАРНИЙ МІСЯЦЬ, бо план місячний.
 * Рахувати план за довільним «останні 12 днів» безглуздо: 40% виконання
 * за третину місяця — це нормальний темп, а не провал.
 *
 * Дебіторка — знімок на «зараз» (див. money-facts.ts).
 */

import type { PlanMetric } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseMonth, type Period } from "@/lib/analytics/period";
import { revenueByRep, revenueByRepBrand } from "@/lib/analytics/facts";
import {
  collectedByRepBrand,
  collectedTotals,
  collectedByBrand,
  receivableRowsByRep,
  agingByRep,
  debtDeltaByRep,
  type CollectedRow,
  type ReceivableRow,
} from "@/lib/analytics/money-facts";
import {
  calculateMotivation,
  attainmentPercent,
  type PeriodFacts,
  type MotivationResult,
  type Rule,
} from "./engine";

export type ResolvedScheme = { schemeId: string; schemeName: string; rules: Rule[] };

/**
 * Яка схема діяла для кожного торгового на дату `asOf`.
 *
 * asOf — кінець періоду, а не «зараз»: перерахунок минулого місяця має
 * дати ті самі гроші, навіть якщо торгового відтоді перевели на іншу
 * схему. Заради цього в MotivationAssignment і зберігається історія.
 *
 * Торговий без призначення підпадає під типову схему (isDefault). Якщо
 * і такої немає — його немає в мапі, і UI покаже «—», а не нуль:
 * «заробив 0» і «нема за чим рахувати» — різні речі.
 */
export async function resolveSchemes(repIds: string[], asOf: Date): Promise<Map<string, ResolvedScheme>> {
  if (repIds.length === 0) return new Map();

  const [assignments, defaultScheme] = await Promise.all([
    prisma.motivationAssignment.findMany({
      where: {
        repId: { in: repIds },
        validFrom: { lte: asOf },
        OR: [{ validTo: null }, { validTo: { gte: asOf } }],
      },
      orderBy: { validFrom: "desc" },
      include: { scheme: { include: { rules: { where: { isActive: true } } } } },
    }),
    prisma.motivationScheme.findFirst({
      where: { isDefault: true, isActive: true },
      include: { rules: { where: { isActive: true } } },
    }),
  ]);

  const toRules = (rules: typeof assignments[number]["scheme"]["rules"]): Rule[] =>
    rules.map((r) => ({
      id: r.id,
      type: r.type,
      sortOrder: r.sortOrder,
      brandId: r.brandId,
      categoryGroup: r.categoryGroup,
      value: r.value,
      planMetric: r.planMetric,
      thresholdFrom: r.thresholdFrom,
      thresholdTo: r.thresholdTo,
      overdueTolerance: r.overdueTolerance,
    }));

  const result = new Map<string, ResolvedScheme>();

  // orderBy validFrom desc — перше призначення для торгового найсвіжіше
  for (const a of assignments) {
    if (result.has(a.repId)) continue;
    if (!a.scheme.isActive) continue;
    result.set(a.repId, { schemeId: a.scheme.id, schemeName: a.scheme.name, rules: toRules(a.scheme.rules) });
  }

  if (defaultScheme) {
    for (const repId of repIds) {
      if (result.has(repId)) continue;
      result.set(repId, {
        schemeId: defaultScheme.id,
        schemeName: `${defaultScheme.name} (типова)`,
        rules: toRules(defaultScheme.rules),
      });
    }
  }

  return result;
}

/** Дані, які можна передати ззовні, щоб не робити ті самі запити двічі. */
export type PreloadedFacts = {
  collected?: CollectedRow[];
  receivables?: ReceivableRow[];
};

/**
 * Виконання планів за місяць: `${metric}:${brandId ?? "ALL"}` → відсоток.
 *
 * Наразі реально рахуються REVENUE (оборот) і COLLECTED_AMOUNT (зібране)
 * — решта метрик є в enum, але їх ніде не планують. Правило, що
 * посилається на непораховану метрику, просто не дає рядка: рушій
 * трактує відсутній ключ як «плану немає».
 */
async function planAttainmentByRep(
  month: string,
  repIds: string[],
  collectedInMonth: CollectedRow[]
): Promise<Map<string, Map<string, number>>> {
  const { periodStart, from, to } = parseMonth(month);

  const [plans, revByRep, revByBrand] = await Promise.all([
    prisma.salesPlan.findMany({
      where: { period: "MONTH", periodStart, repId: { in: repIds } },
      select: { repId: true, brandId: true, metric: true, targetValue: true },
    }),
    revenueByRep(from, to),
    revenueByRepBrand(from, to),
  ]);

  const revenueTotal = new Map(revByRep.map((r) => [r.repId, r.amount]));
  const revenueBrand = new Map<string, number>();
  for (const row of revByBrand) {
    if (!row.brandId) continue;
    revenueBrand.set(`${row.repId}::${row.brandId}`, row.amount);
  }

  const collectedTotal = collectedTotals(collectedInMonth);
  const collectedBrand = new Map<string, number>();
  for (const row of collectedInMonth) {
    if (!row.brandId) continue;
    const key = `${row.repId}::${row.brandId}`;
    collectedBrand.set(key, (collectedBrand.get(key) ?? 0) + row.amount);
  }

  const actualFor = (metric: PlanMetric, repId: string, brandId: string | null): number | null => {
    const key = `${repId}::${brandId ?? ""}`;
    if (metric === "REVENUE") {
      return brandId ? revenueBrand.get(key) ?? 0 : revenueTotal.get(repId) ?? 0;
    }
    if (metric === "COLLECTED_AMOUNT") {
      return brandId ? collectedBrand.get(key) ?? 0 : collectedTotal.get(repId)?.amount ?? 0;
    }
    return null; // метрику поки не рахуємо
  };

  const result = new Map<string, Map<string, number>>();
  for (const plan of plans) {
    if (!plan.repId) continue;
    const actual = actualFor(plan.metric, plan.repId, plan.brandId);
    if (actual == null) continue;

    const map = result.get(plan.repId) ?? new Map<string, number>();
    map.set(
      `${plan.metric}:${plan.brandId ?? "ALL"}`,
      attainmentPercent(plan.metric, actual, plan.targetValue)
    );
    result.set(plan.repId, map);
  }
  return result;
}

/** Факти за період для кожного торгового — вхід рушія. */
export async function buildPeriodFacts(
  repIds: string[],
  period: Pick<Period, "from" | "to">,
  month: string,
  preloaded: PreloadedFacts = {}
): Promise<Map<string, PeriodFacts>> {
  const monthRange = parseMonth(month);

  const [collected, receivables] = await Promise.all([
    preloaded.collected ?? collectedByRepBrand(period.from, period.to),
    preloaded.receivables ?? receivableRowsByRep(),
  ]);

  // Плани місячні, тож зібране для них треба теж за місяць, а не за
  // обраний період. Якщо період і є цим місяцем — другого запиту нема.
  const sameWindow =
    period.from.getTime() === monthRange.from.getTime() && period.to.getTime() === monthRange.to.getTime();
  const collectedInMonth = sameWindow
    ? collected
    : await collectedByRepBrand(monthRange.from, monthRange.to);

  const [attainment, revenue, debtDelta] = await Promise.all([
    planAttainmentByRep(month, repIds, collectedInMonth),
    revenueByRep(period.from, period.to),
    debtDeltaByRep(period.from, period.to),
  ]);

  const aging = agingByRep(receivables);
  const totals = collectedTotals(collected);
  const revenueByRepId = new Map(revenue.map((r) => [r.repId, r]));

  const result = new Map<string, PeriodFacts>();
  for (const repId of repIds) {
    const money = totals.get(repId) ?? { amount: 0, profit: 0 };
    const debt = aging.get(repId);
    const rev = revenueByRepId.get(repId);
    const delta = debtDelta.get(repId);

    // База нарахування — гроші, які реально зайшли.
    //
    // Основне джерело — рознесені оплати (PaymentAllocation): там точно
    // видно, хто скільки забрав.
    //
    // ПКО не несе прив'язки до торгового, тож її відновлює allocate() за
    // останнім документом клієнта. Доки цього шляху не було, таблиця
    // стояла порожня і працював лише запасний розрахунок нижче.
    //
    // Запасний лишається для торгового, у якого за період не зайшло
    // жодної рознесеної оплати: відвантажив на 100 тис., борг його
    // клієнтів виріс на 30 — реально приніс 70. Якщо борг зменшився,
    // торговий ще й старе позбирав, і база виходить більшою за оборот —
    // це чесно.
    const useCollected = money.amount > 0;
    const revenueAmount = rev?.amount ?? 0;
    const effective = useCollected
      ? money
      : {
          amount: Math.max(0, revenueAmount - (delta?.delta ?? 0)),
          // Прибуток масштабуємо в тій же пропорції: маржа по зібраному
          // вважається такою ж, як по відвантаженому.
          profit:
            revenueAmount > 0
              ? (rev?.profit ?? 0) * (Math.max(0, revenueAmount - (delta?.delta ?? 0)) / revenueAmount)
              : 0,
        };

    result.set(repId, {
      collectedAmount: effective.amount,
      collectedProfit: effective.profit,
      byBrand: collectedByBrand(collected, repId),
      receivableTotal: debt?.total ?? 0,
      receivableOverdue: debt?.overdue ?? 0,
      planAttainment: attainment.get(repId) ?? new Map(),
    });
  }
  return result;
}

export type RepEarnings = MotivationResult & { schemeName: string };

/**
 * Скільки заробив кожен торговий за період.
 *
 * null у мапі не буває: торгові без схеми просто відсутні. Викликач
 * має показати «—» і підказку, а не нуль.
 */
export async function earningsByRep(
  repIds: string[],
  period: Pick<Period, "from" | "to">,
  month: string,
  preloaded: PreloadedFacts = {}
): Promise<Map<string, RepEarnings>> {
  if (repIds.length === 0) return new Map();

  const [schemes, facts, brands] = await Promise.all([
    resolveSchemes(repIds, period.to),
    buildPeriodFacts(repIds, period, month, preloaded),
    prisma.brand.findMany({ select: { id: true, name: true } }),
  ]);

  const brandNames = new Map(brands.map((b) => [b.id, b.name]));

  const result = new Map<string, RepEarnings>();
  for (const repId of repIds) {
    const scheme = schemes.get(repId);
    const repFacts = facts.get(repId);
    if (!scheme || !repFacts) continue;

    result.set(repId, {
      ...calculateMotivation(scheme.rules, repFacts, brandNames),
      schemeName: scheme.schemeName,
    });
  }
  return result;
}
