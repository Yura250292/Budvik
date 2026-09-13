/**
 * Те, що віддає GET /api/erp/delivery-routes/day.
 *
 * Типи описані на клієнті, а не згенеровані: елемент маршруту навмисно
 * лишається надмножиною відповіді спискового GET, щоб AssignDriverBar і
 * RoutePlanPanel приймали його без перетворень.
 */

import type { RouteProgress } from "@/lib/routes/progress";

export type DayStopRow = {
  id: string;
  sequence: number;
  kind: "DELIVERY" | "PICKUP" | "ERRAND";
  status: string;
  title: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  payOverride: number | null;
  zoneOverride: "CITY" | "OBLAST" | null;
  notes: string | null;
  salesDocument?: { id: string; number: string; totalAmount: number } | null;
  counterparty?: {
    id: string;
    name: string;
    deliveryLat?: number | null;
    deliveryLng?: number | null;
    geoSource?: string | null;
  } | null;
};

export type DayDriver = { id: string; name: string | null; hasTelegram: boolean };

export type RouteItem = {
  kind: "route";
  id: string;
  number: string;
  status: string;
  date: string;
  day: string;
  driverId: string | null;
  driver: (DayDriver & { id: string }) | null;
  vehicleInfo: string | null;
  totalDistanceKm: number | null;
  actualKm: number | null;
  notes: string | null;
  assignedAt: string | null;
  linkSentAt: string | null;
  linkSentVia: string | null;
  linkStale: boolean;
  stops: DayStopRow[];
  _count?: { stops: number };
  progress: RouteProgress;
  /** Лист 1С, з якого зроблено цей маршрут (звʼязок — номер «1С-…») */
  sheet: {
    id: string;
    number: string;
    posted: boolean;
    stopsCount: number;
    /** Точки, які обмін привіз у лист уже після конверсії */
    newStops: Array<{ id: string; name: string; address: string | null }>;
  } | null;
  /** Другий переданий маршрут того ж водія в той самий день */
  dayConflict: { id: string; number: string; status: string } | null;
};

export type SheetItem = {
  kind: "sheet";
  id: string;
  number: string;
  day: string;
  posted: boolean;
  driverId: string | null;
  driverName: string | null;
  driverName1C: string | null;
  vehicle: string | null;
  distanceKm: number;
  ordersTotal: number;
  debtsTotal: number;
  stopsCount: number;
  stops: Array<{
    id: string;
    sequence: number;
    name: string;
    address: string | null;
    amount: number;
    debtAmount: number;
    hasCoords: boolean;
    geoSource: string | null;
  }>;
  existingRoute: { id: string; number: string; status: string } | null;
  blocker: "NO_DRIVER" | "NO_STOPS" | null;
};

export type DayResponse = {
  day: string;
  today: string;
  drivers: DayDriver[];
  items: Array<RouteItem | SheetItem>;
};

/** Вільне підтверджене замовлення — те, що можна поставити в маршрут. */
export type FreeOrder = {
  id: string;
  number: string;
  totalAmount: number;
  counterparty?: { name: string } | null;
};

export const ROUTE_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Чернетка",
  ASSIGNED: "Передано водію",
  IN_PROGRESS: "В дорозі",
  COMPLETED: "Завершений",
  CANCELLED: "Скасований",
};
