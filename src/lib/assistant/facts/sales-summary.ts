/**
 * Продажі торгового за період — і за попередній такий самий поруч.
 *
 * Порівняння тут не прикраса: «за тиждень 180 тис.» не означає нічого,
 * поки не видно, що минулого тижня було 240. Модель без цієї пари або
 * мовчить про динаміку, або вигадує її з повітря.
 *
 * План рахується за КАЛЕНДАРНИЙ МІСЯЦЬ, навіть коли період інший — саме
 * так його ставлять і саме так дивиться керівник. Три різні відрізки часу
 * в одній відповіді — головна пастка цього блоку, тому кожен підписаний
 * своїм полем.
 */

import { prisma } from "@/lib/prisma";
import {
  revenueByRep,
  revenueByRepBrand,
  returnsByClient,
  skuCountByRep,
} from "@/lib/analytics/facts";
import { collectedByRepBrand, collectedTotals } from "@/lib/analytics/money-facts";
import { attainmentPercent, runRate } from "@/lib/motivation/engine";
import { parseMonth, type Period } from "@/lib/analytics/period";
import { kyivDate } from "@/lib/date/kyiv";
import { pct, uah } from "@/lib/assistant/format";

const DAY_MS = 86_400_000;

/** Попередній відрізок такої самої довжини, впритул до нашого. */
function previousWindow(period: Period): { from: Date; to: Date } {
  const span = period.to.getTime() - period.from.getTime();
  return {
    from: new Date(period.from.getTime() - span - 1),
    to: new Date(period.from.getTime() - 1),
  };
}

const change = (now: number, before: number): number | null =>
  before > 0 ? pct(((now - before) / before) * 100) : null;

export async function repSalesSummary(
  repId: string,
  period: Period,
  opts: { compare?: boolean; byBrand?: boolean } = {}
) {
  const compare = opts.compare !== false;
  const byBrand = opts.byBrand !== false;
  const prev = previousWindow(period);

  const monthKey = period.toDay.slice(0, 7);
  const monthRange = parseMonth(monthKey);

  const [current, previous, brands, sku, returns, collected, plan, monthRevenue] =
    await Promise.all([
      revenueByRep(period.from, period.to, repId),
      compare ? revenueByRep(prev.from, prev.to, repId) : Promise.resolve([]),
      byBrand ? revenueByRepBrand(period.from, period.to, repId) : Promise.resolve([]),
      skuCountByRep(period.from, period.to, repId),
      returnsByClient(period.from, period.to, repId, 5),
      collectedByRepBrand(period.from, period.to, repId),
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
      revenueByRep(monthRange.from, monthRange.to, repId),
    ]);

  const now = current[0];
  const before = previous[0];
  const total = sku.find((s) => s.isTotal);
  const money = collectedTotals(collected).get(repId) ?? { amount: 0, profit: 0 };

  const monthActual = monthRevenue[0]?.amount ?? 0;
  const target = plan?.targetValue ?? 0;

  // Темп рахуємо лише всередині поточного місяця: для минулого «встигає
  // чи ні» вже не питання, а відповідь була б безглуздою.
  const today = kyivDate(new Date());
  const isCurrentMonth = today.slice(0, 7) === monthKey;
  const daysTotal = Math.round(
    (monthRange.to.getTime() - monthRange.from.getTime()) / DAY_MS
  );
  const daysPassed = isCurrentMonth ? Number(today.slice(8, 10)) : daysTotal;
  const rate = target > 0 ? runRate(monthActual, target, daysPassed, daysTotal) : null;

  const amount = now?.amount ?? 0;
  const docs = now?.docs ?? 0;

  return {
    період: { з: period.fromDay, по: period.toDay, днів: period.days },
    підсумок: {
      сума: uah(amount),
      реалізацій: docs,
      клієнтів: now?.clients ?? 0,
      середній_чек: docs > 0 ? uah(amount / docs) : 0,
      вал: uah(now?.profit ?? 0),
      рентабельність_відсотків:
        now && now.costedAmount > 0 ? pct((now.profit / now.costedAmount) * 100) : null,
      повернення: uah(now?.returns ?? 0),
      позицій: total?.sku ?? 0,
      зібрано_грошей: uah(money.amount),
    },
    попередній_період: compare
      ? {
          з: kyivDate(prev.from),
          по: kyivDate(prev.to),
          сума: uah(before?.amount ?? 0),
          реалізацій: before?.docs ?? 0,
          зміна_суми_відсотків: change(amount, before?.amount ?? 0),
        }
      : null,
    план_місяця: {
      місяць: monthKey,
      план: uah(target),
      факт: uah(monthActual),
      виконання_відсотків: target > 0 ? pct(attainmentPercent("REVENUE", monthActual, target)) : null,
      прогноз_на_кінець: rate ? uah(rate.projected) : null,
      лишилось_добрати: rate ? uah(rate.remaining) : null,
      треба_на_день: rate?.requiredPerDay != null ? uah(rate.requiredPerDay) : null,
      примітка: target > 0 ? null : "план на цей місяць не заведено",
    },
    бренди: brands
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map((b) => ({
        бренд: b.brandName ?? "Без бренду",
        сума: uah(b.amount),
        кількість: Math.round(b.qty),
        вал: uah(b.profit),
      })),
    повернення_по_клієнтах: returns.map((r) => ({
      клієнт_id: r.clientId,
      назва: r.clientName ?? "—",
      сума: uah(r.amount),
      документів: r.docs,
    })),
  };
}
