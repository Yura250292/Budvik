/**
 * Розклад заробітку торгового по фірмах.
 *
 * Задача: показати «SomaFix — план 100 000, виконано 80 000 = 80%,
 * зароблено з цього 4 270 ₴». Проблема: calculateMotivation віддає
 * RuleResult без brandId — рушій рахує гроші, а не звітність.
 *
 * Тому brandId беремо не з результату, а з самих правил схеми: у
 * RuleResult є ruleId, у Rule є brandId, схема вже завантажена
 * resolveSchemes(). Одна мапа — і розклад готовий, без змін у рушії.
 *
 * ЧОМУ УТРИМАННЯ НЕ РОЗКИДАЄМО ПО ФІРМАХ
 *
 * OVERDUE_PENALTY рахується від суми ВЖЕ НАРАХОВАНИХ рядків
 * (engine.ts: `const earned = lines.reduce(...)`), а не від бренду.
 * Утримання за прострочку — наслідок роботи з дебіторкою в цілому, і в
 * базі, від якої воно рахується, змішані гроші всіх фірм.
 *
 * Розкидати його пропорційно було б технічно легко і змістовно хибно:
 * торговий побачив би «SomaFix: −340 ₴» і пішов би шукати, який клієнт
 * SomaFix не заплатив. А не заплатив клієнт іншої фірми. Утримання
 * показуємо ОДИН раз, окремим блоком, з поясненням.
 *
 * Через це сума кілець менша за підсумок заробітку. Це не помилка — і
 * UI зобов'язаний це проговорити, а не тихо «підбити».
 */

import type { MotivationRuleType } from "@prisma/client";
import type { Rule, RuleResult, MotivationResult } from "./engine";

/**
 * Типи правил, які не належать бренду за побудовою — незалежно від суми.
 *
 * OVERDUE_PENALTY у межах толерантності дає рядок із amount = 0 («прострочено
 * 3% — у межах норми»), тобто одного лише знаку суми не досить: нульовий
 * рядок проскакував би в бренд, і торговий бачив би «Прострочена дебіторка»
 * підшитою під SomaFix. Тип правила — надійніша ознака, ніж знак.
 */
const NEVER_BRAND_SCOPED: MotivationRuleType[] = ["OVERDUE_PENALTY"];

export type BrandEarnings = {
  /** Скільки нараховано по правилах саме цього бренду */
  amount: number;
  /** Рядки — щоб цифра не була «з неба» */
  lines: RuleResult[];
};

export type EarningsSplit = {
  /** brandId → нарахування по цьому бренду */
  byBrand: Map<string, BrandEarnings>;
  /** Правила без brandId: діють на весь портфель */
  generalLines: RuleResult[];
  /** Сума загальних нарахувань */
  general: number;
  /** Утримання: не належать жодному бренду за побудовою */
  penaltyLines: RuleResult[];
  /** Сума утримань, додатним числом */
  penalties: number;
  /** Σ по всіх брендах */
  brandTotal: number;
  /**
   * Чи сходиться розклад із підсумком рушія.
   *
   * false означає, що в схемі з'явився тип правила, який ця функція
   * класифікує не так, як рушій його рахує. Ховати таке не можна:
   * краще показати попередження, ніж числа, які не б'ються.
   */
  reconciles: boolean;
};

/** Копійчані хвости після float-арифметики не роблять розклад «неправильним». */
const EPSILON = 0.5;

export function splitEarningsByBrand(
  result: MotivationResult | null,
  rules: Rule[]
): EarningsSplit {
  const empty: EarningsSplit = {
    byBrand: new Map(),
    generalLines: [],
    general: 0,
    penaltyLines: [],
    penalties: 0,
    brandTotal: 0,
    reconciles: true,
  };
  if (!result) return empty;

  const brandOf = new Map(rules.map((r) => [r.id, r.brandId]));

  const byBrand = new Map<string, BrandEarnings>();
  const generalLines: RuleResult[] = [];
  const penaltyLines: RuleResult[] = [];

  for (const line of result.lines) {
    // Порядок перевірок важливий: тип і знак важать більше за brandId.
    // Правило-утримання може мати brandId, але його база — сумарне
    // нарахування, тож віднести його до бренду означало б збрехати.
    // Перевіряємо саме тип, а не лише знак: у межах толерантності
    // утримання дає рядок із нулем, і по знаку його не спіймати.
    if (line.amount < 0 || NEVER_BRAND_SCOPED.includes(line.type)) {
      penaltyLines.push(line);
      continue;
    }

    const brandId = brandOf.get(line.ruleId) ?? null;
    if (!brandId) {
      // Сюди ж потрапляють рядки з amount === 0 («бонус не досягнуто»):
      // вони пояснюють, ЧОМУ грошей немає, і мають лишитися видимими.
      generalLines.push(line);
      continue;
    }

    const bucket = byBrand.get(brandId) ?? { amount: 0, lines: [] };
    bucket.amount += line.amount;
    bucket.lines.push(line);
    byBrand.set(brandId, bucket);
  }

  const general = generalLines.reduce((s, l) => s + l.amount, 0);
  const penalties = Math.abs(penaltyLines.reduce((s, l) => s + l.amount, 0));
  const brandTotal = Array.from(byBrand.values()).reduce((s, b) => s + b.amount, 0);

  // Рушій рахує gross як суму лише додатних рядків (engine.ts), тут так
  // само, тож ці два числа мають збігтися до копійок.
  const reconciles = Math.abs(brandTotal + general - result.gross) < EPSILON;

  return { byBrand, generalLines, general, penaltyLines, penalties, brandTotal, reconciles };
}
