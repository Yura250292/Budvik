/**
 * Людські назви типів правил мотивації.
 *
 * Окремо від engine.ts, бо той тягне серверні залежності, а ці рядки
 * потрібні і в клієнтському редакторі схем.
 */

import type { MotivationRuleType } from "@prisma/client";

/** Хто може змінювати схеми мотивації: це рівень зарплат, не операційка. */
export const MOTIVATION_EDIT_ROLES = ["ADMIN", "MANAGER"];

export const RULE_TYPE_LABELS: Record<MotivationRuleType, string> = {
  PERCENT_OF_PROFIT: "% від прибутку в зібраному",
  PERCENT_OF_COLLECTED: "% від зібраних коштів",
  PLAN_BONUS_FIXED: "Фіксований бонус за план",
  PLAN_BONUS_PERCENT: "% за виконання плану",
  TIERED_PERCENT: "Ставка за рівнем виконання",
  OVERDUE_PENALTY: "Утримання за прострочку",
};

export const RULE_TYPE_HINTS: Record<MotivationRuleType, string> = {
  PERCENT_OF_PROFIT: "Відсоток від прибутку в тих грошах, які клієнти реально заплатили.",
  PERCENT_OF_COLLECTED: "Відсоток від усієї зібраної суми, без огляду на маржу.",
  PLAN_BONUS_FIXED: "Разова сума, якщо виконання плану потрапило в заданий діапазон.",
  PLAN_BONUS_PERCENT: "Відсоток від зібраного, якщо план виконано.",
  TIERED_PERCENT: "Ставка діє лише у своєму діапазоні виконання: 0–80% → одна, 100%+ → інша.",
  OVERDUE_PENALTY: "Утримує відсоток заробленого за кожен відсоток простроченої дебіторки понад допуск.",
};

/** Які поля має сенс заповнювати для кожного типу правила. */
export const RULE_FIELDS: Record<
  MotivationRuleType,
  { value: string; plan: boolean; thresholds: boolean; tolerance: boolean; brand: boolean }
> = {
  PERCENT_OF_PROFIT: { value: "Відсоток, %", plan: false, thresholds: false, tolerance: false, brand: true },
  PERCENT_OF_COLLECTED: { value: "Відсоток, %", plan: false, thresholds: false, tolerance: false, brand: true },
  PLAN_BONUS_FIXED: { value: "Сума, ₴", plan: true, thresholds: true, tolerance: false, brand: true },
  PLAN_BONUS_PERCENT: { value: "Відсоток, %", plan: true, thresholds: true, tolerance: false, brand: true },
  TIERED_PERCENT: { value: "Відсоток, %", plan: true, thresholds: true, tolerance: false, brand: true },
  OVERDUE_PENALTY: { value: "Утримання, % за кожен % понад допуск", plan: false, thresholds: false, tolerance: true, brand: false },
};

export const RULE_TYPES = Object.keys(RULE_TYPE_LABELS) as MotivationRuleType[];

/** Метрики планів, які реально рахуються (решта є в enum, але їх ніде не планують). */
export const SUPPORTED_PLAN_METRICS = ["REVENUE", "COLLECTED_AMOUNT"] as const;

export const PLAN_METRIC_LABELS: Record<string, string> = {
  REVENUE: "Оборот",
  COLLECTED_AMOUNT: "Зібрані кошти",
  PROFIT: "Прибуток",
  SKU_COUNT: "Кількість SKU",
  CLIENTS_COUNT: "Кількість клієнтів",
  CHECKPOINTS: "Відвідування",
  OVERDUE_RATIO: "Частка простроченої",
};
