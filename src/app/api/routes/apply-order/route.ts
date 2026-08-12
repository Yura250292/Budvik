/**
 * Зберегти обраний порядок обʼїзду в маршрут дня.
 *
 * Окремо від оптимізації навмисно: подивитися, скільки коштує варіант,
 * не має міняти план дня. Спершу людина бачить дві цифри, потім тисне
 * «застосувати» — і лише тоді ми чіпаємо DeliveryRoute.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["DRIVER", "SALES", "ADMIN", "MANAGER"];

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
    /** Ключі точок у потрібному порядку (ds:<id> з /api/tablet/day) */
    order?: string[];
    distanceKm?: number;
    fuelCost?: number;
    /** GeoJSON LineString обраного варіанта — щоб карта малювала лінію */
    geometry?: { type: string; coordinates: [number, number][] } | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  const order = Array.isArray(body.order) ? body.order : [];
  if (order.length === 0) {
    return NextResponse.json({ error: "Порожній порядок" }, { status: 400 });
  }

  const day = body.day || kyivDate(new Date());
  const driverId =
    session.user.role === "DRIVER" || session.user.role === "SALES"
      ? session.user.id
      : body.driverId || session.user.id;

  // Порядок зберігається лише для маршрутів сайту: точки листа з 1С —
  // дзеркало чужої системи, і переставляти їх у себе означало б
  // розійтися з джерелом.
  const stopIds = order.filter((k) => k.startsWith("ds:")).map((k) => k.slice(3));
  if (stopIds.length === 0) {
    return NextResponse.json(
      { error: "Порядок можна зберегти лише для маршруту, складеного на сайті" },
      { status: 422 }
    );
  }

  // Перевіряємо, що всі точки належать маршруту саме цього водія на цей
  // день: без цього чужий маршрут переставлявся б підстановкою id.
  const stops = await prisma.deliveryStop.findMany({
    where: { id: { in: stopIds } },
    select: { id: true, deliveryRoute: { select: { id: true, driverId: true } } },
  });

  const routeIds = new Set(stops.map((s) => s.deliveryRoute.id));
  if (stops.length !== stopIds.length || routeIds.size !== 1) {
    return NextResponse.json({ error: "Точки належать різним маршрутам" }, { status: 422 });
  }
  const routeId = [...routeIds][0];
  const routeDriverId = stops[0].deliveryRoute.driverId;
  // Керівництво зберігає порядок будь-якому водієві — це його робота.
  // Водій і торговий обмежені власним маршрутом, і параметром це не обійти
  // (driverId вище береться з сесії, а не з тіла запиту).
  const isManager = session.user.role === "ADMIN" || session.user.role === "MANAGER";
  if (!isManager && routeDriverId !== driverId) {
    return NextResponse.json({ error: "Це маршрут іншого водія" }, { status: 403 });
  }

  await prisma.$transaction([
    ...stopIds.map((id, i) =>
      prisma.deliveryStop.update({ where: { id }, data: { sequence: i + 1 } })
    ),
    prisma.deliveryRoute.update({
      where: { id: routeId },
      data: {
        // Кілометраж і вартість — з OSRM, а не з оцінки моделі: саме
        // ця цифра потім лягає у витрати.
        totalDistanceKm: typeof body.distanceKm === "number" ? body.distanceKm : undefined,
        totalFuelCost: typeof body.fuelCost === "number" ? body.fuelCost : undefined,
        // Геометрія — щоб лінія маршруту пережила перезавантаження планшета
        routeGeometry:
          body.geometry && Array.isArray(body.geometry.coordinates)
            ? body.geometry
            : undefined,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, routeId, stops: stopIds.length, day });
}
