import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { appendMissing } from "@/lib/routes/order";

/** GeoJSON LineString зі щонайменше двома точками — і нічого іншого. */
function isLineString(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const g = value as { type?: unknown; coordinates?: unknown };
  if (g.type !== "LineString" || !Array.isArray(g.coordinates)) return false;
  if (g.coordinates.length < 2) return false;
  return g.coordinates.every(
    (pair) =>
      Array.isArray(pair) &&
      pair.length >= 2 &&
      Number.isFinite(pair[0]) &&
      Number.isFinite(pair[1])
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "DRIVER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const route = await prisma.deliveryRoute.findUnique({
    where: { id },
    include: {
      driver: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      stops: {
        include: {
          salesDocument: {
            select: { id: true, number: true, totalAmount: true },
          },
          counterparty: {
            select: {
              id: true, name: true,
              address: true,
              deliveryAddress: true,
              deliveryLat: true,
              deliveryLng: true,
            },
          },
        },
        orderBy: { sequence: "asc" },
      },
      _count: { select: { stops: true } },
    },
  });

  if (!route) return NextResponse.json({ error: "Не знайдено" }, { status: 404 });

  if (session.user.role === "DRIVER" && route.driverId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(route);
}

/**
 * PATCH — шапка маршруту і порядок точок.
 *
 * Два різні сценарії в одному ендпоінті:
 *   — планувальник зберігає порядок (stopSequences + підсумкові км/паливо);
 *   — логіст править шапку: водій, дата, авто, паливо, примітка, скасування.
 *
 * Водія й дату можна міняти й після передачі: маршрут переїхав на іншу
 * людину — це нормальна ситуація дня, а не привід усе перестворювати.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const {
    stopSequences,
    totalDistanceKm,
    totalFuelCost,
    routeGeometry,
    driverId,
    date,
    vehicleInfo,
    fuelConsumption,
    fuelPricePer,
    notes,
    actualKm,
    status,
  } = body;

  /**
   * Геометрію приймаємо лише справжню.
   *
   * Саме її наявність означає «порядок прокладено» для смуги кроків
   * (lib/routes/progress.ts) і саме її малює планшет водія. Записати сюди
   * будь-який Json означало б крок «зроблено» без дороги й порожню карту в
   * того, хто вже виїхав.
   */
  if (routeGeometry !== undefined && routeGeometry !== null && !isLineString(routeGeometry)) {
    return NextResponse.json(
      { error: "Некоректна геометрія маршруту — потрібен LineString щонайменше з двох точок" },
      { status: 400 }
    );
  }
  // stopSequences: [{ stopId: string, sequence: number, distanceKm?: number }]

  const route = await prisma.deliveryRoute.findUnique({
    where: { id },
    select: { id: true, status: true, driverId: true, date: true },
  });
  if (!route) return NextResponse.json({ error: "Маршрут не знайдено" }, { status: 404 });

  // Зміна водія — тільки на того, хто справді водій: інакше маршрут осів би
  // на менеджері й не з'явився б у жодному планшеті.
  if (driverId !== undefined && driverId !== null && driverId !== route.driverId) {
    const driver = await prisma.user.findUnique({
      where: { id: driverId },
      select: { role: true, name: true },
    });
    if (!driver) return NextResponse.json({ error: "Водія не знайдено" }, { status: 404 });
    if (driver.role !== "DRIVER") {
      return NextResponse.json(
        { error: `${driver.name ?? "Користувач"} не має ролі «Водій»` },
        { status: 400 }
      );
    }
  }

  if (status !== undefined && status !== "CANCELLED") {
    return NextResponse.json(
      { error: "Статус міняється передачею водію та відмітками точок, вручну — лише скасування" },
      { status: 400 }
    );
  }

  const parsedDate = date !== undefined ? new Date(date) : undefined;
  if (parsedDate && Number.isNaN(parsedDate.getTime())) {
    return NextResponse.json({ error: "Невірна дата" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    if (stopSequences && Array.isArray(stopSequences)) {
      /**
       * Перенумеровуємо ВЕСЬ маршрут, а не лише названі точки.
       *
       * Раніше клієнт міг прислати порядок для частини — і решта лишалася
       * зі старими номерами, які з новими не узгоджені: точка з номером 4
       * опинялася між новими 4 і 5. Те саме правило, що в apply-order:
       * незгадані їдуть у хвіст, зберігаючи свій порядок між собою.
       */
      const all = await tx.deliveryStop.findMany({
        where: { deliveryRouteId: id },
        orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      const proposed = [...stopSequences]
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
        .map((s) => s.stopId as string);
      const finalOrder = appendMissing(
        proposed,
        all.map((s) => s.id)
      );
      const kmByStop = new Map(
        stopSequences
          .filter((s) => s.distanceKm !== undefined)
          .map((s) => [s.stopId as string, s.distanceKm as number])
      );

      for (const [i, stopId] of finalOrder.entries()) {
        // where з deliveryRouteId: точка з чужого маршруту не переставиться
        await tx.deliveryStop.updateMany({
          where: { id: stopId, deliveryRouteId: id },
          data: {
            sequence: i + 1,
            ...(kmByStop.has(stopId) && { distanceKm: kmByStop.get(stopId) }),
          },
        });
      }
    }

    const data: Record<string, unknown> = {};
    if (totalDistanceKm !== undefined) data.totalDistanceKm = totalDistanceKm;
    if (totalFuelCost !== undefined) data.totalFuelCost = totalFuelCost;
    if (routeGeometry !== undefined) data.routeGeometry = routeGeometry ?? null;
    if (driverId !== undefined) data.driverId = driverId || null;
    if (parsedDate) data.date = parsedDate;
    if (vehicleInfo !== undefined) data.vehicleInfo = vehicleInfo || null;
    if (fuelConsumption !== undefined) data.fuelConsumption = fuelConsumption ?? null;
    if (fuelPricePer !== undefined) data.fuelPricePer = fuelPricePer ?? null;
    if (notes !== undefined) data.notes = notes || null;
    if (actualKm !== undefined) data.actualKm = actualKm ?? null;
    if (status === "CANCELLED") data.status = "CANCELLED";

    if (Object.keys(data).length > 0) {
      await tx.deliveryRoute.update({ where: { id }, data });
    }
  });

  return NextResponse.json({ ok: true });
}
