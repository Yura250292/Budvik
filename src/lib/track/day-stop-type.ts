/**
 * Точка дня очима планшета.
 *
 * Тип жив у TabletDayMap, поки екран дня був картою. Тепер екран — це
 * список, карти в ньому немає, і тримати спільний тип у компоненті карти
 * було б прив'язкою до того, чого більше не існує.
 */

export type DayStop = {
  key: string;
  counterpartyId: string | null;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  geoSource: string | null;
  sequence: number;
  amount: number;
  debtAmount: number;
  /** PICKUP/ERRAND — бонусна поїздка: без товару й без інкасації */
  kind: "DELIVERY" | "PICKUP" | "ERRAND";
  notes: string | null;
  visit: { status: string; money: string; collectedAmount: number | null } | null;
};
