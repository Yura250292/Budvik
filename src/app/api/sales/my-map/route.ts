/**
 * Карта торгового: його клієнти точками + маршрут на сьогодні.
 *
 * Окремо від адмінської /api/admin/sales-analytics/client-map, бо тут інша
 * задача. Там керівник оглядає всю команду за період; тут торговий у машині
 * питає «хто поруч і до кого сьогодні». Тому вибірка вужча (тільки свої),
 * період не потрібен — стан рахується на сьогодні, — а у відповіді є те,
 * чого немає в адмінській: борг клієнта й чи уточнено пін.
 *
 * Стани навмисно ті самі, що в аналітиці керівника: торговий і керівник
 * мусять бачити однаковий колір на одному клієнті, інакше розмова про
 * «сплячих» перетворюється на суперечку про визначення.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SOURCE_FILTER } from "@/lib/analytics/facts";
import { DORMANT_DAYS, LOST_DAYS, SLIPPING_FACTOR, type ClientState } from "@/lib/analytics/clients";
import { resolveRouteForDay } from "@/lib/routes/resolve";
import { kyivDate } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["SALES", "ADMIN", "MANAGER"];
const DAY_MS = 86_400_000;
/** Один документ за всю історію — разова покупка, а не втрачений клієнт. */
const MIN_DOCS_FOR_LOST = 2;

type Row = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  geoSource: string | null;
  receivable: number;
  overdue: number;
  firstDocAt: Date | null;
  lastDocAt: Date | null;
  historyDocs: number;
};

/**
 * Стан клієнта на сьогодні — та сама логіка, що в analytics/clients.ts.
 *
 * Дублюється свідомо і мінімально: там класифікація прив'язана до періоду
 * звіту й рахується на купі клієнтів одним SQL, тут потрібен зріз «зараз»
 * для одного торгового. Пороги імпортуються, щоб не розійтися.
 */
function classify(row: Row): ClientState {
  if (!row.lastDocAt || !row.firstDocAt) return "NEW";

  const now = Date.now();
  const daysSinceLast = Math.floor((now - row.lastDocAt.getTime()) / DAY_MS);
  // «Новий» — перший документ за останній місяць.
  if (now - row.firstDocAt.getTime() < 30 * DAY_MS) return "NEW";

  if (daysSinceLast >= LOST_DAYS && row.historyDocs >= MIN_DOCS_FOR_LOST) return "LOST";
  if (daysSinceLast >= DORMANT_DAYS) return "DORMANT";

  const spanDays = Math.max(1, (row.lastDocAt.getTime() - row.firstDocAt.getTime()) / DAY_MS);
  const avgInterval = row.historyDocs > 1 ? spanDays / (row.historyDocs - 1) : spanDays;
  if (daysSinceLast > avgInterval * SLIPPING_FACTOR) return "SLIPPING";
  return "ACTIVE";
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  // Торговий завжди дивиться власну карту, хай що прийде в параметрі —
  // інакше чужий портфель відкривався б підстановкою id у запит.
  const url = new URL(req.url);
  const repId =
    session.user.role === "SALES" ? session.user.id : url.searchParams.get("rep") || session.user.id;

  const day = url.searchParams.get("day") || kyivDate(new Date());

  const [rows, route] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      WITH mine AS (
        SELECT c.id, c.name, c.address, c."deliveryLat" AS lat, c."deliveryLng" AS lng,
               c."geoSource"::text AS "geoSource",
               COALESCE(c."receivableBalance", 0)::float AS receivable,
               (
                 COALESCE(c."debtOverdue30", 0) + COALESCE(c."debtOverdue60", 0) +
                 COALESCE(c."debtOverdue90", 0) + COALESCE(c."debtOverdue90Plus", 0)
               )::float AS overdue
        FROM "Counterparty" c
        WHERE c."isActive"
          AND (
            EXISTS (SELECT 1 FROM "SalesRepClient" s
                     WHERE s."counterpartyId" = c.id AND s."salesRepId" = ${repId})
            OR EXISTS (SELECT 1 FROM "SalesDocument" d
                        WHERE d."counterpartyId" = c.id AND d."salesRepId" = ${repId})
          )
      ),
      hist AS (
        SELECT s."counterpartyId",
               MIN(s."createdAt") FILTER (WHERE s."docType" <> 'RETURN') AS "firstDocAt",
               MAX(s."createdAt") FILTER (WHERE s."docType" <> 'RETURN') AS "lastDocAt",
               COUNT(*) FILTER (WHERE s."docType" <> 'RETURN')::int AS "historyDocs"
        FROM "SalesDocument" s
        WHERE ${SOURCE_FILTER}
          AND s."counterpartyId" IN (SELECT id FROM mine)
        GROUP BY 1
      )
      SELECT m.*,
             h."firstDocAt", h."lastDocAt",
             COALESCE(h."historyDocs", 0)::int AS "historyDocs"
      FROM mine m
      LEFT JOIN hist h ON h."counterpartyId" = m.id
      ORDER BY m.name
    `,
    resolveRouteForDay(repId, day),
  ]);

  /**
   * Клієнти без координат ідуть окремим списком, а не відкидаються.
   *
   * Раніше їх різало прямо в SQL, і виходило замкнене коло: щоб поставити
   * клієнту пін, торговий мав знайти його на карті, а на карту він не
   * потрапляв саме тому, що піна немає. Тепер такий клієнт знаходиться
   * пошуком і пін йому ставиться тапом по карті.
   *
   * У counts вони не входять: підпис під картою рахує намальовані точки.
   */
  type Base = {
    id: string;
    name: string;
    address: string | null;
    state: ClientState;
    geoSource: string | null;
    receivable: number;
    overdue: number;
    daysSinceLast: number | null;
  };

  const counts: Record<string, number> = {};
  const clients: Array<Base & { lat: number; lng: number; approximate: boolean }> = [];
  const unmapped: Base[] = [];

  for (const r of rows) {
    const state = classify(r);
    const point: Base = {
      id: r.id,
      name: r.name,
      address: r.address,
      state,
      geoSource: r.geoSource,
      receivable: r.receivable,
      overdue: r.overdue,
      daysSinceLast: r.lastDocAt
        ? Math.max(0, Math.floor((Date.now() - r.lastDocAt.getTime()) / DAY_MS))
        : null,
    };

    if (r.lat == null || r.lng == null) {
      unmapped.push(point);
      continue;
    }

    counts[state] = (counts[state] ?? 0) + 1;
    clients.push({
      ...point,
      lat: r.lat,
      lng: r.lng,
      /** Скільки клієнтів ще стоять «приблизно» — привід уточнити пін. */
      approximate: r.geoSource !== "MANUAL",
    });
  }

  return NextResponse.json({
    day,
    clients,
    unmapped,
    counts,
    route: route
      ? {
          name: route.name,
          color: route.color,
          totalDistanceKm: route.totalDistanceKm,
          geometry: route.routeGeometry,
          stops: route.stops,
          source: route.source,
        }
      : null,
    approximateCount: clients.filter((c) => c.approximate).length,
  });
}
