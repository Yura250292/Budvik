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
import type { ToolContext } from "@/lib/assistant/types";
import type { DirectAnswer } from "@/lib/assistant/answers";
import {
  answerChurn,
  answerClientCard,
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
  answerPayments,
  answerSubstitute,
  answerRecommend,
  answerReturns,
  answerRoute,
  answerSales,
} from "@/lib/assistant/answers";
import { shiftDay } from "@/lib/analytics/period";

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
    case "DAY_PLAN":
      return answerDayPlan(
        ctx,
        intent.day === "tomorrow" ? shiftDay(ctx.today, 1) : ctx.today
      );

    case "DEBTS":
      return answerDebts(ctx);

    case "CHURN":
      return answerChurn(ctx);

    case "DEAD_STOCK":
      return answerDeadStock(ctx, intent.brand);

    case "SALES":
      return answerSales(ctx, intent.days);

    case "ROUTE":
      return answerRoute(ctx, intent.weekday);

    case "ENTRY_OFFER": {
      const subject = subjectOf(intent.subject);
      return subject ? answerEntryOffer(ctx, subject) : null;
    }

    case "RECOMMEND": {
      const subject = subjectOf(intent.subject);
      return subject ? answerRecommend(ctx, subject) : null;
    }

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
      return answerReturns(ctx, intent.days);

    case "BENCHMARK":
      return answerBenchmark(ctx, intent.days);

    case "NEARBY":
      return answerNearby(ctx, intent.radiusKm);

    case "PAYMENTS":
      return answerPayments(ctx, intent.days, subjectOf(intent.subject));

    case "FORECAST":
      return answerForecast(ctx);

    case "ABC_CLIENTS":
      return answerAbcClients(ctx, intent.days);

    case "DRIVER_DAY": {
      const day =
        intent.day === "tomorrow"
          ? shiftDay(ctx.today, 1)
          : intent.day === "yesterday"
            ? shiftDay(ctx.today, -1)
            : ctx.today;
      return answerDriverDay(ctx, day);
    }
  }

  return null;
}
