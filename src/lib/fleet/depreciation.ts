/**
 * Бухгалтерська амортизація машини — прямолінійна.
 *
 * Щомісяця списується однакова сума: (ціна − ліквідаційна вартість) / строк.
 * Місяць купівлі не рахується, як у податковому обліку: знос іде з
 * наступного місяця після введення в експлуатацію.
 *
 * Без ціни або строку повертаємо null: «амортизація 0 ₴» збрехала б, що
 * машина нічого не коштує.
 */

import { daysBetween } from "./due";

export type DepreciationInput = {
  purchasePrice: number | null;
  purchaseDay: string | null;
  purchaseOdometerKm: number | null;
  usefulLifeMonths: number | null;
  residualValue: number | null;
  odometerKm: number | null;
  today: string;
};

export type Depreciation = {
  monthly: number;
  monthsElapsed: number;
  monthsLeft: number;
  accrued: number;
  bookValue: number;
  /** Знос на кілометр від купівлі; null — пробіг невідомий або ще нульовий. */
  perKm: number | null;
  kmSincePurchase: number | null;
  fullyDepreciated: boolean;
};

export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export function depreciation(input: DepreciationInput): Depreciation | null {
  const { purchasePrice, purchaseDay, usefulLifeMonths, today } = input;
  if (!purchasePrice || purchasePrice <= 0 || !purchaseDay || !usefulLifeMonths || usefulLifeMonths <= 0) {
    return null;
  }
  const residual = Math.min(Math.max(input.residualValue ?? 0, 0), purchasePrice);
  const base = purchasePrice - residual;
  const monthly = base / usefulLifeMonths;

  const elapsedRaw = daysBetween(purchaseDay, today) < 0 ? 0 : monthsBetween(purchaseDay, today);
  const monthsElapsed = Math.min(Math.max(elapsedRaw, 0), usefulLifeMonths);
  const accrued = monthly * monthsElapsed;

  const kmSincePurchase =
    input.odometerKm != null && input.purchaseOdometerKm != null
      ? Math.max(input.odometerKm - input.purchaseOdometerKm, 0)
      : null;

  return {
    monthly,
    monthsElapsed,
    monthsLeft: usefulLifeMonths - monthsElapsed,
    accrued,
    bookValue: purchasePrice - accrued,
    perKm: kmSincePurchase && kmSincePurchase > 0 ? accrued / kmSincePurchase : null,
    kmSincePurchase,
    fullyDepreciated: monthsElapsed >= usefulLifeMonths,
  };
}
