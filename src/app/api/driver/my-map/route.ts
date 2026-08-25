/**
 * Карта клієнтів водія: кого він возить.
 *
 * Окремо від /api/sales/my-map, бо портфель визначається інакше. У
 * торгового клієнт «свій», якщо закріплений або куплений через нього. У
 * водія закріплення немає взагалі — його клієнти це ті, до кого він
 * реально їздив: точки маршрутів і відмітки візитів.
 *
 * Стани клієнтів ті самі, що в аналітиці й на карті торгового: водій і
 * керівник мусять бачити однаковий колір на одному магазині.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SOURCE_FILTER } from "@/lib/analytics/facts";
import {
  DORMANT_DAYS,
  LOST_DAYS,
  MIN_SLIPPING_DAYS,
  SLIPPING_FACTOR,
  type ClientState,
} from "@/lib/analytics/clients";
import { kyivDate } from "@/lib/date/kyiv";
import { resolveDriverDay } from "@/lib/track/day-stops";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["DRIVER", "ADMIN", "MANAGER"];
const DAY_MS = 86_400_000;
const MIN_DOCS_FOR_LOST = 2;

type Row = {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  geoSource: string | null;
  receivable: number;
  overdue: number;
  firstDocAt: Date | null;
  lastDocAt: Date | null;
  historyDocs: number;
  historyDays: number;
  visits: number;
  lastVisitAt: Date | null;
  mine: boolean;
  /** Останнє фото локації зі стрічки коментарів — водієві найпотрібніше. */
  photoUrl: string | null;
  notes: number;
};

/** Стан клієнта на сьогодні — та сама логіка, що в analytics/clients.ts. */
function classify(row: Row): ClientState {
  if (!row.lastDocAt || !row.firstDocAt) return "NEW";
  const now = Date.now();
  const daysSinceLast = Math.floor((now - row.lastDocAt.getTime()) / DAY_MS);
  if (now - row.firstDocAt.getTime() < 30 * DAY_MS) return "NEW";
  if (daysSinceLast >= LOST_DAYS && row.historyDocs >= MIN_DOCS_FOR_LOST) return "LOST";
  if (daysSinceLast >= DORMANT_DAYS) return "DORMANT";
  if (daysSinceLast < MIN_SLIPPING_DAYS) return "ACTIVE";
  // Ритм — за днями з покупками, не за документами (кілька накладних
  // за одну поставку — не «бере щодня»).
  const spanDays = Math.max(1, (row.lastDocAt.getTime() - row.firstDocAt.getTime()) / DAY_MS);
  const avgInterval = row.historyDays > 1 ? spanDays / (row.historyDays - 1) : spanDays;
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

  const url = new URL(req.url);
  // Водій завжди дивиться власну карту; керівник може відкрити чужу.
  const driverId =
    session.user.role === "DRIVER"
      ? session.user.id
      : url.searchParams.get("driverId") || session.user.id;
  const day = url.searchParams.get("day") || kyivDate(new Date());

  /**
   * scope=all — усі клієнти компанії, а не лише «мої».
   *
   * Портфель водія (точки його маршрутів + відмітки візитів) виявився
   * заплюзьким: новий водій бачить рівно сьогоднішній виїзд, і карта для
   * нього порожня. А підміняючи колегу або довозячи чуже, він має знайти
   * магазин, до якого ніколи не їздив. Своїх лишаємо окремим фільтром —
   * прапорець `mine` у відповіді.
   */
  const scopeAll = url.searchParams.get("scope") === "all";

  const [rows, todayRoute] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      WITH mine AS (
        SELECT c.id, c.name, c.address, c."deliveryLat" AS lat, c."deliveryLng" AS lng,
               c."geoSource"::text AS "geoSource",
               COALESCE(c."receivableBalance", 0)::float AS receivable,
               (
                 COALESCE(c."debtOverdue30", 0) + COALESCE(c."debtOverdue60", 0) +
                 COALESCE(c."debtOverdue90", 0) + COALESCE(c."debtOverdue90Plus", 0)
               )::float AS overdue,
               -- Той самий предикат, що раніше різав вибірку, тепер лише
               -- позначає «мої»: у режимі «всі» він стає фільтром на клієнті.
               (
                 EXISTS (
                   SELECT 1 FROM "DeliveryStop" ds
                   JOIN "DeliveryRoute" dr ON dr.id = ds."deliveryRouteId"
                   WHERE ds."counterpartyId" = c.id AND dr."driverId" = ${driverId}
                 )
                 OR EXISTS (
                   SELECT 1 FROM "RouteSheetStop" rss
                   JOIN "RouteSheet" rs ON rs.id = rss."routeSheetId"
                   WHERE rss."counterpartyId" = c.id AND rs."driverId" = ${driverId}
                 )
                 OR EXISTS (
                   SELECT 1 FROM "Visit" v
                   WHERE v."counterpartyId" = c.id AND v."userId" = ${driverId}
                 )
               ) AS mine,
               -- Фото воріт і кількість нотаток просто на точці: водій має
               -- побачити, куди заїжджати, не відкриваючи стрічку.
               (SELECT cc."photoUrl" FROM "ClientComment" cc
                 WHERE cc."counterpartyId" = c.id AND cc."photoUrl" IS NOT NULL
                 ORDER BY cc."createdAt" DESC LIMIT 1) AS "photoUrl",
               (SELECT COUNT(*)::int FROM "ClientComment" cc
                 WHERE cc."counterpartyId" = c.id) AS notes
        FROM "Counterparty" c
        WHERE c."isActive"
          AND c."deliveryLat" IS NOT NULL
          AND c."deliveryLng" IS NOT NULL
          AND (
            ${scopeAll}
            -- Точки маршрутів, які цей водій возив
            OR EXISTS (
              SELECT 1 FROM "DeliveryStop" ds
              JOIN "DeliveryRoute" dr ON dr.id = ds."deliveryRouteId"
              WHERE ds."counterpartyId" = c.id AND dr."driverId" = ${driverId}
            )
            OR EXISTS (
              SELECT 1 FROM "RouteSheetStop" rss
              JOIN "RouteSheet" rs ON rs.id = rss."routeSheetId"
              WHERE rss."counterpartyId" = c.id AND rs."driverId" = ${driverId}
            )
            -- Або він там був і відмітився
            OR EXISTS (
              SELECT 1 FROM "Visit" v
              WHERE v."counterpartyId" = c.id AND v."userId" = ${driverId}
            )
          )
      ),
      hist AS (
        SELECT s."counterpartyId",
               MIN(s."createdAt") FILTER (WHERE s."docType" <> 'RETURN') AS "firstDocAt",
               MAX(s."createdAt") FILTER (WHERE s."docType" <> 'RETURN') AS "lastDocAt",
               COUNT(*) FILTER (WHERE s."docType" <> 'RETURN')::int AS "historyDocs",
               COUNT(DISTINCT (s."createdAt" AT TIME ZONE 'Europe/Kyiv')::date)
                 FILTER (WHERE s."docType" <> 'RETURN')::int AS "historyDays"
        FROM "SalesDocument" s
        WHERE ${SOURCE_FILTER}
          AND s."counterpartyId" IN (SELECT id FROM mine)
        GROUP BY 1
      ),
      vis AS (
        SELECT v."counterpartyId",
               COUNT(*)::int AS visits,
               MAX(v."markedAt") AS "lastVisitAt"
        FROM "Visit" v
        WHERE v."userId" = ${driverId}
          AND v."counterpartyId" IN (SELECT id FROM mine)
        GROUP BY 1
      )
      SELECT m.*,
             h."firstDocAt", h."lastDocAt",
             COALESCE(h."historyDocs", 0)::int AS "historyDocs",
             COALESCE(h."historyDays", 0)::int AS "historyDays",
             COALESCE(vi.visits, 0)::int AS visits,
             vi."lastVisitAt"
      FROM mine m
      LEFT JOIN hist h ON h."counterpartyId" = m.id
      LEFT JOIN vis vi ON vi."counterpartyId" = m.id
      ORDER BY m.name
    `,
    resolveDriverDay(driverId, day),
  ]);

  // Точки сьогоднішнього маршруту підсвічуємо окремо: на карті всіх
  // клієнтів водієві потрібно бачити, куди він їде саме зараз.
  const todayIds = new Set(
    todayRoute.stops.map((s) => s.counterpartyId).filter(Boolean) as string[]
  );

  const counts: Record<string, number> = {};
  const clients = rows.map((r) => {
    const state = classify(r);
    counts[state] = (counts[state] ?? 0) + 1;
    return {
      id: r.id,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      state,
      geoSource: r.geoSource,
      receivable: r.receivable,
      overdue: r.overdue,
      daysSinceLast: r.lastDocAt
        ? Math.max(0, Math.floor((Date.now() - r.lastDocAt.getTime()) / DAY_MS))
        : null,
      approximate: r.geoSource !== "MANUAL",
      /** Скільки разів цей водій сюди приїжджав */
      visits: r.visits,
      lastVisitAt: r.lastVisitAt,
      /** Чи є ця точка в сьогоднішньому маршруті */
      today: todayIds.has(r.id),
      /** Чи возив цей водій сюди хоч раз — фільтр «мої клієнти» */
      mine: r.mine,
      /** Останнє фото локації й скільки всього нотаток про точку */
      photoUrl: r.photoUrl,
      notes: r.notes,
    };
  });

  return NextResponse.json({
    day,
    clients,
    counts,
    todayCount: todayIds.size,
    mineCount: clients.filter((c) => c.mine).length,
    approximateCount: clients.filter((c) => c.approximate).length,
  });
}
