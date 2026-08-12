/**
 * Перевірка рейтингу клієнтів і арифметики пального — без мережі й бази.
 *
 * Запуск: npx tsx scripts/check-route-priority.ts
 *
 * Оптимізатор цілком перевірити тут не можна (він ходить в OSRM), але
 * саме оцінка клієнта вирішує, за кого система готова платити гаком, —
 * і помилка в ній тихо змінює порядок обʼїзду для всіх водіїв.
 */

import { scoreClient, explainScore, WEIGHTS } from "../src/lib/routes/priority";
import { fuelCostFor } from "../src/lib/routes/optimize";

let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

const plain = { receivable: 0, overdue: 0, turnover: 0, deliveryAmount: 0, state: null };

// --- Межі ---
check("Ваги сумуються в 1", Object.values(WEIGHTS).reduce((a, b) => a + b, 0) === 1, WEIGHTS);
check("Порожній клієнт близький до нуля", scoreClient(plain) < 0.15, scoreClient(plain));

const huge = scoreClient({
  receivable: 500_000, overdue: 500_000, turnover: 5_000_000, deliveryAmount: 200_000, state: "SLIPPING",
});
check("Максимальний клієнт не перевищує 1", huge <= 1, huge);
check("Максимальний клієнт помітно вищий за порожнього", huge > 0.7, huge);

// --- Борг важить найбільше ---
const onlyDebt = scoreClient({ ...plain, receivable: 20_000, overdue: 20_000 });
const onlyTurnover = scoreClient({ ...plain, turnover: 200_000 });
check("Борг переважає оборот за інших рівних", onlyDebt > onlyTurnover, { onlyDebt, onlyTurnover });

// --- Протермінований борг гостріший за свіжий ---
const fresh = scoreClient({ ...plain, receivable: 10_000, overdue: 0 });
const overdue = scoreClient({ ...plain, receivable: 10_000, overdue: 10_000 });
check("Прострочений борг важить більше за свіжий", overdue > fresh, { fresh, overdue });

// --- Монотонність: більший борг — не менший бал ---
let monotonic = true;
let prev = -1;
for (const v of [0, 500, 1_500, 3_200, 7_800, 25_000, 100_000]) {
  const s = scoreClient({ ...plain, receivable: v });
  if (s < prev) monotonic = false;
  prev = s;
}
check("Бал не спадає зі зростанням боргу", monotonic);

// --- Логарифм зберігає роздільність малих сум ---
// Головна причина, чому не лінійна нормалізація: з нею 1500 і 7800 на тлі
// клієнта з боргом 200 тис. злиплися б в один нуль.
const d1450 = scoreClient({ ...plain, receivable: 1_450 });
const d7800 = scoreClient({ ...plain, receivable: 7_800 });
check("Борги 1450 і 7800 помітно різні", d7800 - d1450 > 0.03, { d1450, d7800, diff: d7800 - d1450 });

// --- Стани клієнта ---
const slipping = scoreClient({ ...plain, state: "SLIPPING" });
const active = scoreClient({ ...plain, state: "ACTIVE" });
const lost = scoreClient({ ...plain, state: "LOST" });
check("Клієнт, що йде, важливіший за активного", slipping > active, { slipping, active });
check("Втрачений не важливіший за того, хто йде", lost < slipping, { lost, slipping });

// --- Пояснення ---
check(
  "Пояснення називає протермінований борг",
  explainScore({ ...plain, receivable: 5_000, overdue: 5_000 }).includes("прострочено"),
  explainScore({ ...plain, receivable: 5_000, overdue: 5_000 })
);
check("Звичайна точка так і зветься", explainScore(plain) === "звичайна точка", explainScore(plain));

// --- Пальне ---
// 100 км × 12 л/100 × 56 ₴ = 672 ₴
check("Пальне без буфера", fuelCostFor(100, { consumption: 12, pricePerUnit: 56 }) === 672,
  fuelCostFor(100, { consumption: 12, pricePerUnit: 56 }));
// Той самий розрахунок +10% на затори
check("Буфер 10% додає рівно 10%", fuelCostFor(100, { consumption: 12, pricePerUnit: 56, bufferPercent: 10 }) === 739,
  fuelCostFor(100, { consumption: 12, pricePerUnit: 56, bufferPercent: 10 }));
check("Нульовий пробіг — нуль витрат", fuelCostFor(0, { consumption: 12, pricePerUnit: 56 }) === 0);
// Електро: 18 кВт·год/100 × 7 ₴
check("Електромобіль рахується тією ж формулою", fuelCostFor(100, { consumption: 18, pricePerUnit: 7 }) === 126,
  fuelCostFor(100, { consumption: 18, pricePerUnit: 7 }));

// --- Сценарій із реального тесту ---
// Точка з боргом 7800 і доставкою 12400 має бути важливішою за точку без
// боргу з доставкою 8600 — інакше водій повезе товар, але не привезе гроші.
const withDebt = scoreClient({ receivable: 7_800, overdue: 0, turnover: 0, deliveryAmount: 12_400, state: null });
const noDebt = scoreClient({ receivable: 0, overdue: 0, turnover: 0, deliveryAmount: 8_600, state: null });
check("Боржник із великою доставкою — найважливіший", withDebt > noDebt, { withDebt, noDebt });

console.log(failed === 0 ? "\nУсе зійшлося." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
