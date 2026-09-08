/**
 * Швидкий шлях: відповідь без моделі.
 *
 * Спершу пробуємо розпізнати намір правилами (router.ts) і скласти
 * відповідь кодом (answers.ts). Якщо не вийшло — питання йде моделі.
 *
 * Заміряно на бойових даних: типовий хід через модель — 20-30 тисяч
 * вхідних токенів і 12-30 секунд, і майже весь цей час вона переказує
 * готовий список, який код уже має. Ті самі десять питань торговий ставить
 * щодня, тож ця розвилка знімає більшу частину і рахунку, і очікування.
 *
 * Модель лишається для того, заради чого її й брали: зважити («чи давати
 * відстрочку»), пояснити («чому впав оборот»), звести кілька фактів
 * докупи. Перелічити — це робота коду.
 */

import { detectIntent } from "@/lib/assistant/router";
import {
  answerDigest,
  answerDriverPayroll,
  answerDriversDay,
  answerLowStock,
  answerMoneyFlows,
  answerSalesAnalysis,
  answerShifts,
  answerSiteOrders,
  answerSiteTraffic,
  answerStaffNow,
  answerSyncHealth,
  answerTeamCollected,
  answerTeamDebts,
  answerTeamForecast,
  answerTeamReturns,
  answerTeamSales,
} from "@/lib/assistant/answers-admin";
import { ownerRepOf } from "@/lib/assistant/facts/staff";
import { findClients } from "@/lib/assistant/facts/client-search";
import type { ToolContext } from "@/lib/assistant/types";
import type { DirectAnswer } from "@/lib/assistant/answers";
import {
  answerChurn,
  answerCityClients,
  answerClientCard,
  answerClientProduct,
  answerHelp,
  answerLastOrder,
  answerDayChoice,
  answerDayPlan,
  answerDeadStock,
  answerDebts,
  answerEntryOffer,
  answerProduct,
  answerAbcClients,
  answerBenchmark,
  answerDriverDay,
  answerForecast,
  answerBasket,
  answerNearby,
  answerRemind,
  answerRouteTo,
  answerReminders,
  answerPayments,
  answerSubstitute,
  answerRecommend,
  answerReturns,
  answerRoute,
  answerSales,
} from "@/lib/assistant/answers";
import { shiftDay } from "@/lib/analytics/period";

/** Найближчий такий день тижня, не рахуючи сьогоднішнього. */
function nextWeekday(today: string, weekday: number): string {
  const current = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const ahead = (weekday - current + 7) % 7;
  return shiftDay(today, ahead === 0 ? 7 : ahead);
}

export async function tryDirectAnswer(
  ctx: ToolContext,
  text: string,
  opts: { hasHistory: boolean; clientHint?: { id: string; name: string } | null }
): Promise<DirectAnswer | null> {
  const intent = detectIntent(text, {
    hasHistory: opts.hasHistory,
    hasClientHint: Boolean(opts.clientHint),
    kind: ctx.kind,
  });
  if (!intent) return null;

  /**
   * «З чим заходити?» без назви — це питання з картки клієнта.
   *
   * Коли помічник відкрито з картки, клієнт відомий, і перепитувати ім'я
   * там, де воно щойно було на екрані, — знущання. Без картки ж модель
   * розбереться краще: може, клієнта названо кількома словами вище.
   */
  const subjectOf = (raw: string | null) => raw ?? opts.clientHint?.name ?? null;

  switch (intent.kind) {
    case "DAY_PLAN": {
      if (intent.weekday) return answerDayPlan(ctx, nextWeekday(ctx.today, intent.weekday));
      if (intent.day === "ask") return answerDayChoice(ctx);
      return answerDayPlan(ctx, intent.day === "tomorrow" ? shiftDay(ctx.today, 1) : ctx.today);
    }

    case "DEBTS":
      return answerDebts(ctx);

    case "CHURN":
      return answerChurn(ctx);

    case "DEAD_STOCK":
      return answerDeadStock(ctx, intent.brand);

    case "SALES":
      return answerSales(ctx, intent.period);

    case "ROUTE":
      return answerRoute(ctx, intent.weekday);

    case "ENTRY_OFFER": {
      const subject = subjectOf(intent.subject);
      if (!subject) return null;
      return answerEntryOffer(await asOwnerRep(ctx, subject), subject);
    }

    case "RECOMMEND": {
      const subject = subjectOf(intent.subject);
      if (!subject) return null;
      return answerRecommend(await asOwnerRep(ctx, subject), subject);
    }

    case "HELP":
      return answerHelp(ctx);

    case "LAST_ORDER": {
      const subject = subjectOf(intent.subject);
      return subject ? answerLastOrder(ctx, subject) : null;
    }

    case "CLIENT_PRODUCT":
      return answerClientProduct(ctx, intent.subject, intent.product);

    case "CLIENT_CARD": {
      const subject = subjectOf(intent.subject);
      return subject ? answerClientCard(ctx, subject) : null;
    }

    case "BASKET":
      return answerBasket(ctx, intent.query);

    case "SUBSTITUTE":
      return answerSubstitute(ctx, intent.query);

    case "PRODUCT":
      return answerProduct(ctx, intent.query);

    case "RETURNS":
      return answerReturns(ctx, intent.period);

    case "BENCHMARK":
      return answerBenchmark(ctx, intent.period);

    case "ROUTE_TO":
      return answerRouteTo(ctx, intent.names);

    case "REMIND":
      return answerRemind(ctx, intent.text);

    case "REMINDERS":
      return answerReminders(ctx);

    case "CITY_CLIENTS":
      return answerCityClients(ctx, intent.city);

    case "NEARBY":
      return answerNearby(ctx, intent.radiusKm);

    case "PAYMENTS":
      return answerPayments(ctx, intent.period, subjectOf(intent.subject));

    case "FORECAST":
      return answerForecast(ctx);

    case "ABC_CLIENTS":
      return answerAbcClients(ctx, intent.period);

    case "DRIVER_DAY": {
      return answerDriverDay(ctx, dayOf(ctx.today, intent.day));
    }

    /* ── Керівник: те саме питання, але про всю фірму ─────────────────── */

    case "STAFF_NOW":
      return answerStaffNow(ctx, intent.who, intent.role);

    case "TEAM_SALES":
      return answerTeamSales(ctx, intent.period, intent.who);

    case "TEAM_DEBTS":
      return answerTeamDebts(ctx, intent.who);

    case "TEAM_COLLECTED":
      return answerTeamCollected(ctx, intent.period);

    case "TEAM_RETURNS":
      return answerTeamReturns(ctx, intent.period);

    case "TEAM_FORECAST":
      return answerTeamForecast(ctx);

    case "SHIFTS":
      return answerShifts(ctx, intent.period, intent.who);

    case "DRIVERS_DAY":
      return answerDriversDay(ctx, dayOf(ctx.today, intent.day));

    case "DRIVER_PAYROLL":
      return answerDriverPayroll(ctx, intent.period, intent.who);

    case "SITE_ORDERS":
      return answerSiteOrders(ctx, intent.period);

    case "LOW_STOCK":
      return answerLowStock(ctx, intent.brand, intent.mode);

    case "SYNC_HEALTH":
      return answerSyncHealth(ctx);

    case "MONEY_FLOWS":
      return answerMoneyFlows(ctx, intent.period, intent.mode);

    case "SALES_ANALYSIS":
      return answerSalesAnalysis(ctx, intent.period, intent.mode);

    case "SITE_TRAFFIC":
      return answerSiteTraffic(ctx, intent.period);

    case "DIGEST":
      return answerDigest(ctx);
  }

  return null;
}

/** «Сьогодні / завтра / вчора» в київську дату. */
function dayOf(today: string, when: "today" | "tomorrow" | "yesterday"): string {
  return when === "tomorrow" ? shiftDay(today, 1) : when === "yesterday" ? shiftDay(today, -1) : today;
}

/**
 * Порада «з чим заходити» рахується від ПОРТФЕЛЯ торгового.
 *
 * Гачок береться з того, що беруть сусідні клієнти цієї людини, тож від
 * імені керівника (у якого закріплень немає) вийшла б порожня порада. Тому
 * в розмові про фірму підставляємо того, за ким клієнт закріплений; немає
 * такого — лишаємо як є, відповідь просто буде без «беруть поруч».
 */
async function asOwnerRep(ctx: ToolContext, subject: string): Promise<ToolContext> {
  if (!ctx.scope.company) return ctx;
  const hits = await findClients(subject, ctx.scope.repId, { limit: 1 });
  const client = hits[0];
  if (!client) return ctx;
  const owner = await ownerRepOf(client.id);
  if (!owner) return ctx;
  return { ...ctx, scope: { repId: owner.id, repName: owner.name, company: false } };
}
