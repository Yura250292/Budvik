/**
 * Звірка декомпозиції заробітку по фірмах із підсумком рушія мотивації.
 *
 * Навіщо: кабінет торгового (/sales/analytics/plan) показує «зароблено з
 * SomaFix — 4 270 ₴», розкладаючи рядки calculateMotivation по brandId
 * правил. Якщо класифікація розійдеться з тим, як рушій рахує підсумок,
 * торговий побачить суми, які не б'ються — і довіру до цифр буде втрачено.
 *
 * Два режими:
 *   1) синтетичний — проганяє рушій на вигаданій схемі з усіма типами
 *      правил разом. Працює завжди, зокрема поки в базі немає жодної
 *      призначеної схеми (а зараз саме так);
 *   2) бойовий — той самий інваріант по реальних торгових, якщо схеми вже
 *      заведені.
 *
 * Інваріант: brandTotal + general − penalties === total
 * (з поправкою на те, що рушій не пускає підсумок нижче нуля).
 *
 * Запуск:
 *   npx tsx scripts/verify-brand-earnings.ts
 *   npx tsx scripts/verify-brand-earnings.ts 2026-07   — інший місяць
 */

import { prisma } from "@/lib/prisma";
import { parseMonth } from "@/lib/analytics/period";
import { collectedByRepBrand, receivableRowsByRep } from "@/lib/analytics/money-facts";
import { earningsByRep, resolveSchemes } from "@/lib/motivation/period-facts";
import { splitEarningsByBrand } from "@/lib/motivation/brand-earnings";
import { calculateMotivation, type PeriodFacts, type Rule } from "@/lib/motivation/engine";
import { kyivDate } from "@/lib/date/kyiv";

const SOMA = "brand-soma";
const ATAMAN = "brand-ataman";

function rule(p: Partial<Rule> & Pick<Rule, "id" | "type" | "value">): Rule {
  return {
    sortOrder: 0,
    brandId: null,
    categoryGroup: null,
    planMetric: null,
    thresholdFrom: null,
    thresholdTo: null,
    overdueTolerance: null,
    ...p,
  };
}

/** Схема, де є всі три групи розкладу разом: бренд, загальні, утримання. */
const SYNTHETIC_RULES: Rule[] = [
  rule({ id: "r-soma", type: "PERCENT_OF_PROFIT", value: 7, brandId: SOMA, sortOrder: 1 }),
  rule({ id: "r-ataman", type: "PERCENT_OF_COLLECTED", value: 3, brandId: ATAMAN, sortOrder: 2 }),
  rule({ id: "r-all", type: "PERCENT_OF_COLLECTED", value: 2, sortOrder: 3 }),
  rule({
    id: "r-bonus",
    type: "PLAN_BONUS_FIXED",
    value: 5000,
    planMetric: "REVENUE",
    thresholdFrom: 100,
    sortOrder: 4,
  }),
  // Бонус, який НЕ спрацював: рядок з amount = 0 має лишитись видимим —
  // він пояснює, чому грошей немає.
  rule({
    id: "r-bonus-miss",
    type: "PLAN_BONUS_FIXED",
    value: 9000,
    brandId: ATAMAN,
    planMetric: "REVENUE",
    thresholdFrom: 100,
    sortOrder: 5,
  }),
  // Утримання з проставленим brandId — навмисно: воно все одно НЕ має
  // потрапити в бренд, бо рахується від суми всіх нарахувань.
  rule({
    id: "r-penalty",
    type: "OVERDUE_PENALTY",
    value: 0.5,
    brandId: SOMA,
    overdueTolerance: 5,
    sortOrder: 6,
  }),
];

function syntheticFacts(overduePct: number): PeriodFacts {
  return {
    collectedAmount: 535_000,
    collectedProfit: 120_000,
    byBrand: new Map([
      [SOMA, { collected: 61_000, profit: 61_000 }],
      [ATAMAN, { collected: 90_000, profit: 20_000 }],
    ]),
    receivableTotal: 100_000,
    receivableOverdue: overduePct * 1_000,
    planAttainment: new Map([
      ["REVENUE:ALL", 112],
      [`REVENUE:${ATAMAN}`, 45],
    ]),
  };
}

function checkSplit(label: string, facts: PeriodFacts): boolean {
  const result = calculateMotivation(SYNTHETIC_RULES, facts, new Map());
  const split = splitEarningsByBrand(result, SYNTHETIC_RULES);

  const expected = Math.max(0, split.brandTotal + split.general - split.penalties);
  const totalOk = Math.abs(expected - result.total) < 0.5;

  // Утримання не повинно осісти в бренді, попри brandId у правилі.
  const penaltyLeaked = Array.from(split.byBrand.values()).some((b) =>
    b.lines.some((l) => l.ruleId === "r-penalty")
  );
  // Рядок «бонус не досягнуто» має лишитись у розкладі, а не зникнути.
  const zeroLineKept =
    Array.from(split.byBrand.values()).some((b) => b.lines.some((l) => l.ruleId === "r-bonus-miss")) ||
    split.generalLines.some((l) => l.ruleId === "r-bonus-miss");

  const ok = split.reconciles && totalOk && !penaltyLeaked && zeroLineKept;

  console.log(`${ok ? "✓" : "✗"} ${label}`);
  console.log(
    `    рушій:   gross=${result.gross.toFixed(2)} penalties=${result.penalties.toFixed(2)} total=${result.total.toFixed(2)}`
  );
  console.log(
    `    розклад: бренди=${split.brandTotal.toFixed(2)} загальні=${split.general.toFixed(2)} утримання=${split.penalties.toFixed(2)}`
  );
  console.log(
    `    reconciles=${split.reconciles} totalMatch=${totalOk} утримання-не-в-бренді=${!penaltyLeaked} нульовий-рядок-збережено=${zeroLineKept}`
  );
  for (const [brandId, b] of split.byBrand) {
    console.log(`      ${brandId}: ${b.amount.toFixed(2)} (рядків ${b.lines.length})`);
  }
  return ok;
}

async function main() {
  const arg = process.argv[2];
  const monthStr = /^\d{4}-\d{2}$/.test(arg ?? "") ? arg : kyivDate(new Date()).slice(0, 7);
  const { month, from, to } = parseMonth(monthStr);
  const period = { from, to };

  console.log("=== Синтетична схема (усі типи правил разом) ===\n");
  const cases = [
    ["прострочка в межах норми (3%)", syntheticFacts(3)],
    ["прострочка понад норму (40%)", syntheticFacts(40)],
    ["утримання з'їдають усе (95%)", syntheticFacts(95)],
  ] as const;

  let failures = 0;
  for (const [label, facts] of cases) {
    if (!checkSplit(label, facts)) failures++;
    console.log("");
  }

  console.log(`=== Бойові дані, місяць ${month} ===\n`);

  const reps = await prisma.user.findMany({
    where: { role: "SALES" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const repIds = reps.map((r) => r.id);
  const [collected, receivables, schemes] = await Promise.all([
    collectedByRepBrand(period.from, period.to),
    receivableRowsByRep(),
    resolveSchemes(repIds, period.to),
  ]);
  const earnings = await earningsByRep(repIds, period, month, { collected, receivables });

  let withScheme = 0;
  for (const rep of reps) {
    const e = earnings.get(rep.id);
    if (!e) continue;
    withScheme++;

    const rules = schemes.get(rep.id)?.rules ?? [];
    const split = splitEarningsByBrand(e, rules);
    const expected = Math.max(0, split.brandTotal + split.general - split.penalties);
    const totalOk = Math.abs(expected - e.total) < 0.5;

    if (!split.reconciles || !totalOk) {
      failures++;
      console.log(`✗ ${rep.name}: gross=${e.gross.toFixed(2)} total=${e.total.toFixed(2)}`);
      console.log(
        `    бренди=${split.brandTotal.toFixed(2)} загальні=${split.general.toFixed(2)} утримання=${split.penalties.toFixed(2)} reconciles=${split.reconciles}`
      );
    } else {
      console.log(
        `✓ ${rep.name}: total=${e.total.toFixed(2)} = бренди ${split.brandTotal.toFixed(2)} + загальні ${split.general.toFixed(2)} − утримання ${split.penalties.toFixed(2)}`
      );
    }
  }

  if (withScheme === 0) {
    console.log(
      `Жодному з ${reps.length} торгових не призначено схему і типової немає — бойову перевірку зробити нема на чому.`
    );
  }

  console.log(`\nПідсумок: помилок ${failures}.`);
  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
