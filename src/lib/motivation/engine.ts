/**
 * Рушій мотивації торгових.
 *
 * Наріжний принцип: торговий заробляє з ГРОШЕЙ, ЯКІ ПРИВІЗ У ОФІС, а не
 * з обороту. Продав клієнту, який не заплатив, — не заробив нічого.
 * Дебіторка перестає бути покаранням і стає мотивацією: забери гроші —
 * отримаєш своє.
 *
 * Це відрізняється від наявної логіки в src/lib/erp/sales.ts, де комісія
 * нараховується в момент підтвердження замовлення, ще до відвантаження
 * і до будь-якої оплати.
 *
 * Правила складаються: відсоток + бонус за план + утримання за
 * прострочку рахуються в одному проході й дають один підсумок.
 */

import type { MotivationRuleType, PlanMetric } from "@prisma/client";

/** Одне правило схеми у вигляді, придатному для розрахунку. */
export interface Rule {
  id: string;
  type: MotivationRuleType;
  sortOrder: number;
  brandId: string | null;
  categoryGroup: string | null;
  value: number;
  planMetric: PlanMetric | null;
  thresholdFrom: number | null;
  thresholdTo: number | null;
  overdueTolerance: number | null;
}

/** Факт за період: що торговий реально зробив. */
export interface PeriodFacts {
  /** Сума зібраних грошей за період */
  collectedAmount: number;
  /** Прибуток у зібраних грошах (пропорційно маржі накладних) */
  collectedProfit: number;
  /** Розбивка по брендах: brandId → { collected, profit } */
  byBrand: Map<string, { collected: number; profit: number }>;
  /** Загальна дебіторка на кінець періоду */
  receivableTotal: number;
  /** Прострочена частина дебіторки */
  receivableOverdue: number;
  /** Виконання планів: `${metric}:${brandId ?? "ALL"}` → відсоток 0..N */
  planAttainment: Map<string, number>;
}

export interface RuleResult {
  ruleId: string;
  type: MotivationRuleType;
  label: string;
  /** База, від якої рахували */
  base: number;
  /** Нарахування (може бути від'ємним для утримань) */
  amount: number;
  /** Пояснення для торгового — щоб цифра не була «з неба» */
  explanation: string;
}

export interface MotivationResult {
  lines: RuleResult[];
  /** Сума всіх нарахувань, не менше нуля */
  total: number;
  /** Утримання окремо — щоб було видно, скільки втрачено */
  penalties: number;
  /** Скільки було б без утримань */
  gross: number;
}

const planKey = (metric: PlanMetric, brandId: string | null) =>
  `${metric}:${brandId ?? "ALL"}`;

/** Виконання плану у відсотках; null — плану не встановлено. */
function attainment(facts: PeriodFacts, rule: Rule): number | null {
  if (!rule.planMetric) return null;
  const v = facts.planAttainment.get(planKey(rule.planMetric, rule.brandId));
  return v ?? null;
}

/** База правила з урахуванням обмеження по бренду. */
function baseFor(facts: PeriodFacts, rule: Rule, field: "collected" | "profit"): number {
  if (rule.brandId) {
    const b = facts.byBrand.get(rule.brandId);
    return b ? b[field] : 0;
  }
  return field === "collected" ? facts.collectedAmount : facts.collectedProfit;
}

const money = (n: number) => `${Math.round(n).toLocaleString("uk-UA")} ₴`;
const pct = (n: number) => `${n.toFixed(1)}%`;

/**
 * Рахує винагороду за період.
 *
 * Порядок: спершу нарахування, потім утримання. Утримання не може
 * зробити підсумок від'ємним — торговий не має бути винен компанії
 * за те, що клієнт не заплатив.
 */
export function calculateMotivation(
  rules: Rule[],
  facts: PeriodFacts,
  brandNames: Map<string, string> = new Map()
): MotivationResult {
  const lines: RuleResult[] = [];
  const active = [...rules].sort((a, b) => a.sortOrder - b.sortOrder);

  const brandLabel = (id: string | null) =>
    id ? ` (${brandNames.get(id) || "бренд"})` : "";

  for (const rule of active) {
    switch (rule.type) {
      case "PERCENT_OF_PROFIT": {
        const base = baseFor(facts, rule, "profit");
        const amount = (base * rule.value) / 100;
        lines.push({
          ruleId: rule.id,
          type: rule.type,
          label: `${rule.value}% від прибутку${brandLabel(rule.brandId)}`,
          base,
          amount,
          explanation: `Прибуток у зібраних грошах ${money(base)} × ${rule.value}%`,
        });
        break;
      }

      case "PERCENT_OF_COLLECTED": {
        const base = baseFor(facts, rule, "collected");
        const amount = (base * rule.value) / 100;
        lines.push({
          ruleId: rule.id,
          type: rule.type,
          label: `${rule.value}% від зібраного${brandLabel(rule.brandId)}`,
          base,
          amount,
          explanation: `Зібрано ${money(base)} × ${rule.value}%`,
        });
        break;
      }

      case "PLAN_BONUS_FIXED": {
        const att = attainment(facts, rule);
        if (att == null) break; // плану немає — бонусу немає
        const from = rule.thresholdFrom ?? 100;
        const hit = att >= from && (rule.thresholdTo == null || att <= rule.thresholdTo);
        lines.push({
          ruleId: rule.id,
          type: rule.type,
          label: `Бонус за план${brandLabel(rule.brandId)}`,
          base: att,
          amount: hit ? rule.value : 0,
          explanation: hit
            ? `План виконано на ${pct(att)} → ${money(rule.value)}`
            : `План виконано на ${pct(att)}, бонус від ${pct(from)}`,
        });
        break;
      }

      case "PLAN_BONUS_PERCENT": {
        const att = attainment(facts, rule);
        if (att == null) break;
        const from = rule.thresholdFrom ?? 100;
        const hit = att >= from && (rule.thresholdTo == null || att <= rule.thresholdTo);
        const base = baseFor(facts, rule, "collected");
        lines.push({
          ruleId: rule.id,
          type: rule.type,
          label: `${rule.value}% за виконання плану${brandLabel(rule.brandId)}`,
          base,
          amount: hit ? (base * rule.value) / 100 : 0,
          explanation: hit
            ? `План ${pct(att)} → ${money(base)} × ${rule.value}%`
            : `План ${pct(att)}, бонус від ${pct(from)}`,
        });
        break;
      }

      case "TIERED_PERCENT": {
        // Ставка діє лише в своєму діапазоні виконання плану.
        // Кілька таких правил дають сходинки: 0-80% → 2%, 80-100% → 3%,
        // 100%+ → 5%. Прозоріше за одну формулу з коефіцієнтами.
        const att = attainment(facts, rule);
        if (att == null) break;
        const from = rule.thresholdFrom ?? 0;
        const to = rule.thresholdTo;
        const inTier = att >= from && (to == null || att < to);
        if (!inTier) break;

        const base = baseFor(facts, rule, "profit");
        lines.push({
          ruleId: rule.id,
          type: rule.type,
          label: `${rule.value}% (виконання ${pct(from)}${to ? `–${pct(to)}` : "+"})`,
          base,
          amount: (base * rule.value) / 100,
          explanation: `План ${pct(att)} → ставка ${rule.value}% від ${money(base)}`,
        });
        break;
      }

      case "OVERDUE_PENALTY": {
        // Утримання за прострочену дебіторку. Толерантність — щоб
        // дрібні затримки не з'їдали зарплату: карати за 2% простроченої
        // означає карати за нормальну роботу.
        if (facts.receivableTotal <= 0) break;
        const ratio = (facts.receivableOverdue / facts.receivableTotal) * 100;
        const tolerance = rule.overdueTolerance ?? 0;
        if (ratio <= tolerance) {
          lines.push({
            ruleId: rule.id,
            type: rule.type,
            label: "Прострочена дебіторка",
            base: ratio,
            amount: 0,
            explanation: `Прострочено ${pct(ratio)} — у межах норми (${pct(tolerance)})`,
          });
          break;
        }

        const excess = ratio - tolerance;
        // Утримуємо від уже нарахованого, а не від обороту
        const earned = lines.reduce((s, l) => s + Math.max(0, l.amount), 0);
        const amount = -Math.min(earned, (earned * excess * rule.value) / 100);
        lines.push({
          ruleId: rule.id,
          type: rule.type,
          label: "Утримання за прострочку",
          base: ratio,
          amount,
          explanation:
            `Прострочено ${pct(ratio)}, норма ${pct(tolerance)} → ` +
            `утримано ${money(Math.abs(amount))}`,
        });
        break;
      }
    }
  }

  const gross = lines.reduce((s, l) => s + Math.max(0, l.amount), 0);
  const penalties = lines.reduce((s, l) => s + Math.min(0, l.amount), 0);
  // Торговий не має бути винен компанії — підсумок не нижче нуля
  const total = Math.max(0, gross + penalties);

  return { lines, total, penalties: Math.abs(penalties), gross };
}

/** Відсоток виконання плану. Для OVERDUE_RATIO менше = краще. */
export function attainmentPercent(
  metric: PlanMetric,
  actual: number,
  target: number
): number {
  if (target <= 0) return 0;
  if (metric === "OVERDUE_RATIO") {
    // Ціль «не більше N%»: 0% простроченої = 100% виконання
    if (actual <= 0) return 100;
    return Math.max(0, Math.min(200, (target / actual) * 100));
  }
  return (actual / target) * 100;
}
