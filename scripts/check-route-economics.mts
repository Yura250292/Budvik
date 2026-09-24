/**
 * Економіка рейсу доставки на синтетичних числах.
 *
 * Бази не треба: routeEconomics — чиста арифметика над готовими фактами.
 * Еталони виписані руками з формули зарплати власника (docs у
 * src/lib/drivers/payroll.ts) і норми пального, тож тест зламається,
 * якщо хтось поміняє котрусь із них мовчки.
 *
 *   npx tsx scripts/check-route-economics.mts
 *
 * Бази не торкається.
 */

import { routeEconomics, type EconomicsStop } from "../src/lib/routes/route-economics";
import { DEFAULT_RATES } from "../src/lib/drivers/payroll";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${typeof got === "string" ? got : JSON.stringify(got)}`);
  if (!ok) fails.push(name);
}

/** Точка у Львові, всередині об'їзної. */
function city(id: string, address: string, amount: number): EconomicsStop {
  return { salesDocumentId: id, counterpartyId: `cp-${id}`, address, lat: 49.84, lng: 24.03, amount, zoneOverride: null };
}
/** Точка в області: Стрий. */
function oblast(id: string, address: string, amount: number): EconomicsStop {
  return { salesDocumentId: id, counterpartyId: `cp-${id}`, address, lat: 49.26, lng: 23.85, amount, zoneOverride: null };
}

const fuel = { consumption: 12, pricePerUnit: 56, bufferPercent: 10 };

// 1. Повний випадок: 150 км, 4 міські адреси, собівартість відома частково.
{
  const stops = [
    city("a", "вул. Городоцька, 1", 20000),
    city("b", "вул. Городоцька, 2", 10000),
    city("c", "вул. Липинського, 36", 6000),
    city("d", "вул. Зелена, 5", 4000),
  ];
  const margins = new Map([
    ["a", { amount: 20000, cost: 16000 }],
    ["b", { amount: 10000, cost: 8000 }],
    ["c", { amount: 6000, cost: null }],
    ["d", { amount: 4000, cost: null }],
  ]);
  const e = routeEconomics({ km: 150, stops, margins, fuel, rates: DEFAULT_RATES });

  // 150 × 12 / 100 × 1,1 × 56 = 1108,8 → 1109
  check("пальне з буфером за нормою машини", e.fuel === 1109, e.fuel);
  // 700 (100–300 км) + 4 × 25 (місто) + 0,5 % × 40 000 = 700 + 100 + 200
  check("оплата водію за формулою власника", e.driverPay === 1000, e.driverPay);
  check("міські точки", e.cityPoints === 4 && e.oblastPoints === 0, [e.cityPoints, e.oblastPoints]);
  // Відомий вал 6 000 на 30 000 (20 %), решта 10 000 — за тим самим відсотком.
  check("частка суми з відомою собівартістю", e.costedShare === 0.75, e.costedShare);
  check("вал відомий", e.marginKnown === 6000, e.marginKnown);
  check("вал з оцінкою невідомої частини", e.margin === 8000 && e.marginEstimated === true, [e.margin, e.marginEstimated]);
  check("результат рейсу = вал − пальне − водій", e.result === 8000 - 1109 - 1000, e.result);
  check("сума рейсу", e.amount === 40000, e.amount);
}

// 2. Дві накладні на одну адресу — одна точка вигрузки, як у зарплаті.
{
  const stops = [
    oblast("a", "м. Стрий, вул. Шевченка, 10", 5000),
    oblast("b", "М.Стрий вул.Шевченка 10", 3000),
    oblast("c", "м. Стрий, вул. Львівська, 2", 2000),
  ];
  const margins = new Map([
    ["a", { amount: 5000, cost: 4000 }],
    ["b", { amount: 3000, cost: 2400 }],
    ["c", { amount: 2000, cost: 1600 }],
  ]);
  const e = routeEconomics({ km: 90, stops, margins, fuel, rates: DEFAULT_RATES });
  check("одна адреса двома накладними — одна точка", e.oblastPoints === 2 && e.cityPoints === 0, [e.oblastPoints, e.cityPoints]);
  // < 100 км → 500; 2 × 15; 0,5 % × 10 000 = 50
  check("короткий рейс в області", e.driverPay === 500 + 30 + 50, e.driverPay);
  check("вал без оцінки, коли собівартість відома вся", e.margin === 2000 && e.marginEstimated === false, [e.margin, e.marginEstimated]);
}

// 3. Ручна зона клієнта перебиває полігон.
{
  const stops = [{ ...city("a", "вул. Городоцька, 1", 1000), zoneOverride: "OBLAST" as const }];
  const e = routeEconomics({ km: 20, stops, margins: new Map([["a", { amount: 1000, cost: 800 }]]), fuel, rates: DEFAULT_RATES });
  check("ручна зона клієнта", e.oblastPoints === 1 && e.cityPoints === 0, [e.oblastPoints, e.cityPoints]);
}

// 4. Кілометрів немає (OSRM мовчав) — чисел, що від них залежать, теж немає.
{
  const stops = [city("a", "вул. Городоцька, 1", 1000)];
  const e = routeEconomics({ km: null, stops, margins: new Map([["a", { amount: 1000, cost: 800 }]]), fuel, rates: DEFAULT_RATES });
  check("без км пальне невідоме", e.fuel === null, e.fuel);
  check("без км оплата водію невідома", e.driverPay === null, e.driverPay);
  check("без км результату немає", e.result === null, e.result);
  check("вал від км не залежить", e.margin === 200, e.margin);
}

// 5. Собівартість невідома ніде — вал не вигадуємо.
{
  const stops = [city("a", "вул. Городоцька, 1", 1000)];
  const e = routeEconomics({ km: 30, stops, margins: new Map([["a", { amount: 1000, cost: null }]]), fuel, rates: DEFAULT_RATES });
  check("без собівартості валу немає", e.margin === null && e.marginKnown === null, [e.margin, e.marginKnown]);
  check("без валу результату немає", e.result === null, e.result);
  check("витрати рахуються й без валу", e.fuel !== null && e.driverPay !== null, [e.fuel, e.driverPay]);
}

// 6. Документ, якого не знайшли в базі, рахується за сумою точки без валу.
{
  const stops = [city("a", "вул. Городоцька, 1", 1000), city("b", "вул. Зелена, 5", 500)];
  const e = routeEconomics({ km: 30, stops, margins: new Map([["a", { amount: 1000, cost: 900 }]]), fuel, rates: DEFAULT_RATES });
  check("сума з точки, коли документа немає", e.amount === 1500, e.amount);
  check("частка з відомою собівартістю", Math.abs(e.costedShare - 1000 / 1500) < 1e-9, e.costedShare);
}

console.log(fails.length ? `\nПровалено: ${fails.length}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
