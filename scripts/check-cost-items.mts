/**
 * Класифікатор статей витрат 1С (src/lib/finance/cost-items.ts) на назвах,
 * які бачила проба probe-costs.ps1 05.09.2026.
 *
 *   npx tsx scripts/check-cost-items.mts
 *
 * Бази не торкається.
 */

import { classifyCostItem } from "../src/lib/finance/cost-items";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${JSON.stringify(got)}`);
  if (!ok) fails.push(name);
}

const reps = [
  { id: "kulyk", name: "Кулик Дмитро" },
  { id: "peredrii", name: "Передрій Дмитро" },
  { id: "dzhumaha", name: "Ігор Джумага" },
  { id: "oleksandr", name: "Олександр " },
];
const c = (name: string, group: string | null = null) => classifyCostItem(name, group, reps);

check("ЗП торгові — зарплата торгового відділу", c("ЗП торгові", "Торговий відділ").kind === "SALARY" && c("ЗП торгові", "Торговий відділ").scope === "SALES", c("ЗП торгові", "Торговий відділ"));
check("ЗП Офіс — зарплата офісу", c("ЗП Офіс").kind === "SALARY" && c("ЗП Офіс").scope === "OFFICE", c("ЗП Офіс"));
check("ЗП водії — зарплата логістики", c("ЗП водії").kind === "SALARY" && c("ЗП водії").scope === "LOGISTICS", c("ЗП водії"));
check("ЗП склад — зарплата складу", c("ЗП склад").kind === "SALARY" && c("ЗП склад").scope === "WAREHOUSE", c("ЗП склад"));
check("ЗП СММ — зарплата, а не реклама", c("ЗП СММ").kind === "SALARY", c("ЗП СММ"));
check("Паливо Кулик — пальне торгового Кулика", c("Паливо Кулик").kind === "FUEL" && c("Паливо Кулик").scope === "REP" && c("Паливо Кулик").repId === "kulyk", c("Паливо Кулик"));
check("стаття в групі торгового — його", c("GPS", "Джумага").scope === "REP" && c("GPS", "Джумага").repId === "dzhumaha" && c("GPS", "Джумага").kind === "GPS", c("GPS", "Джумага"));
check("Паливо водії — пальне логістики", c("Паливо водії").kind === "FUEL" && c("Паливо водії").scope === "LOGISTICS", c("Паливо водії"));
check("Податки ФОП — податки фірми", c("Податки ФОП").kind === "TAX" && c("Податки ФОП").scope === "COMPANY", c("Податки ФОП"));
check("оренда в групі магазину — магазин", c("Оренда", "DNIPRO M Щирецька").kind === "RENT" && c("Оренда", "DNIPRO M Щирецька").scope === "STORE" && c("Оренда", "DNIPRO M Щирецька").storeName === "DNIPRO M Щирецька", c("Оренда", "DNIPRO M Щирецька"));
check("КУВАЛДА — магазин", c("Охорона", "КУВАЛДА").scope === "STORE" && c("Охорона", "КУВАЛДА").kind === "SECURITY", c("Охорона", "КУВАЛДА"));
check("Бухгалтерія і МЕДОК — облік", c("Бухгалтерія").kind === "ACCOUNTING" && c("МЕДОК").kind === "ACCOUNTING", [c("Бухгалтерія").kind, c("МЕДОК").kind]);
check("Недостача — інвентаризація", c("Недостача").kind === "INVENTORY" && c("Надлишок").kind === "INVENTORY", [c("Недостача").kind, c("Надлишок").kind]);
check("Амортизація авто Передрій", c("Амортизація авто Передрій").kind === "DEPRECIATION" && c("Амортизація авто Передрій").repId === "peredrii", c("Амортизація авто Передрій"));
check("невідоме — інше / компанія", c("Щось дивне").kind === "OTHER" && c("Щось дивне").scope === "COMPANY", c("Щось дивне"));
check("спільне ім'я двох торгових не прив'язує", c("Премія Дмитро").repId === null, c("Премія Дмитро"));
check("ім'я без прізвища нікого не ловить випадково", c("Олександрія доставка").repId === null, c("Олександрія доставка"));

console.log(fails.length ? `\nПровалено: ${fails.length}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
