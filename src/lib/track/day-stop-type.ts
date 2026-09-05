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
  /** Наскрізний номер обʼїзду, 1..N — той самий, що на карті. */
  sequence: number;
  /** Номер рядка в маршрутному листі 1С: його називають диспетчеру. */
  sheetSeq: number;
  amount: number;
  debtAmount: number;
  /** PICKUP/ERRAND — бонусна поїздка: без товару й без інкасації */
  kind: "DELIVERY" | "PICKUP" | "ERRAND";
  notes: string | null;
  /**
   * Коментар лишається в типі, хоч у списку дня його й не видно: саме він
   * пояснює минулу відмітку, коли водій відкриває чужий за часом день і
   * питає себе, чому точка червона.
   */
  visit: {
    status: string;
    money: string;
    collectedAmount: number | null;
    comment?: string | null;
  } | null;
};
