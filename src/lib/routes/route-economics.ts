/**
 * Економіка рейсу доставки: що він приносить і що коштує.
 *
 * Досі план дня казав лише «рейс не окупиться» за одним порогом суми
 * (minFarAmount у plan-day.ts), а в розмову йшли кілометри без грошей.
 * Керівник же питає інакше: скільки фірма заробить на цьому виїзді після
 * пального й оплати водію. Тут ці три числа зводяться в одне.
 *
 * - **Вал** — сума накладних мінус собівартість їхніх рядків, як у
 *   revenueByRep (analytics/facts.ts): лише рядки з відомою собівартістю.
 *   Коли частина накладних без неї, невідому частину оцінюємо за відсотком
 *   валу відомої і кажемо про це (`marginEstimated`) — інакше рейс з однією
 *   «порожньою» накладною виглядав би збитковим на рівному місці.
 * - **Пальне** — за нормою машини водія (SalesVehicle) з буфером плану,
 *   на кілометри З ДОРОГОЮ НАЗАД. Порожній пробіг до складу теж палить.
 * - **Водій** — та сама формула, що й зарплата (drivers/payroll.ts): ставка
 *   за лист за тіром кілометрів, унікальні адреси місто/область, відсоток
 *   від суми. Для плану боргів у листі ще немає, тож база відсотка — уся сума.
 *
 * Невідомі кілометри не вигадуються: без них немає ні пального, ні ставки,
 * ні результату — лише вал.
 *
 * Чиста функція `routeEconomics` — окремо від читання бази, щоб еталони
 * можна було закріпити без бази (scripts/check-route-economics.mts).
 */

import { prisma } from "@/lib/prisma";
import { calculateRouteSheetPay, DEFAULT_RATES, type PayrollRates } from "@/lib/drivers/payroll";
import { addressKey, classifyZone, type DeliveryZoneValue } from "@/lib/drivers/zone";
import { fuelCostFor, type FuelParams } from "@/lib/routes/optimize";
import { VEHICLE_DEFAULTS } from "@/lib/analytics/facts";

export type EconomicsStop = {
  salesDocumentId: string;
  counterpartyId: string;
  address: string | null;
  lat: number;
  lng: number;
  amount: number;
  /** Counterparty.deliveryZone — ручна зона клієнта, пріоритетніша за полігон */
  zoneOverride: DeliveryZoneValue | null;
};

/** Сума накладної і собівартість її рядків; cost = null — невідома. */
export type DocMargin = { amount: number; cost: number | null };

export type RouteEconomics = {
  /** Кілометри, на які пораховано пальне й ставку (з дорогою назад) */
  km: number | null;
  amount: number;
  /** Вал по накладних з відомою собівартістю */
  marginKnown: number | null;
  /** Вал з оцінкою невідомої частини; null — собівартість невідома ніде */
  margin: number | null;
  marginEstimated: boolean;
  /** Частка суми, для якої собівартість відома, 0..1 */
  costedShare: number;
  fuel: number | null;
  driverPay: number | null;
  cityPoints: number;
  oblastPoints: number;
  /** Вал − пальне − водій */
  result: number | null;
};

export function routeEconomics(input: {
  km: number | null;
  stops: EconomicsStop[];
  margins: Map<string, DocMargin>;
  fuel: FuelParams;
  rates: PayrollRates;
}): RouteEconomics {
  const { km, stops, margins, fuel, rates } = input;

  let amount = 0;
  let costedAmount = 0;
  let marginKnown = 0;
  for (const s of stops) {
    const m = margins.get(s.salesDocumentId);
    // Накладної в базі не знайшли — сума з точки плану, валу по ній немає.
    const docAmount = m?.amount ?? s.amount;
    amount += docAmount;
    if (m && m.cost !== null) {
      costedAmount += docAmount;
      marginKnown += docAmount - m.cost;
    }
  }

  const costedShare = amount > 0 ? costedAmount / amount : 0;
  const hasMargin = costedAmount > 0;
  const margin = hasMargin ? marginKnown + (amount - costedAmount) * (marginKnown / costedAmount) : null;

  // Точки вигрузки — унікальні адреси, як у зарплаті: три накладні на одну
  // адресу водій вивантажує за один заїзд.
  const zoneByKey = new Map<string, DeliveryZoneValue>();
  for (const s of stops) {
    const key = addressKey(s.address, s.counterpartyId, s.salesDocumentId);
    if (zoneByKey.has(key)) continue;
    zoneByKey.set(key, classifyZone({ override: s.zoneOverride, lat: s.lat, lng: s.lng, address: s.address }).zone);
  }
  const cityPoints = [...zoneByKey.values()].filter((z) => z === "CITY").length;
  const oblastPoints = zoneByKey.size - cityPoints;

  const fuelUah = km === null ? null : fuelCostFor(km, fuel);
  const driverPay =
    km === null
      ? null
      : Math.round(
          calculateRouteSheetPay(
            {
              routeSheetId: "plan",
              number: "план",
              day: "",
              distanceKm: km,
              cityPoints,
              oblastPoints,
              ordersTotal: amount,
              debtsTotal: 0,
            },
            rates
          ).total
        );

  return {
    km,
    amount: Math.round(amount),
    marginKnown: hasMargin ? Math.round(marginKnown) : null,
    margin: margin === null ? null : Math.round(margin),
    marginEstimated: hasMargin && costedAmount < amount,
    costedShare,
    fuel: fuelUah,
    driverPay,
    cityPoints,
    oblastPoints,
    result:
      margin === null || fuelUah === null || driverPay === null ? null : Math.round(margin) - fuelUah - driverPay,
  };
}

/* ── Читання фактів (лише SELECT) ──────────────────────────────────────── */

/** Буфер плану на затори й прогрів — той самий, що в optimize-day. */
export const PLAN_FUEL_BUFFER_PERCENT = 10;

/**
 * Норма пального водія для плану: з SalesVehicle, інакше типове авто
 * розвозки. Буфер плановий — на відміну від fuelCost у аналітиці, де
 * рахується вже проїханий одометром пробіг.
 */
export async function planFuelByDriver(
  driverIds: string[],
  fallback: FuelParams
): Promise<Map<string, FuelParams>> {
  const rows = driverIds.length
    ? await prisma.salesVehicle.findMany({
        where: { repId: { in: driverIds } },
        select: { repId: true, fuelConsumption: true, fuelPricePerL: true },
      })
    : [];
  const byDriver = new Map<string, FuelParams>();
  for (const id of driverIds) {
    const v = rows.find((r) => r.repId === id);
    byDriver.set(
      id,
      v
        ? {
            consumption: v.fuelConsumption ?? VEHICLE_DEFAULTS.fuelConsumption,
            pricePerUnit: v.fuelPricePerL ?? VEHICLE_DEFAULTS.fuelPricePerL,
            bufferPercent: PLAN_FUEL_BUFFER_PERCENT,
          }
        : fallback
    );
  }
  return byDriver;
}

/** Сума й собівартість накладних — той самий вал, що в revenueByRep. */
export async function loadDocMargins(docIds: string[]): Promise<Map<string, DocMargin>> {
  if (docIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ id: string; amount: number; cost: number | null }[]>`
    SELECT s.id, s."totalAmount"::float AS amount, c.cost::float AS cost
    FROM "SalesDocument" s
    LEFT JOIN LATERAL (
      SELECT SUM(i."purchasePrice" * i.quantity) AS cost
      FROM "SalesDocumentItem" i
      WHERE i."salesDocumentId" = s.id AND i."purchasePrice" > 0
    ) c ON TRUE
    WHERE s.id = ANY(${docIds})
  `;
  return new Map(rows.map((r) => [r.id, { amount: r.amount, cost: r.cost }]));
}

/** Ручні зони клієнтів (Counterparty.deliveryZone). */
export async function loadZoneOverrides(counterpartyIds: string[]): Promise<Map<string, DeliveryZoneValue | null>> {
  if (counterpartyIds.length === 0) return new Map();
  const rows = await prisma.counterparty.findMany({
    where: { id: { in: counterpartyIds } },
    select: { id: true, deliveryZone: true },
  });
  return new Map(rows.map((r) => [r.id, (r.deliveryZone as DeliveryZoneValue | null) ?? null]));
}

/**
 * Ставки зарплати водіїв без запису.
 *
 * getRates() у payroll-facts робить upsert рядка за замовчуванням — для
 * екрана налаштувань це доречно, а план і конектор не мають писати в базу
 * навіть так. Рядка немає — дефолти, ті самі, що створив би upsert.
 */
export async function readPayrollRates(): Promise<PayrollRates> {
  const row = await prisma.driverPayrollRates.findUnique({ where: { id: "default" } });
  if (!row) return DEFAULT_RATES;
  return {
    kmTier1Max: row.kmTier1Max,
    kmTier1Rate: row.kmTier1Rate,
    kmTier2Max: row.kmTier2Max,
    kmTier2Rate: row.kmTier2Rate,
    kmTier3Rate: row.kmTier3Rate,
    cityPointRate: row.cityPointRate,
    oblastPointRate: row.oblastPointRate,
    turnoverPercent: row.turnoverPercent,
  };
}
