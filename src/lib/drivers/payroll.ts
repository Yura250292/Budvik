/**
 * Розрахунок зарплати водія за маршрутними листами.
 *
 * Наріжна відмінність від мотивації торгових: водій заробляє з ВИКОНАНОЇ
 * РОБОТИ, а не з грошей. Проїхав — отримав ставку; вигрузив у точці —
 * отримав за точку. Відсоток від суми в листі — третя, найменша частина.
 *
 * Три складові на кожен маршрутний лист:
 *   1. Ставка за пробіг — сходинками (до 100 км, 100–300, понад 300).
 *      Рахується ЗА КОЖЕН ЛИСТ, а не за день: два виїзди — дві ставки.
 *   2. За кожну УНІКАЛЬНУ точку вигрузки, дорожче в місті, ніж в області.
 *      Три накладні на одну адресу — одна точка (дедуплікація живе в
 *      payroll-facts.ts, сюди приходять уже пораховані точки).
 *   3. Відсоток від (сума замовлень у листі − борги, які водій забирає за
 *      попередні доставки). Обидві цифри — з маршрутного листа 1С.
 *
 * Четверта складова — ручні надбавки (Нова пошта, підміна) — у 1С не
 * існує і додається адміном руками; вона мержиться на рівні періоду, а не
 * листа, бо не належить жодному конкретному виїзду.
 *
 * Модуль чистий: жодного Prisma, лише арифметика. Факти будує
 * payroll-facts.ts. Так само влаштований src/lib/motivation/engine.ts.
 */

/** Ставки з DriverPayrollRates у вигляді, придатному для розрахунку. */
export interface PayrollRates {
  /** Ставка за лист, якщо пробіг менший за kmTier1Max */
  kmTier1Max: number;
  kmTier1Rate: number;
  /** Верхня межа середнього тіру; включно (300 км → kmTier2Rate) */
  kmTier2Max: number;
  kmTier2Rate: number;
  /** Понад kmTier2Max */
  kmTier3Rate: number;

  cityPointRate: number;
  oblastPointRate: number;

  /** У відсотках: 0.5 означає 0,5% */
  turnoverPercent: number;
}

/** Один маршрутний лист у вигляді, готовому до розрахунку. */
export interface RouteSheetFacts {
  routeSheetId: string;
  number: string;
  /** Київська дата, YYYY-MM-DD */
  day: string;
  distanceKm: number;
  /** Унікальні адреси в межах листа */
  cityPoints: number;
  oblastPoints: number;
  /** Точки, для яких зону визначити не вдалося — оплачені як область */
  unknownZonePoints?: number;
  ordersTotal: number;
  debtsTotal: number;
}

export interface DriverBonusInput {
  id: string;
  /** Київська дата, YYYY-MM-DD */
  day: string;
  amount: number;
  reason: string;
}

export type PayrollLineKind =
  | "KM_BASE"
  | "CITY_POINTS"
  | "OBLAST_POINTS"
  | "TURNOVER_PERCENT"
  | "MANUAL_BONUS";

export interface PayrollLine {
  kind: PayrollLineKind;
  label: string;
  /** База, від якої рахували: км, кількість точок або гривні */
  base: number;
  amount: number;
  /** Пояснення для водія — щоб цифра не була «з неба» */
  explanation: string;
}

export interface RouteSheetPayroll {
  facts: RouteSheetFacts;
  lines: PayrollLine[];
  total: number;
}

export interface DriverPeriodPayroll {
  driverId: string;
  sheets: RouteSheetPayroll[];
  bonusLines: PayrollLine[];
  /** Підсумки для таблиці зведення */
  sheetsCount: number;
  totalKm: number;
  cityPoints: number;
  oblastPoints: number;
  /** Сума баз відсотка за період — те, з чого рахували 0,5% */
  turnoverBase: number;
  sheetsTotal: number;
  bonusesTotal: number;
  total: number;
}

const money = (n: number) => `${Math.round(n).toLocaleString("uk-UA")} ₴`;
const km = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} км`;

/**
 * Ставка за пробіг. Межі входять у СЕРЕДНІЙ тір: 100 км → 700, 300 км → 700.
 * Так задав власник: «100–300 км = 700 грн», тобто рівно 100 вже не «до 100».
 */
export function kmTier(
  distanceKm: number,
  rates: PayrollRates
): { rate: number; label: string } {
  if (distanceKm < rates.kmTier1Max) {
    return { rate: rates.kmTier1Rate, label: `до ${rates.kmTier1Max} км` };
  }
  if (distanceKm <= rates.kmTier2Max) {
    return {
      rate: rates.kmTier2Rate,
      label: `${rates.kmTier1Max}–${rates.kmTier2Max} км`,
    };
  }
  return { rate: rates.kmTier3Rate, label: `понад ${rates.kmTier2Max} км` };
}

/** Нарахування за один маршрутний лист. */
export function calculateRouteSheetPay(
  facts: RouteSheetFacts,
  rates: PayrollRates
): RouteSheetPayroll {
  const lines: PayrollLine[] = [];

  const tier = kmTier(facts.distanceKm, rates);
  lines.push({
    kind: "KM_BASE",
    label: `Ставка за пробіг (${tier.label})`,
    base: facts.distanceKm,
    amount: tier.rate,
    explanation: `${km(facts.distanceKm)} → тариф «${tier.label}» = ${money(tier.rate)}`,
  });

  if (facts.cityPoints > 0) {
    const amount = facts.cityPoints * rates.cityPointRate;
    lines.push({
      kind: "CITY_POINTS",
      label: "Точки в місті",
      base: facts.cityPoints,
      amount,
      explanation: `${facts.cityPoints} × ${money(rates.cityPointRate)} за точку`,
    });
  }

  if (facts.oblastPoints > 0) {
    const amount = facts.oblastPoints * rates.oblastPointRate;
    const unknown = facts.unknownZonePoints ?? 0;
    lines.push({
      kind: "OBLAST_POINTS",
      label: "Точки в області",
      base: facts.oblastPoints,
      amount,
      explanation:
        `${facts.oblastPoints} × ${money(rates.oblastPointRate)} за точку` +
        (unknown > 0 ? ` (з них ${unknown} без визначеної зони)` : ""),
    });
  }

  // База не може бути від'ємною: якщо водій забрав боргів більше, ніж
  // привіз товару, він не «винен» компанії відсоток — просто немає бази.
  const turnoverBase = Math.max(0, facts.ordersTotal - facts.debtsTotal);
  if (turnoverBase > 0 && rates.turnoverPercent > 0) {
    const amount = (turnoverBase * rates.turnoverPercent) / 100;
    lines.push({
      kind: "TURNOVER_PERCENT",
      label: `${rates.turnoverPercent}% від суми в листі`,
      base: turnoverBase,
      amount,
      explanation:
        `Замовлення ${money(facts.ordersTotal)} − борги ${money(facts.debtsTotal)} = ` +
        `${money(turnoverBase)} × ${rates.turnoverPercent}%`,
    });
  }

  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { facts, lines, total };
}

/**
 * Зарплата водія за період: усі його листи плюс ручні надбавки.
 *
 * Надбавки не проходять крізь розрахунок листів — вони самостійні рядки
 * з готовою сумою. Від'ємна надбавка (утримання) дозволена й може
 * опустити підсумок нижче нуля лише якщо адмін свідомо ввів таку суму;
 * автоматичних утримань у водіїв немає.
 */
export function calculateDriverPeriod(
  driverId: string,
  sheetFacts: RouteSheetFacts[],
  bonuses: DriverBonusInput[],
  rates: PayrollRates
): DriverPeriodPayroll {
  const sheets = sheetFacts.map((f) => calculateRouteSheetPay(f, rates));

  const bonusLines: PayrollLine[] = bonuses.map((b) => ({
    kind: "MANUAL_BONUS" as const,
    label: b.reason,
    base: 0,
    amount: b.amount,
    explanation: `${b.day}: ${money(b.amount)} — ${b.reason}`,
  }));

  const sheetsTotal = sheets.reduce((s, x) => s + x.total, 0);
  const bonusesTotal = bonusLines.reduce((s, l) => s + l.amount, 0);

  return {
    driverId,
    sheets,
    bonusLines,
    sheetsCount: sheets.length,
    totalKm: sheetFacts.reduce((s, f) => s + f.distanceKm, 0),
    cityPoints: sheetFacts.reduce((s, f) => s + f.cityPoints, 0),
    oblastPoints: sheetFacts.reduce((s, f) => s + f.oblastPoints, 0),
    turnoverBase: sheetFacts.reduce(
      (s, f) => s + Math.max(0, f.ordersTotal - f.debtsTotal),
      0
    ),
    sheetsTotal,
    bonusesTotal,
    total: sheetsTotal + bonusesTotal,
  };
}

/** Дефолти на випадок, коли рядка ставок ще немає в базі. */
export const DEFAULT_RATES: PayrollRates = {
  kmTier1Max: 100,
  kmTier1Rate: 500,
  kmTier2Max: 300,
  kmTier2Rate: 700,
  kmTier3Rate: 1000,
  cityPointRate: 25,
  oblastPointRate: 15,
  turnoverPercent: 0.5,
};
