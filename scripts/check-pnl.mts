/**
 * Звіт «прибутки і збитки» (src/lib/finance/pnl.ts) на синтетичних рядках.
 *
 *   npx tsx scripts/check-pnl.mts
 *
 * Бази не торкається.
 */

import { buildPnl } from "../src/lib/finance/pnl";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${JSON.stringify(got)}`);
  if (!ok) fails.push(name);
}

const sales = [
  // Серпень: 1 млн продажів, собівартість відома для 900 тис., вал по них 180 тис.
  { month: "2026-08", revenue: 1_000_000, costedRevenue: 900_000, costedMargin: 180_000 },
  { month: "2026-09", revenue: 500_000, costedRevenue: 500_000, costedMargin: 90_000 },
];
const expenses = [
  { month: "2026-08", kind: "SALARY", scope: "SALES", amount: 120_000 },
  { month: "2026-08", kind: "FUEL", scope: "REP", amount: 20_000, repId: "kulyk" },
  { month: "2026-08", kind: "RENT", scope: "STORE", amount: 30_000, storeName: "DNIPRO M Щирецька" },
  { month: "2026-09", kind: "SALARY", scope: "OFFICE", amount: 80_000 },
  { month: "2026-09", kind: "OTHER", scope: "COMPANY", amount: 5_000 },
];

const p = buildPnl(sales, expenses);
// Серпень: вал 180 тис. на 900 тис. (20 %), решта 100 тис. — за тим самим відсотком → 200 тис.
check("вал з оцінкою невідомої частини", p.months[0].margin === 200_000 && p.months[0].marginEstimated, p.months[0]);
check("витрати місяця", p.months[0].expenses === 170_000, p.months[0].expenses);
check("результат місяця = вал − витрати", p.months[0].result === 30_000, p.months[0].result);
check("вересень: вал мінус витрати", p.months[1].result === 90_000 - 85_000, p.months[1].result);
check("разом", p.total.revenue === 1_500_000 && p.total.margin === 290_000 && p.total.expenses === 255_000 && p.total.result === 35_000, p.total);
check("рентабельність від виручки, %", p.total.resultPct === 2.3, p.total.resultPct);
check("витрати по видах", p.byKind.find((k) => k.kind === "SALARY")?.amount === 200_000, p.byKind);
check("витрати по власниках", p.byScope.find((s) => s.scope === "STORE")?.amount === 30_000, p.byScope);
check("торгові поіменно", p.byRep.length === 1 && p.byRep[0].repId === "kulyk" && p.byRep[0].amount === 20_000, p.byRep);
check("магазини поіменно", p.byStore[0]?.storeName === "DNIPRO M Щирецька", p.byStore);
check("нерозкладене «інше»", p.unclassified === 5_000, p.unclassified);
check("є витрати", p.hasExpenses === true, p.hasExpenses);

{
  // Липень: витрати є, а собівартості немає зовсім — валу нема з чим порівняти.
  // Такий місяць не має тягнути підсумок униз: результат — лише по місяцях із валом.
  const july = buildPnl([{ month: "2026-07", revenue: 300_000, costedRevenue: 0, costedMargin: 0 }, ...sales], [{ month: "2026-07", kind: "SALARY", scope: "OFFICE", amount: 50_000 }, ...expenses]);
  check("місяць без валу — без результату", july.months[0].result === null, july.months[0]);
  check("підсумок — лише по місяцях із валом", july.total.result === 35_000, july.total);
  check("витрати місяців без валу — окремо", july.total.expensesWithoutMargin === 50_000, july.total.expensesWithoutMargin);
  check("рентабельність — від виручки тих самих місяців", july.total.resultPct === 2.3, july.total.resultPct);
}

const empty = buildPnl(sales, []);
check("без витрат — прямо про це", empty.hasExpenses === false && empty.total.result === null, empty.total);

console.log(fails.length ? `\nПровалено: ${fails.length}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
