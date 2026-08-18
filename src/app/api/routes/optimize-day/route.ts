/**
 * Прокласти маршрут на день: найдешевше + варіант з пріоритетами.
 *
 * Один ендпоінт для двох сценаріїв, бо математика в них однакова:
 * логіст будує маршрут зі складу, водій перебудовує від того місця, де
 * стоїть зараз. Різниця лише в точці старту.
 *
 * Ендпоінт нічого не зберігає сам — повертає два варіанти й дає обрати.
 * Запис у DeliveryRoute робить окремий виклик (`apply`), інакше
 * «подивитися, скільки коштує» вже міняло б план дня.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { resolveDriverDay } from "@/lib/track/day-stops";
import { explainScore, scoreClient } from "@/lib/routes/priority";
import { optimizeRoute, type OptimizeStop, type FuelParams } from "@/lib/routes/optimize";
import {
  DORMANT_DAYS,
  LOST_DAYS,
  MIN_SLIPPING_DAYS,
  SLIPPING_FACTOR,
  type ClientState,
} from "@/lib/analytics/clients";
import { SOURCE_FILTER } from "@/lib/analytics/facts";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["DRIVER", "SALES", "ADMIN", "MANAGER"];
const DAY_MS = 86_400_000;
/** Скільки місяців історії беремо для обороту клієнта. */
const TURNOVER_MONTHS = 6;

/** Типове авто розвозки, якщо в маршруті не вказано своє. */
const DEFAULT_FUEL: FuelParams = { consumption: 12, pricePerUnit: 56, bufferPercent: 10 };

type HistRow = {
  counterpartyId: string;
  turnover: number;
  docs: number;
  days: number;
  firstDocAt: Date | null;
  lastDocAt: Date | null;
};

/** Стан клієнта на сьогодні — та сама логіка, що в аналітиці. */
function classifyNow(row: HistRow | undefined): ClientState | null {
  if (!row?.lastDocAt || !row.firstDocAt) return null;
  const now = Date.now();
  const daysSinceLast = Math.floor((now - row.lastDocAt.getTime()) / DAY_MS);
  if (now - row.firstDocAt.getTime() < 30 * DAY_MS) return "NEW";
  if (daysSinceLast >= LOST_DAYS && row.docs >= 2) return "LOST";
  if (daysSinceLast >= DORMANT_DAYS) return "DORMANT";
  if (daysSinceLast < MIN_SLIPPING_DAYS) return "ACTIVE";
  // Ритм — за днями з покупками, не за документами (кілька накладних
  // за одну поставку — не «бере щодня»).
  const spanDays = Math.max(1, (row.lastDocAt.getTime() - row.firstDocAt.getTime()) / DAY_MS);
  const avgInterval = row.days > 1 ? spanDays / (row.days - 1) : spanDays;
  if (daysSinceLast > avgInterval * SLIPPING_FACTOR) return "SLIPPING";
  return "ACTIVE";
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  let body: {
    day?: string;
    driverId?: string;
    /** Звідки стартуємо: [lng, lat]. Немає — беремо склад або першу точку */
    start?: [number, number];
    fuel?: Partial<FuelParams>;
    maxDetourPercent?: number;
    /** "farthest" — спершу найдальша точка, хвіст дня біля складу */
    direction?: string;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const day = body.day || kyivDate(new Date());
  // Водій оптимізує лише свій день; логіст може вказати чужий.
  const driverId =
    session.user.role === "DRIVER" || session.user.role === "SALES"
      ? session.user.id
      : body.driverId || session.user.id;

  // Логіст оптимізує чернетку (PLANNED) до передачі водієві — інакше
  // резолвер пропускав би її і падав на запасний лист 1С, чий порядок
  // зберегти не можна. Водій, як і раніше, бачить лише передані маршрути.
  const isManager = session.user.role === "ADMIN" || session.user.role === "MANAGER";
  const route = await resolveDriverDay(driverId, day, { includePlanned: isManager });
  const withCoords = route.stops.filter(
    (s) => s.lat != null && s.lng != null && s.counterpartyId
  );

  if (withCoords.length === 0) {
    return NextResponse.json(
      {
        error:
          route.stops.length > 0
            ? "У точок маршруту немає координат — спершу уточніть їх на карті клієнтів"
            : "На цей день немає маршруту",
      },
      { status: 422 }
    );
  }

  const clientIds = withCoords.map((s) => s.counterpartyId!) as string[];

  // Оборот і ритм покупок — з реалізацій за півроку. Один запит на всі
  // точки: по одному на клієнта означало б N+1 на кожну оптимізацію.
  const since = new Date(Date.now() - TURNOVER_MONTHS * 30 * DAY_MS);
  const [hist, clients] = await Promise.all([
    prisma.$queryRaw<HistRow[]>`
      SELECT s."counterpartyId",
             COALESCE(SUM(s."totalAmount"), 0)::float AS turnover,
             COUNT(*)::int AS docs,
             COUNT(DISTINCT (s."createdAt" AT TIME ZONE 'Europe/Kyiv')::date)::int AS days,
             MIN(s."createdAt") AS "firstDocAt",
             MAX(s."createdAt") AS "lastDocAt"
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
        AND s."counterpartyId" = ANY(${clientIds})
        AND s."createdAt" >= ${since}
      GROUP BY 1
    `,
    prisma.counterparty.findMany({
      where: { id: { in: clientIds } },
      select: {
        id: true,
        receivableBalance: true,
        debtOverdue30: true,
        debtOverdue60: true,
        debtOverdue90: true,
        debtOverdue90Plus: true,
      },
    }),
  ]);

  const histById = new Map(hist.map((h) => [h.counterpartyId, h]));
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const scored = withCoords.map((s) => {
    const c = clientById.get(s.counterpartyId!);
    const h = histById.get(s.counterpartyId!);
    const overdue =
      (c?.debtOverdue30 ?? 0) + (c?.debtOverdue60 ?? 0) + (c?.debtOverdue90 ?? 0) + (c?.debtOverdue90Plus ?? 0);
    const input = {
      receivable: Math.max(0, c?.receivableBalance ?? 0),
      overdue: Math.max(0, overdue),
      turnover: h?.turnover ?? 0,
      deliveryAmount: s.amount,
      state: classifyNow(h),
    };
    return {
      stop: s,
      score: scoreClient(input),
      reason: explainScore(input),
      state: input.state,
    };
  });

  /**
   * Точка старту. Пріоритет: явно передана (водій «я тут») → склад із
   * налаштувань → перша точка маршруту. Останнє не ідеально, але краще
   * за відмову: логіст побачить порядок і виправить старт, якщо треба.
   */
  let start: [number, number] | null = body.start ?? null;
  let startName: string | null = body.start ? "поточне місце" : null;
  if (!start) {
    // Склади живуть у StockLocation; isDefault першим — це основний, з
    // якого й виїжджає розвозка.
    const warehouse = await prisma.stockLocation.findFirst({
      where: { isActive: true, lat: { not: null }, lng: { not: null } },
      select: { lat: true, lng: true, name: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    if (warehouse?.lat != null && warehouse.lng != null) {
      start = [warehouse.lng, warehouse.lat];
      startName = warehouse.name;
    }
  }
  const startedFromFirstStop = !start;
  if (!start) {
    start = [withCoords[0].lng!, withCoords[0].lat!];
  }

  const fuel: FuelParams = {
    consumption: body.fuel?.consumption ?? DEFAULT_FUEL.consumption,
    pricePerUnit: body.fuel?.pricePerUnit ?? DEFAULT_FUEL.pricePerUnit,
    bufferPercent: body.fuel?.bufferPercent ?? DEFAULT_FUEL.bufferPercent,
  };

  const optimizeStops: OptimizeStop[] = scored.map((x) => ({
    id: x.stop.key,
    lat: x.stop.lat!,
    lng: x.stop.lng!,
    score: x.score,
  }));

  const maxDetour =
    typeof body.maxDetourPercent === "number"
      ? Math.max(0, Math.min(60, body.maxDetourPercent)) / 100
      : undefined;

  const direction = body.direction === "farthest" ? "farthest" : "nearest";

  try {
    const result = await optimizeRoute(start, optimizeStops, fuel, maxDetour, direction);

    // Порядок повертаємо як список точок із причиною, а не голі id:
    // інтерфейс має пояснити водію, ЧОМУ боржник опинився другим.
    const byKey = new Map(scored.map((x) => [x.stop.key, x]));
    const decorate = (order: string[]) =>
      order.map((key, i) => {
        const x = byKey.get(key)!;
        return {
          key,
          sequence: i + 1,
          counterpartyId: x.stop.counterpartyId,
          name: x.stop.name,
          address: x.stop.address,
          lat: x.stop.lat,
          lng: x.stop.lng,
          amount: x.stop.amount,
          debtAmount: x.stop.debtAmount,
          score: Math.round(x.score * 100) / 100,
          reason: x.reason,
          state: x.state,
        };
      });

    return NextResponse.json({
      day,
      startedFromFirstStop,
      startName,
      // [lng, lat] — карті-прев'ю і посиланню на Google Maps потрібна
      // точка виїзду, а не лише її назва.
      start,
      fuel,
      cheapest: { ...result.cheapest, stops: decorate(result.cheapest.order) },
      balanced: result.balanced
        ? { ...result.balanced, stops: decorate(result.balanced.order) }
        : null,
      detourPercent: result.detourPercent,
      /** Різниця в грошах між варіантами — головна цифра для рішення */
      extraCost: result.balanced ? result.balanced.fuelCost - result.cheapest.fuelCost : 0,
    });
  } catch (e) {
    // OSRM — публічний демо-сервер без ключа: він падає й лімітує.
    // Кажемо про це прямо, бо «спробуйте пізніше» тут не порада, а факт.
    return NextResponse.json(
      {
        error:
          e instanceof Error && e.message.includes("OSRM")
            ? "Сервіс побудови маршрутів не відповів. Спробуйте ще раз за хвилину."
            : "Не вдалося прокласти маршрут",
      },
      { status: 502 }
    );
  }
}
