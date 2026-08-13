/**
 * Лист 1С → маршрут сайту, готовий до передачі водієві.
 *
 * Менеджери складають маршрут у 1С, і після появи каналу route_sheet_stop
 * сайт знає його склад: клієнт, адреса, сума. Але кабінет водія читає
 * DeliveryRoute, а не RouteSheet — карта дня, чек-лист, відмітки доставки й
 * інкасація зав'язані саме на нього.
 *
 * Тому лист не «показуємо водієві» окремим механізмом, а перетворюємо на
 * звичайний маршрут. Далі працює все, що вже є: передача (assign), карта,
 * статуси точок, зарплата. Дублювати цей ланцюг для другої таблиці означало б
 * два місця, які розходяться на першій же зміні.
 *
 * Конверсія одноразова: повторний виклик віддає вже створений маршрут, а не
 * робить другий. Інакше два натискання дали б водієві дубль на день — саме
 * той конфлікт, який ловить findDayConflict.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const sheetId = typeof body?.sheetId === "string" ? body.sheetId : null;
  if (!sheetId) {
    return NextResponse.json({ error: "Потрібен sheetId" }, { status: 400 });
  }

  const sheet = await prisma.routeSheet.findUnique({
    where: { id: sheetId },
    select: {
      id: true,
      number: true,
      date: true,
      driverId: true,
      driverName1C: true,
      vehicle: true,
      distanceKm: true,
      stops: {
        where: { hidden: false },
        orderBy: { sequence: "asc" },
        select: {
          counterpartyId: true,
          salesDocumentId: true,
          address: true,
          counterparty: {
            select: { deliveryAddress: true, address: true },
          },
        },
      },
    },
  });

  if (!sheet) {
    return NextResponse.json({ error: "Лист не знайдено" }, { status: 404 });
  }
  if (!sheet.driverId) {
    return NextResponse.json(
      {
        error:
          "Водія цього листа ще не прив'язано до акаунта. " +
          "Зробіть це у «Налаштуваннях», інакше маршрут нікому передати.",
      },
      { status: 400 }
    );
  }
  if (sheet.stops.length === 0) {
    return NextResponse.json(
      { error: "У листі немає точок — можливо, обмін ще не привіз їх" },
      { status: 400 }
    );
  }

  // Вже конвертований: віддаємо той самий маршрут. Ознака — номер, що несе
  // номер листа: окремого поля-зв'язку в DeliveryRoute немає, а заводити
  // його заради одного випадку дорожче, ніж розпізнавати за номером.
  const routeNumber = `1С-${sheet.number}`;
  const existing = await prisma.deliveryRoute.findUnique({
    where: { number: routeNumber },
    select: { id: true, number: true, status: true, _count: { select: { stops: true } } },
  });
  if (existing) {
    return NextResponse.json({
      ok: true,
      alreadyExists: true,
      route: existing,
      day: kyivDate(sheet.date),
    });
  }

  // Дубль адреси в межах листа — одна точка: водій під'їжджає раз, і в
  // чек-listі дві однакові адреси виглядали б помилкою. Та сама логіка, що
  // в розрахунку зарплати (payroll-facts), тільки там вона про оплату.
  const seenAddress = new Set<string>();
  const stops: {
    counterpartyId: string | null;
    salesDocumentId: string | null;
    address: string | null;
  }[] = [];

  for (const stop of sheet.stops) {
    const address =
      stop.address?.trim() ||
      stop.counterparty?.deliveryAddress?.trim() ||
      stop.counterparty?.address?.trim() ||
      null;

    // Ключ — адреса, а за її відсутності контрагент: без цього дві точки
    // без адреси злилися б в одну.
    const key = (address ?? `cp:${stop.counterpartyId ?? "?"}`).toLowerCase();
    if (seenAddress.has(key)) continue;
    seenAddress.add(key);

    stops.push({
      counterpartyId: stop.counterpartyId,
      salesDocumentId: stop.salesDocumentId,
      address,
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    const route = await tx.deliveryRoute.create({
      data: {
        number: routeNumber,
        driverId: sheet.driverId,
        date: sheet.date,
        vehicleInfo: sheet.vehicle,
        // Пробіг із 1С заповнений не завжди; нуль лишаємо порожнім, щоб
        // розрахунок узяв планові км OSRM, а не «0 км».
        totalDistanceKm: sheet.distanceKm > 0 ? sheet.distanceKm : null,
        notes: `Створено з маршрутного листа 1С ${sheet.number}`,
        createdById: session.user.id,
        // Статус лишається PLANNED: конверсія не є передачею. Логіст ще
        // подивиться порядок точок і натисне «Передати» окремо.
        status: "PLANNED",
      },
      select: { id: true, number: true, status: true },
    });

    // salesDocumentId у DeliveryStop @unique: та сама накладна не може лежати
    // у двох маршрутах. Якщо документ уже в чиємусь маршруті — точку створюємо
    // без нього: адреса й клієнт важливіші за посилання.
    const usedDocs = await tx.deliveryStop.findMany({
      where: {
        salesDocumentId: {
          in: stops.map((s) => s.salesDocumentId).filter((v): v is string => !!v),
        },
      },
      select: { salesDocumentId: true },
    });
    const taken = new Set(usedDocs.map((d) => d.salesDocumentId));

    await tx.deliveryStop.createMany({
      data: stops.map((s, i) => ({
        deliveryRouteId: route.id,
        sequence: i + 1,
        counterpartyId: s.counterpartyId,
        salesDocumentId: s.salesDocumentId && !taken.has(s.salesDocumentId) ? s.salesDocumentId : null,
        address: s.address,
      })),
    });

    return route;
  });

  return NextResponse.json({
    ok: true,
    route: created,
    stopsCreated: stops.length,
    skippedDuplicates: sheet.stops.length - stops.length,
    day: kyivDate(sheet.date),
  });
}
