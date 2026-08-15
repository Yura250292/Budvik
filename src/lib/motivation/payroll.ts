/**
 * Розрахунок мотивації по валу — формули таблиці «Мотивація Торговий Відділ».
 *
 * Вал по кожній валюті вносять окремо, бо собівартість товару живе у валюті
 * закупівлі: болгарку купили за $23, продали, коли ті самі гривні стали
 * коштувати $19 — у гривнях наче плюс, а в доларах мінус. Тому вал спершу
 * рахується у валюті партії, і лише на виплаті зводиться в гривню за
 * курсом місяця.
 *
 * K = вал₴ + вал$ × курс$ + вал€ × курс€ + валzł × курсzł − бонуси клієнтам
 * Бонус = K × сходинка(% виконання плану), не менше нуля.
 * Групи «за дужками» (APRO тощо) в K не входять — їхній бонус окремий:
 * продажі групи × ручний % × курс валюти групи.
 *
 * Все тут — чисті функції: той самий код рахує і на сервері, і наживо
 * в таблиці, поки адмін друкує цифри.
 */

/** Валюти, в яких ведеться вал і продажі груп. */
export type PayrollCurrency = "UAH" | "USD" | "EUR" | "PLN";

export interface PayrollRates {
  usdRate: number;
  eurRate: number;
  plnRate: number;
}

/**
 * Сходинки бонусу. Читається так: виконання < steps[0].limit → steps[0].percent,
 * далі ≤ steps[i].limit → steps[i].percent, понад останню межу → topPercent.
 * Типово: < 100% → 30, 100–120% → 35, > 120% → 40.
 */
export interface PayrollTiers {
  steps: Array<{ limit: number; percent: number }>;
  topPercent: number;
}

export const DEFAULT_TIERS: PayrollTiers = {
  steps: [
    { limit: 100, percent: 30 },
    { limit: 120, percent: 35 },
  ],
  topPercent: 40,
};

/** Вхідні поля рядка торгового (те, що зберігається). */
export interface PayrollEntryInput {
  repId: string;
  workDays: number;
  planAmount: number;
  factAmount: number;
  grossUah: number;
  grossUsd: number;
  grossEur: number;
  grossPln: number;
  clientBonuses: number;
}

export interface TermGroupInput {
  id: string;
  name: string;
  currency: PayrollCurrency;
}

export interface TermEntryInput {
  groupId: string;
  repId: string;
  salesAmount: number;
  rentCoef: number | null;
  bonusPercent: number;
}

export interface TermBonus {
  groupId: string;
  /** Продажі групи у валюті групи */
  salesAmount: number;
  rentCoef: number | null;
  bonusPercent: number;
  /** Бонус у гривнях: продажі × % × курс */
  bonusUah: number;
}

export interface PayrollRow {
  repId: string;
  /** % виконання плану; null — плану немає (ділити нема на що) */
  attainment: number | null;
  /** Застосована сходинка, % від K */
  appliedPercent: number;
  /** Вал загальний у грн після курсів і мінус бонуси клієнтам */
  totalGrossUah: number;
  /** Бонус за вал: K × сходинка, не менше нуля */
  baseBonus: number;
  /** Бонуси по групах з індивідуальними умовами */
  termBonuses: TermBonus[];
  /** Разом до виплати */
  total: number;
}

/** Курс валюти в гривню; UAH — одиниця. */
export function rateFor(currency: PayrollCurrency, rates: PayrollRates): number {
  switch (currency) {
    case "UAH":
      return 1;
    case "USD":
      return rates.usdRate;
    case "EUR":
      return rates.eurRate;
    case "PLN":
      return rates.plnRate;
  }
}

/**
 * Сходинка за % виконання. Межі — як їх промовляють: «менше 100» строго,
 * «100–120» включно з обома краями, «більше 120» — решта.
 */
export function tierPercent(attainment: number | null, tiers: PayrollTiers): number {
  if (attainment === null) return 0;
  const steps = tiers.steps;
  if (steps.length > 0 && attainment < steps[0].limit) return steps[0].percent;
  for (let i = 1; i < steps.length; i++) {
    if (attainment <= steps[i].limit) return steps[i].percent;
  }
  return tiers.topPercent;
}

/** K: вал усіх валют у гривні мінус бонуси клієнтам. */
export function totalGrossUah(e: PayrollEntryInput, rates: PayrollRates): number {
  return (
    e.grossUah +
    e.grossUsd * rates.usdRate +
    e.grossEur * rates.eurRate +
    e.grossPln * rates.plnRate -
    e.clientBonuses
  );
}

/** Повний рядок розрахунку одного торгового. */
export function computeRow(
  entry: PayrollEntryInput,
  rates: PayrollRates,
  tiers: PayrollTiers,
  groups: TermGroupInput[],
  termEntries: TermEntryInput[]
): PayrollRow {
  const attainment = entry.planAmount > 0 ? (entry.factAmount / entry.planAmount) * 100 : null;
  const k = totalGrossUah(entry, rates);
  // Вал нульовий чи від'ємний (повернення переважили) — сходинка не
  // застосовується: бонус не буває від'ємним, і 30% від нуля показувати нема чого
  const appliedPercent = k > 0 ? tierPercent(attainment, tiers) : 0;
  const baseBonus = Math.max(0, (k * appliedPercent) / 100);

  const termBonuses: TermBonus[] = groups.map((g) => {
    const t = termEntries.find((x) => x.groupId === g.id && x.repId === entry.repId);
    const salesAmount = t?.salesAmount ?? 0;
    const bonusPercent = t?.bonusPercent ?? 0;
    return {
      groupId: g.id,
      salesAmount,
      rentCoef: t?.rentCoef ?? null,
      bonusPercent,
      bonusUah: Math.max(0, (salesAmount * bonusPercent * rateFor(g.currency, rates)) / 100),
    };
  });

  const total = baseBonus + termBonuses.reduce((s, b) => s + b.bonusUah, 0);
  return { repId: entry.repId, attainment, appliedPercent, totalGrossUah: k, baseBonus, termBonuses, total };
}

/** Розбирає tiers із JSON бази; на сміття відповідає типовою шкалою. */
export function parseTiers(raw: unknown): PayrollTiers {
  const t = raw as Partial<PayrollTiers> | null;
  if (
    !t ||
    !Array.isArray(t.steps) ||
    typeof t.topPercent !== "number" ||
    t.steps.some((s) => typeof s?.limit !== "number" || typeof s?.percent !== "number")
  ) {
    return DEFAULT_TIERS;
  }
  return { steps: t.steps, topPercent: t.topPercent };
}

export const PAYROLL_CURRENCIES: PayrollCurrency[] = ["UAH", "USD", "EUR", "PLN"];

export const CURRENCY_LABELS: Record<PayrollCurrency, string> = {
  UAH: "₴",
  USD: "$",
  EUR: "€",
  PLN: "zł",
};
