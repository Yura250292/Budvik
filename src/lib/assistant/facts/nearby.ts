/**
 * Хто поруч зі мною просто зараз.
 *
 * Найчастіше питання в полі не «кого відвідати сьогодні», а «я вже тут,
 * маю сорок хвилин — до кого заскочити». План дня на нього не відповідає:
 * він складений зранку й не знає, що клієнт відмінив зустріч, а торговий
 * стоїть у Стрию.
 *
 * ПОЗИЦІЯ — З ТРЕКУ, а не з браузера. Кабінет відкривають і з ноутбука в
 * офісі, де геолокація покаже центр міста; трек же пише саме той пристрій,
 * який їде з людиною. Ціна цього рішення — свіжість: точка може бути
 * годинної давності, і про це треба сказати прямо, а не показувати
 * «поруч» те, що за сорок кілометрів.
 *
 * ВІДСТАНЬ ПО ПРЯМІЙ. Дорогою вийде більше — інколи вдвічі, якщо між вами
 * річка. Але маршрут через OSRM на два десятки клієнтів коштує секунд, а
 * питання тут інше: «хто поруч узагалі», не «скільки хвилин їхати».
 */

import { prisma } from "@/lib/prisma";
import { agingByCounterparty } from "@/lib/analytics/money-facts";
import { myClientsCte } from "@/lib/assistant/facts/sql";

/** Скільки годин точка треку ще вважається «зараз». */
export const POSITION_FRESH_HOURS = 3;

/** Радіус пошуку за замовчуванням, км. */
const DEFAULT_RADIUS_KM = 15;

const EARTH_KM = 6371;

type ClientRow = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  mine: boolean;
  lastDocAt: Date | null;
};

export type NearbyClient = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  km: number;
  mine: boolean;
  debt: number;
  overdue: number;
  daysSinceLast: number | null;
};

export type NearbyResult =
  | { position: null; reason: "немає треку" }
  | {
      position: { lat: number; lng: number; at: Date; ageMinutes: number; fresh: boolean };
      radiusKm: number;
      clients: NearbyClient[];
    };

/** Відстань по прямій між двома точками, км. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

export async function nearbyClients(
  repId: string,
  { radiusKm = DEFAULT_RADIUS_KM, limit = 8 }: { radiusKm?: number; limit?: number } = {}
): Promise<NearbyResult> {
  const point = await prisma.trackPoint.findFirst({
    where: { userId: repId },
    orderBy: { recordedAt: "desc" },
    select: { lat: true, lng: true, recordedAt: true },
  });

  if (!point) return { position: null, reason: "немає треку" };

  const ageMinutes = Math.round((Date.now() - point.recordedAt.getTime()) / 60_000);

  /**
   * Спершу рамка в градусах, і лише потім точна відстань.
   *
   * Порахувати гаверсинус для кожного з тисяч контрагентів — це повний
   * прохід таблиці на кожне питання. Рамка ріже вибірку індексом, а
   * заокруглення до квадрата замість кола ми компенсуємо фільтром нижче.
   */
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(0.2, Math.cos((point.lat * Math.PI) / 180)));

  const rows = await prisma.$queryRaw<ClientRow[]>`
    WITH ${myClientsCte(repId)}
    SELECT
      c.id, c.name, c.address, c.phone,
      c."deliveryLat" AS lat, c."deliveryLng" AS lng,
      (c.id IN (SELECT id FROM my_clients)) AS mine,
      (SELECT MAX(s."createdAt") FROM "SalesDocument" s
        WHERE s."counterpartyId" = c.id AND s."docType" <> 'RETURN') AS "lastDocAt"
    FROM "Counterparty" c
    WHERE c."isActive"
      AND c."deliveryLat" IS NOT NULL AND c."deliveryLng" IS NOT NULL
      AND c."deliveryLat" BETWEEN ${point.lat - dLat} AND ${point.lat + dLat}
      AND c."deliveryLng" BETWEEN ${point.lng - dLng} AND ${point.lng + dLng}
    LIMIT 200
  `;

  const withDistance = rows
    .map((r) => ({ row: r, km: distanceKm(point, { lat: r.lat, lng: r.lng }) }))
    .filter((r) => r.km <= radiusKm)
    // Свої першими на однаковій відстані: чужого магазину торговий не
    // знає, і заїзд туди без причини коштує тих самих сорока хвилин.
    .sort((a, b) => a.km - b.km || Number(b.row.mine) - Number(a.row.mine))
    .slice(0, limit);

  const aging = await agingByCounterparty(withDistance.map((r) => r.row.id));

  return {
    position: {
      lat: point.lat,
      lng: point.lng,
      at: point.recordedAt,
      ageMinutes,
      fresh: ageMinutes <= POSITION_FRESH_HOURS * 60,
    },
    radiusKm,
    clients: withDistance.map(({ row, km }) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      phone: row.phone,
      km: Math.round(km * 10) / 10,
      mine: row.mine,
      debt: Math.round(aging.get(row.id)?.debt ?? 0),
      overdue: Math.round(aging.get(row.id)?.overdue ?? 0),
      daysSinceLast: row.lastDocAt
        ? Math.round((Date.now() - row.lastDocAt.getTime()) / 86_400_000)
        : null,
    })),
  };
}
