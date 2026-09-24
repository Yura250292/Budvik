/**
 * Прибутки і збитки по місяцях: виручка, вал, витрати з 1С, результат.
 *
 * Виручка й вал — тими самими правилами, що вся аналітика продажів
 * (SOURCE_FILTER, реалізації мінус повернення, без своїх контрагентів; вал —
 * сума документа мінус собівартість його рядків, лише де вона відома, як у
 * revenueByRep). Частину без собівартості оцінюємо за відсотком відомої й
 * кажемо про це. Витрати — канал `expense` (регістр 1С Затраты), розкладені
 * класифікатором по видах і власниках (finance/cost-items.ts).
 *
 * Чого тут немає і що варто казати людині: витрати лише ті, що ведуться в
 * УТ; банківські комісії й податки ТОВ живуть в окремій базі Buhgalteria, до
 * якої доступу ще немає (docs/1c-accounting-plan.md).
 *
 * І головне застереження (перший прогін 24.09.2026): роздрібної виручки
 * магазинів DNIPRO-M і КУВАЛДА в УТ немає — роздрібних чеків 0, магазинам
 * іде лише опт накладними (0,56 млн за 8 місяців), — а їхні оренда, світло
 * й прибирання у витратах є. Тому результат без витрат магазинів
 * (`resultExStores`) — це чесний результат оптового бізнесу, а загальний
 * змішує опт із витратами магазинів без їхньої виручки.
 *
 * Нічого не пише.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NOT_INTERNAL_DOC, SOURCE_FILTER } from "@/lib/analytics/facts";
import { kyivTsSql } from "@/lib/date/kyiv";

export type SalesMonth = { month: string; revenue: number; costedRevenue: number; costedMargin: number };
export type ExpenseRow = { month: string; kind: string; scope: string; amount: number; repId?: string | null; storeName?: string | null };

export type PnlMonth = {
  month: string;
  revenue: number;
  margin: number | null;
  marginEstimated: boolean;
  expenses: number;
  result: number | null;
};

export type Pnl = {
  months: PnlMonth[];
  total: {
    revenue: number;
    margin: number | null;
    expenses: number;
    /** Результат лише по місяцях, де вал відомий — інакше витрати без валу тягнули б підсумок униз. */
    result: number | null;
    /** Від виручки тих самих місяців, що й результат. */
    resultPct: number | null;
    /** Витрати місяців, де собівартості немає зовсім, — у результат не входять. */
    expensesWithoutMargin: number;
    /** Витрати магазинів (scope STORE) у місяцях із валом. */
    storeExpenses: number;
    /** Результат без витрат магазинів: їхньої роздрібної виручки в УТ немає. */
    resultExStores: number | null;
    costedShare: number;
  };
  byKind: { kind: string; amount: number }[];
  byScope: { scope: string; amount: number }[];
  byRep: { repId: string; amount: number }[];
  byStore: { storeName: string; amount: number }[];
  /** Витрати статей, які класифікатор не розклав (вид OTHER і власник «фірма»). */
  unclassified: number;
  hasExpenses: boolean;
};

const round = (v: number) => Math.round(v);
const sortDesc = <T extends { amount: number }>(xs: T[]) => xs.sort((a, b) => b.amount - a.amount);

function sumBy<K extends string>(rows: ExpenseRow[], key: (r: ExpenseRow) => K | null | undefined) {
  const m = new Map<K, number>();
  for (const r of rows) {
    const k = key(r);
    if (k) m.set(k, (m.get(k) ?? 0) + r.amount);
  }
  return m;
}

export function buildPnl(sales: SalesMonth[], expenses: ExpenseRow[]): Pnl {
  const hasExpenses = expenses.length > 0;
  const months = [...new Set([...sales.map((s) => s.month), ...expenses.map((e) => e.month)])].sort();
  const marginOf = (s: SalesMonth | undefined) =>
    !s || s.costedRevenue <= 0 ? null : s.costedMargin + (s.revenue - s.costedRevenue) * (s.costedMargin / s.costedRevenue);

  const rows: PnlMonth[] = months.map((month) => {
    const s = sales.find((x) => x.month === month);
    const m = marginOf(s);
    const exp = expenses.filter((e) => e.month === month).reduce((a, e) => a + e.amount, 0);
    return {
      month,
      revenue: round(s?.revenue ?? 0),
      margin: m === null ? null : round(m),
      marginEstimated: !!s && s.costedRevenue > 0 && s.costedRevenue < s.revenue,
      expenses: round(exp),
      result: m === null || !hasExpenses ? null : round(m) - round(exp),
    };
  });

  const revenue = rows.reduce((a, r) => a + r.revenue, 0);
  const margin = rows.every((r) => r.margin === null) ? null : rows.reduce((a, r) => a + (r.margin ?? 0), 0);
  const expTotal = rows.reduce((a, r) => a + r.expenses, 0);
  const withMargin = rows.filter((r) => r.margin !== null);
  const marginMonths = new Set(withMargin.map((r) => r.month));
  const storeExpenses = round(
    expenses.filter((e) => e.scope === "STORE" && marginMonths.has(e.month)).reduce((a, e) => a + e.amount, 0)
  );
  const result = margin === null || !hasExpenses ? null : withMargin.reduce((a, r) => a + (r.margin ?? 0) - r.expenses, 0);
  const resultRevenue = withMargin.reduce((a, r) => a + r.revenue, 0);
  const costedRevenue = sales.reduce((a, s) => a + s.costedRevenue, 0);

  return {
    months: rows,
    total: {
      revenue,
      margin,
      expenses: expTotal,
      result,
      resultPct: result === null || resultRevenue <= 0 ? null : Math.round((result / resultRevenue) * 1000) / 10,
      expensesWithoutMargin: rows.filter((r) => r.margin === null).reduce((a, r) => a + r.expenses, 0),
      storeExpenses,
      resultExStores: result === null ? null : result + storeExpenses,
      costedShare: revenue > 0 ? Math.round((costedRevenue / revenue) * 1000) / 1000 : 0,
    },
    byKind: sortDesc([...sumBy(expenses, (e) => e.kind)].map(([kind, amount]) => ({ kind, amount: round(amount) }))),
    byScope: sortDesc([...sumBy(expenses, (e) => e.scope)].map(([scope, amount]) => ({ scope, amount: round(amount) }))),
    byRep: sortDesc([...sumBy(expenses, (e) => e.repId)].map(([repId, amount]) => ({ repId, amount: round(amount) }))),
    byStore: sortDesc([...sumBy(expenses, (e) => e.storeName)].map(([storeName, amount]) => ({ storeName, amount: round(amount) }))),
    unclassified: round(expenses.filter((e) => e.kind === "OTHER" && e.scope === "COMPANY").reduce((a, e) => a + e.amount, 0)),
    hasExpenses,
  };
}

/* ── Читання бази (лише SELECT) ─────────────────────────────────────── */

const MONTH = (col: string) => Prisma.raw(`to_char(${kyivTsSql(col)}, 'YYYY-MM')`);

export async function loadPnl(from: Date, to: Date): Promise<Pnl> {
  const [sales, expenses] = await Promise.all([
    prisma.$queryRaw<SalesMonth[]>`
      SELECT ${MONTH('s."createdAt"')} AS month,
             SUM(s."totalAmount")::float AS revenue,
             COALESCE(SUM(s."totalAmount") FILTER (WHERE c.cost IS NOT NULL), 0)::float AS "costedRevenue",
             COALESCE(SUM(s."totalAmount" - c.cost) FILTER (WHERE c.cost IS NOT NULL), 0)::float AS "costedMargin"
      FROM "SalesDocument" s
      LEFT JOIN LATERAL (
        SELECT SUM(i."purchasePrice" * i.quantity) AS cost
        FROM "SalesDocumentItem" i
        WHERE i."salesDocumentId" = s.id AND i."purchasePrice" > 0
      ) c ON TRUE
      WHERE ${SOURCE_FILTER} AND ${NOT_INTERNAL_DOC}
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
      GROUP BY 1
    `,
    prisma.$queryRaw<ExpenseRow[]>`
      SELECT ${MONTH('e."docDate"')} AS month, ci.kind, ci.scope, ci."repId", ci."storeName",
             SUM(e.amount)::float AS amount
      FROM "ExpenseEntry" e
      JOIN "CostItem" ci ON ci.id = e."costItemId"
      WHERE e."docDate" >= ${from} AND e."docDate" <= ${to}
      GROUP BY 1, 2, 3, 4, 5
    `,
  ]);
  return buildPnl(sales, expenses);
}
