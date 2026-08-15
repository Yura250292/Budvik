/**
 * Платіжна дисципліна клієнтів: кому можна відвантажувати в борг.
 *
 * Відповідає на питання, яке досі вирішувала інтуїція торгового: цей клієнт
 * «нормально платить» чи вже сидить у нас на шиї? Замість відчуття — три
 * виміри по кожному клієнту:
 *
 *   1. Скільки днів обороту висить у борзі (debtDays). Борг 50 тис. для
 *      клієнта з оборотом 100 тис./міс — робочий кредит на два тижні;
 *      той самий борг при обороті 10 тис./міс — пів року чужих грошей.
 *   2. Яка частка боргу прострочена (за FIFO-віком з money-facts — та сама
 *      логіка, що в дебіторці, щоб числа не розходились між вкладками).
 *   3. Чи платить взагалі: оплати за вікно (ПКО з 1С, є з травня 2026).
 *
 * З них складається вердикт і рекомендований кредитний ліміт. Пороги — не
 * нормативи з підручника, а орієнтири під реальний цикл закупівель
 * будматеріалів (клієнти беруть раз на 2–4 тижні, відстрочка де-факто
 * пара тижнів): кожен можна посунути, вони зібрані константами нижче.
 *
 * ВАЖЛИВО: дисципліна НЕ залежить від обраного періоду. Борг — це залишок
 * «на зараз», а швидкість обороту береться за фіксоване вікно, інакше
 * вердикт клієнта стрибав би від того, який місяць відкрив керівник.
 */

import { prisma } from "@/lib/prisma";
import { receivableRowsByRep, sumAging } from "@/lib/analytics/money-facts";

/**
 * Вікно швидкості: той самий горизонт, що в закупівлях і оборотності
 * складу (90 днів) — «місячний оборот клієнта» скрізь означає те саме.
 */
const VELOCITY_DAYS = 90;

/**
 * Пороги вердиктів.
 *
 * debtDays — скільки днів свого звичайного обороту клієнт тримає в борзі.
 * До 30 — робочий кредит (один цикл закупівлі), до 60 — уже два цикли,
 * далі — клієнт живе нашим коштом.
 *
 * overdueShare — частка простроченої частини боргу (грейс 15 днів після
 * доставки закладений у bucketForAge, див. erp/receivables.ts).
 */
const DEBT_DAYS_MODERATE = 30;
const DEBT_DAYS_RISKY = 60;
const OVERDUE_SHARE_MODERATE = 5;
const OVERDUE_SHARE_RISKY = 20;
const OVERDUE_SHARE_CRITICAL = 50;

/**
 * Множники рекомендованого ліміту від середньомісячного обороту.
 *
 * Ідея проста: надійному можна тримати в борзі до півтора місячних
 * оборотів, помірному — один, ризиковому — половину, критичному — нуль
 * (тільки передоплата). Ліміт округлюється до тисячі, щоб читався як
 * рішення, а не як розрахунок.
 */
const LIMIT_FACTOR: Record<PayerVerdict, number> = {
  RELIABLE: 1.5,
  MODERATE: 1.0,
  RISKY: 0.5,
  CRITICAL: 0,
};

export type PayerVerdict = "RELIABLE" | "MODERATE" | "RISKY" | "CRITICAL";

export const VERDICT_LABELS: Record<PayerVerdict, string> = {
  RELIABLE: "надійний",
  MODERATE: "помірний",
  RISKY: "ризиковий",
  CRITICAL: "лише передоплата",
};

export type PayerRow = {
  counterpartyId: string;
  name: string;
  code: string | null;
  repId: string | null;
  repName: string | null;
  /** Оборот нетто за вікно і середній на місяць. */
  shipped: number;
  perMonth: number;
  debt: number;
  overdue: number;
  /** Частка простроченого в борзі, %. */
  overdueShare: number;
  /** Борг, старший за нашу історію документів — найпідозріліший. */
  unknownDebt: number;
  /**
   * Скільки днів звичайного обороту висить у борзі.
   * null — клієнт нічого не купував за вікно (борг без покупок).
   */
  debtDays: number | null;
  /** Оплати за вікно (ПКО з 1С). */
  paid: number;
  lastPaymentAt: string | null;
  lastDocAt: string | null;
  verdict: PayerVerdict;
  /** Рекомендований кредитний ліміт, грн (округлено до тисячі). */
  suggestedLimit: number;
};

export type DisciplineReport = {
  velocityDays: number;
  /** З якої дати в базі є оплати — щоб фронт чесно підписав колонку. */
  paymentsSince: string | null;
  totals: {
    clients: number;
    debt: number;
    overdue: number;
    byVerdict: Record<PayerVerdict, { clients: number; debt: number }>;
  };
  rows: PayerRow[];
};

type ActivityRow = {
  counterpartyId: string;
  name: string;
  code: string | null;
  shipped: number;
  lastDocAt: Date | null;
  repId: string | null;
};

type PaymentRow = {
  counterpartyId: string;
  paid: number;
  lastPaymentAt: Date | null;
};

/**
 * Вердикт за трьома вимірами.
 *
 * Порядок перевірок — від найгіршого: борг без покупок за квартал це
 * «критичний» незалежно від сум (гроші висять, а стосунків уже немає).
 * Прострочена частка б'є сильніше за debtDays: великий, але свіжий борг —
 * робочий кредит, а маленький прострочений — уже невиконана обіцянка.
 */
function verdictOf(row: {
  debt: number;
  overdueShare: number;
  debtDays: number | null;
  shipped: number;
}): PayerVerdict {
  // Боргу немає — дисципліна ідеальна за визначенням.
  if (row.debt <= 0.01) return "RELIABLE";

  // Борг є, покупок за квартал немає: клієнт пішов, а гроші лишились.
  if (row.shipped <= 0) return "CRITICAL";

  if (row.overdueShare >= OVERDUE_SHARE_CRITICAL) return "CRITICAL";
  if (row.overdueShare >= OVERDUE_SHARE_RISKY) return "RISKY";
  if (row.debtDays !== null && row.debtDays >= DEBT_DAYS_RISKY) return "RISKY";
  if (row.overdueShare >= OVERDUE_SHARE_MODERATE) return "MODERATE";
  if (row.debtDays !== null && row.debtDays >= DEBT_DAYS_MODERATE) return "MODERATE";
  return "RELIABLE";
}

/** Рейтинг платників по всіх клієнтах, які або винні, або купували за вікно. */
export async function buildDisciplineReport(): Promise<DisciplineReport> {
  const [debtors, activity, payments, reps, paymentsSinceRow] = await Promise.all([
    receivableRowsByRep(),
    prisma.$queryRaw<ActivityRow[]>`
      SELECT
        s."counterpartyId",
        c.name,
        c.code,
        SUM(s."totalAmount")::float AS shipped,
        MAX(s."createdAt") FILTER (WHERE s."docType" = 'REALIZATION') AS "lastDocAt",
        (
          -- Той самий вибір торгового, що в дебіторці: закріплення, потім
          -- останній не-RETURN документ (повернення клієнта не «передає»).
          SELECT COALESCE(
            (SELECT src."salesRepId" FROM "SalesRepClient" src
             WHERE src."counterpartyId" = s."counterpartyId" ORDER BY src.id LIMIT 1),
            (SELECT sd."salesRepId" FROM "SalesDocument" sd
             WHERE sd."counterpartyId" = s."counterpartyId"
               AND sd."salesRepId" IS NOT NULL AND sd."docType" <> 'RETURN'
             ORDER BY (sd."docType" = 'REALIZATION') DESC, sd."createdAt" DESC LIMIT 1)
          )
        ) AS "repId"
      FROM "SalesDocument" s
      JOIN "Counterparty" c ON c.id = s."counterpartyId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" IN ('REALIZATION', 'RETURN')
        AND s."counterpartyId" IS NOT NULL
        AND s."createdAt" >= NOW() - (${VELOCITY_DAYS} * INTERVAL '1 day')
      GROUP BY s."counterpartyId", c.name, c.code
    `,
    prisma.$queryRaw<PaymentRow[]>`
      SELECT
        i."counterpartyId",
        SUM(p.amount)::float AS paid,
        MAX(COALESCE(p."paidAt", p."createdAt")) AS "lastPaymentAt"
      FROM "Payment" p
      JOIN "Invoice" i ON i.id = p."invoiceId"
      WHERE COALESCE(p."paidAt", p."createdAt") >= NOW() - (${VELOCITY_DAYS} * INTERVAL '1 day')
      GROUP BY i."counterpartyId"
    `,
    prisma.user.findMany({ where: { role: "SALES" }, select: { id: true, name: true } }),
    prisma.$queryRaw<Array<{ first: Date | null }>>`
      SELECT MIN(COALESCE("paidAt", "createdAt")) AS first FROM "Payment"
    `,
  ]);

  const repName = new Map(reps.map((r) => [r.id, r.name]));
  const paymentByClient = new Map(payments.map((p) => [p.counterpartyId, p]));

  // Клієнт потрапляє у звіт, якщо він або купував за вікно, або винен.
  // Обидва списки потрібні: борг без покупок — найважливіший сигнал, а
  // покупці без боргу — приклад дисципліни, від якого рахуються ліміти.
  const rows = new Map<string, PayerRow>();

  for (const a of activity) {
    const shipped = Math.max(0, a.shipped);
    const perDay = shipped / VELOCITY_DAYS;
    const pay = paymentByClient.get(a.counterpartyId);

    rows.set(a.counterpartyId, {
      counterpartyId: a.counterpartyId,
      name: a.name,
      code: a.code,
      repId: a.repId,
      repName: a.repId ? (repName.get(a.repId) ?? null) : null,
      shipped,
      perMonth: (shipped / VELOCITY_DAYS) * 30,
      debt: 0,
      overdue: 0,
      overdueShare: 0,
      unknownDebt: 0,
      debtDays: perDay > 0 ? 0 : null,
      paid: pay?.paid ?? 0,
      lastPaymentAt: pay?.lastPaymentAt ? pay.lastPaymentAt.toISOString() : null,
      lastDocAt: a.lastDocAt ? a.lastDocAt.toISOString() : null,
      verdict: "RELIABLE",
      suggestedLimit: 0,
    });
  }

  for (const d of debtors) {
    const existing = rows.get(d.counterpartyId);
    const aging = sumAging([d]);
    const pay = paymentByClient.get(d.counterpartyId);

    const base: PayerRow = existing ?? {
      counterpartyId: d.counterpartyId,
      name: d.clientName,
      code: d.clientCode,
      repId: d.repId,
      repName: d.repId ? (repName.get(d.repId) ?? null) : null,
      shipped: 0,
      perMonth: 0,
      debt: 0,
      overdue: 0,
      overdueShare: 0,
      unknownDebt: 0,
      debtDays: null,
      paid: pay?.paid ?? 0,
      lastPaymentAt: pay?.lastPaymentAt ? pay.lastPaymentAt.toISOString() : null,
      lastDocAt: d.lastDocAt ? new Date(d.lastDocAt).toISOString() : null,
      verdict: "RELIABLE",
      suggestedLimit: 0,
    };

    base.debt = d.debt;
    base.overdue = aging.overdue;
    base.overdueShare = d.debt > 0 ? (aging.overdue / d.debt) * 100 : 0;
    base.unknownDebt = d.unknownDebt;
    base.debtDays = base.shipped > 0 ? d.debt / (base.shipped / VELOCITY_DAYS) : null;

    rows.set(d.counterpartyId, base);
  }

  const list = [...rows.values()].map((r) => {
    const verdict = verdictOf(r);
    // Ліміт від середньомісячного обороту; клієнту без покупок за вікно
    // рахувати нема від чого — нуль (нове відвантаження = нове рішення).
    const suggestedLimit = Math.round(((r.perMonth * LIMIT_FACTOR[verdict]) || 0) / 1000) * 1000;
    return { ...r, verdict, suggestedLimit };
  });

  // Найпроблемніші зверху: критичні за сумою боргу, далі ризикові тощо.
  const order: Record<PayerVerdict, number> = { CRITICAL: 0, RISKY: 1, MODERATE: 2, RELIABLE: 3 };
  list.sort((a, b) => order[a.verdict] - order[b.verdict] || b.debt - a.debt || b.shipped - a.shipped);

  const byVerdict = { RELIABLE: { clients: 0, debt: 0 }, MODERATE: { clients: 0, debt: 0 }, RISKY: { clients: 0, debt: 0 }, CRITICAL: { clients: 0, debt: 0 } };
  let debtTotal = 0;
  let overdueTotal = 0;
  for (const r of list) {
    byVerdict[r.verdict].clients++;
    byVerdict[r.verdict].debt += r.debt;
    debtTotal += r.debt;
    overdueTotal += r.overdue;
  }

  const first = paymentsSinceRow[0]?.first;

  return {
    velocityDays: VELOCITY_DAYS,
    paymentsSince: first ? first.toISOString().slice(0, 10) : null,
    totals: { clients: list.length, debt: debtTotal, overdue: overdueTotal, byVerdict },
    rows: list,
  };
}
