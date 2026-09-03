/**
 * Бухгалтерські звіти на даних, які 1С реально віддає.
 *
 * Попередній звіт (getFinancialReport у stats.ts) рахував P&L: виручка,
 * собівартість, валовий прибуток, маржа. Три з цих чотирьох чисел були
 * фікцією, і саме через джерело даних, а не через помилку в коді:
 *
 *   - Собівартість 1С у цьому обміні не передає взагалі. У 34 704 із
 *     34 709 рядків SalesDocumentItem.purchasePrice = 0 (див. коментар у
 *     sync-ingest/apply-documents.ts). Тож «валовий прибуток» виходив
 *     0,1% від обороту — число, яке виглядає правдоподібно й тому
 *     небезпечне: за ним можна прийняти рішення.
 *   - ~~Надходження товару не вивантажуються~~ — з 03.09.2026 канал
 *     purchase_doc має виробника в агенті (`receiptsSince` у queries.json),
 *     і закупівлі рахуються нижче по PurchaseOrder. Вартість складу все ще
 *     ні: для неї потрібна собівартість, а не ціна приходу.
 *   - Вартість складу рахувалася із SupplierProduct, де 0 записів.
 *
 * Тому P&L тут немає — його не можна побудувати чесно, доки 1С не почне
 * віддавати собівартість. Натомість звіт показує те, що в даних є
 * насправді, і кожне число зводиться з 1С:
 *
 *   1. Відвантаження — реалізації (докладніше про вибір docType нижче).
 *   2. Надходження грошей — Payment.paidAt, каса.
 *   3. Розрив між першим і другим: скільки з відвантаженого ще не
 *      оплачено. Головне число звіту.
 *   4. Дебіторка зі старінням — сальдо 1С, розкладене за нашими
 *      документами.
 *   5. Аванси покупців — від'ємні сальдо. Ніде більше не показані, а це
 *      14,4 млн у 162 клієнтів.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  receivableRowsByRep,
  sumAging,
  toDebtorList,
  type DebtorClient,
} from "@/lib/analytics/money-facts";
import type { AgingResult } from "@/lib/erp/receivables";
import type { Period } from "@/lib/analytics/period";

/** Місячний ряд: відвантажено vs оплачено. */
export type MonthRow = {
  /** YYYY-MM за Києвом */
  month: string;
  shipped: number;
  shippedCount: number;
  collected: number;
  collectedCount: number;
};

export type AdvanceClient = {
  id: string;
  name: string;
  amount: number;
};

export type AccountingReport = {
  period: { from: string; to: string; days: number };

  /**
   * Відвантаження за період — метод нарахування: зобов'язання виникло,
   * коли товар поїхав, незалежно від того, чи прийшли гроші.
   *
   * БРУТТО: повернення сюди не входять — бухгалтерію цікавить факт
   * відвантаження. Щоб число не читалося як оборот, поруч іде `returned`
   * і `shippedNet` (див. нижче).
   */
  shipped: { total: number; count: number; clients: number };

  /**
   * Повернення від покупця за період, сума ДОДАТНА (у базі вона від'ємна).
   *
   * Окрема стаття, а не мінус усередині shipped: інакше звіт мовчки
   * розходився б з аналітикою торгових, де оборот рахується нетто.
   */
  returned: { total: number; count: number; clients: number };

  /** shipped − returned. Саме це число зіставне з оборотом в аналітиці торгових. */
  shippedNet: number;

  /**
   * Закупівлі за період — проведені надходження товару з 1С.
   *
   * Не «витрати» і не собівартість проданого: це те, що приїхало на склад у
   * цьому періоді, за цінами постачальників. Поруч із відвантаженням воно
   * відповідає на питання «скільки завезли проти того, скільки продали».
   */
  purchased: { total: number; count: number; suppliers: number };

  /**
   * Гроші в касу за період — касовий метод. Друга колонка того самого
   * періоду: обидві потрібні, бо різниця між ними і є дебіторка.
   */
  collected: { total: number; count: number; clients: number };

  /**
   * shipped − collected. Додатне: відвантажили більше, ніж зібрали, борг
   * за період виріс. Від'ємне: збирали старі борги активніше, ніж
   * відвантажували нове.
   */
  gap: number;

  /** Помісячна динаміка обох потоків — за весь час, не лише за період. */
  months: MonthRow[];

  /**
   * Дебіторка станом на зараз. Не залежить від періоду: борг — залишок, а
   * не потік, він просто є (див. money-facts.ts).
   */
  receivables: AgingResult & { debtors: DebtorClient[] };

  /**
   * Аванси покупців — від'ємні сальдо взаєморозрахунків: клієнт заплатив
   * наперед або переплатив. Для бухгалтерії це пасив, а не «мінус до
   * дебіторки», тому окремою статтею, а не згорнуто з боргом.
   */
  advances: { total: number; count: number; clients: AdvanceClient[] };

  /** Що саме 1С не віддає — щоб порожні місця не читалися як нулі. */
  gaps: string[];
};

/**
 * Відвантаження беремо з реалізацій, а не із замовлень.
 *
 * У SalesDocument лежать обидва типи, і сумувати їх разом не можна —
 * одна партія порахувалася б двічі. Старий звіт брав ORDER і показував
 * 12,6 млн там, де реального відвантаження 29,5 млн: замовлення це намір,
 * реалізація — факт. Бухгалтерію цікавить факт.
 *
 * externalId IS NOT NULL — те саме правило, що в analytics/facts.ts:
 * рахуємо лише те, що прийшло з 1С, без ручних чернеток адмінки.
 */
const SHIPMENT_FILTER = Prisma.sql`
  "docType" = 'REALIZATION'
  AND status = 'CONFIRMED'
  AND "externalId" IS NOT NULL
`;

async function shippedTotals(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<
    Array<{ total: number; count: number; clients: number }>
  >`
    SELECT COALESCE(SUM("totalAmount"), 0)::float8 AS total,
           COUNT(*)::int AS count,
           COUNT(DISTINCT "counterpartyId")::int AS clients
    FROM "SalesDocument"
    WHERE ${SHIPMENT_FILTER}
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
  `;
  return rows[0] ?? { total: 0, count: 0, clients: 0 };
}

/**
 * Повернення за період — дзеркало shipped.
 *
 * Знак перевертаємо тут, як і для авансів: у базі сума від'ємна (щоб SUM в
 * аналітиці віднімав її сам), а в звіті окрема стаття має бути додатною —
 * мінус несе назва рядка, а не число.
 */
async function returnedTotals(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<
    Array<{ total: number; count: number; clients: number }>
  >`
    SELECT COALESCE(-SUM("totalAmount"), 0)::float8 AS total,
           COUNT(*)::int AS count,
           COUNT(DISTINCT "counterpartyId")::int AS clients
    FROM "SalesDocument"
    WHERE "docType" = 'RETURN'
      AND status = 'CONFIRMED'
      AND "externalId" IS NOT NULL
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
  `;
  return rows[0] ?? { total: 0, count: 0, clients: 0 };
}

/**
 * Гроші за період.
 *
 * Дата — COALESCE(paidAt, createdAt): paidAt це коли гроші реально
 * прийшли, createdAt — коли запис потрапив до нас під час обміну. Той
 * самий COALESCE, що в money-facts.ts, щоб числа звіту і мотивації
 * торгових не розходилися.
 */
async function collectedTotals(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<
    Array<{ total: number; count: number; clients: number }>
  >`
    SELECT COALESCE(SUM(p.amount), 0)::float8 AS total,
           COUNT(*)::int AS count,
           COUNT(DISTINCT i."counterpartyId")::int AS clients
    FROM "Payment" p
    JOIN "Invoice" i ON i.id = p."invoiceId"
    WHERE COALESCE(p."paidAt", p."createdAt") >= ${from}
      AND COALESCE(p."paidAt", p."createdAt") <= ${to}
  `;
  return rows[0] ?? { total: 0, count: 0, clients: 0 };
}

/**
 * Помісячний ряд за весь час.
 *
 * FULL JOIN, бо місяць може мати відвантаження без оплат або навпаки:
 * INNER викинув би такий місяць із ряду, і графік мовчки збрехав би про
 * розрив. Групування за київським місяцем — інакше документи з ночі
 * останнього числа поїхали б у наступний.
 */
async function monthlyFlows(): Promise<MonthRow[]> {
  return prisma.$queryRaw<MonthRow[]>`
    WITH ship AS (
      SELECT to_char("createdAt" AT TIME ZONE 'Europe/Kyiv', 'YYYY-MM') AS ym,
             SUM("totalAmount")::float8 AS amount,
             COUNT(*)::int AS cnt
      FROM "SalesDocument"
      WHERE ${SHIPMENT_FILTER}
      GROUP BY 1
    ),
    pay AS (
      SELECT to_char(COALESCE("paidAt", "createdAt") AT TIME ZONE 'Europe/Kyiv', 'YYYY-MM') AS ym,
             SUM(amount)::float8 AS amount,
             COUNT(*)::int AS cnt
      FROM "Payment"
      GROUP BY 1
    )
    SELECT COALESCE(ship.ym, pay.ym) AS month,
           COALESCE(ship.amount, 0)::float8 AS shipped,
           COALESCE(ship.cnt, 0)::int AS "shippedCount",
           COALESCE(pay.amount, 0)::float8 AS collected,
           COALESCE(pay.cnt, 0)::int AS "collectedCount"
    FROM ship
    FULL JOIN pay ON pay.ym = ship.ym
    ORDER BY 1
  `;
}

/**
 * Аванси — дзеркало дебіторки: те саме поле receivableBalance, але
 * від'ємне. Знак перевертаємо тут, щоб UI показував додатні суми.
 */
async function advances() {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; amount: number }>
  >`
    SELECT id, name, (-"receivableBalance")::float8 AS amount
    FROM "Counterparty"
    WHERE "receivableBalance" < -0.01
    ORDER BY "receivableBalance" ASC
    LIMIT 50
  `;

  const totals = await prisma.$queryRaw<Array<{ total: number; count: number }>>`
    SELECT COALESCE(SUM(-"receivableBalance"), 0)::float8 AS total,
           COUNT(*)::int AS count
    FROM "Counterparty"
    WHERE "receivableBalance" < -0.01
  `;

  return {
    total: totals[0]?.total ?? 0,
    count: totals[0]?.count ?? 0,
    clients: rows,
  };
}

/**
 * Чого бракує в даних. Виводиться на сторінці окремим блоком, бо
 * порожній показник і відсутній показник — різні речі: «закупівлі 0»
 * читається як «нічого не купували», хоча насправді 1С їх не віддає.
 */
function knownGaps(): string[] {
  return [
    "Собівартість і маржа: 1С не передає закупівельну ціну в рядках реалізації — прибуток порахувати неможливо.",
    "Вартість складу: рахувати її нема з чого — прихід дає ціну закупівлі партії, а не собівартість залишку.",
    "Строки боргу з 1С не приходять — старіння рахуємо самі за датами наших відвантажень.",
  ];
}

/**
 * Закупівлі за період: проведені прихідні накладні.
 *
 * Період беремо за `createdAt` — це дата документа (обмін ставить її з 1С),
 * тим самим полем фільтрує і сторінка «Прихід». Скасовані й непроведені не
 * рахуються: у 1С їх немає в обліку.
 */
async function purchasedTotals(from: Date, to: Date) {
  const agg = await prisma.purchaseOrder.aggregate({
    where: { status: "CONFIRMED", createdAt: { gte: from, lte: to } },
    _count: { _all: true },
    _sum: { totalAmount: true },
  });
  const suppliers = await prisma.purchaseOrder.groupBy({
    by: ["supplierId"],
    where: { status: "CONFIRMED", createdAt: { gte: from, lte: to } },
  });
  return {
    total: agg._sum.totalAmount ?? 0,
    count: agg._count._all,
    suppliers: suppliers.length,
  };
}

export async function getAccountingReport(period: Period): Promise<AccountingReport> {
  const { from, to } = period;

  // Дебіторка не залежить від періоду, решта — залежить.
  const [shipped, returned, collected, purchased, months, receivableRows, adv] = await Promise.all([
    shippedTotals(from, to),
    returnedTotals(from, to),
    collectedTotals(from, to),
    purchasedTotals(from, to),
    monthlyFlows(),
    receivableRowsByRep(),
    advances(),
  ]);

  const aging = sumAging(receivableRows);

  return {
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    shipped,
    returned,
    shippedNet: shipped.total - returned.total,
    purchased,
    collected,
    // Розрив рахуємо від НЕТТО: повернення зменшує борг клієнта так само,
    // як оплата, тож без нього «відвантажили мінус зібрали» завищувало б
    // приріст дебіторки рівно на суму повернень.
    gap: shipped.total - returned.total - collected.total,
    months,
    receivables: {
      ...aging,
      debtors: toDebtorList(receivableRows).slice(0, 50),
    },
    advances: adv,
    gaps: knownGaps(),
  };
}
