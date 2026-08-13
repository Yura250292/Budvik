/**
 * Ручне виправлення піна клієнта на карті.
 *
 * Окремий вузький ендпоінт, а не загальний PATCH контрагента: там
 * редагуються реквізити й доступ лише в ADMIN, а пін на карті посуває
 * і керівник, і робиться це десятками за раз. Ставимо geoSource=MANUAL —
 * після цього бекфіл цей рядок обходить.
 *
 * Торговий теж може посунути пін, але лише своїм клієнтам: геокодер
 * здебільшого знаходить лише місто («площа Ринок, Львів» на три десятки
 * магазинів), а де насправді стоїть точка, знає той, хто до неї їздить.
 * Керівник фізично не може уточнити сотні пінів наосліп.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

/**
 * Чи це клієнт цього торгового.
 *
 * Ті самі два джерела, що й у списку «мої клієнти»
 * (src/app/api/erp/counterparties/route.ts): SalesRepClient заповнює
 * керівник вручну і покриває не всіх, а прив'язка документів іде
 * зіставленням імені з 1С і теж не стовідсоткова. Разом вони дають
 * робочий список — і саме той, який торговий бачить у себе в кабінеті.
 */
async function ownsClient(counterpartyId: string, repId: string): Promise<boolean> {
  const hit = await prisma.counterparty.findFirst({
    where: {
      id: counterpartyId,
      OR: [
        { assignedSalesReps: { some: { salesRepId: repId } } },
        { salesDocuments: { some: { salesRepId: repId } } },
      ],
    },
    select: { id: true },
  });
  return !!hit;
}

/**
 * Чи возив цей водій до цієї точки.
 *
 * Ті самі три джерела, що формують портфель на /api/driver/my-map:
 * маршрут сайту, маршрутний лист із 1С, відмітка візиту. Карта водія
 * тепер показує всіх клієнтів компанії, тож без цієї перевірки будь-хто
 * з роллю DRIVER міг би посунути пін магазину на іншому кінці області.
 */
async function droveTo(counterpartyId: string, driverId: string): Promise<boolean> {
  const hit = await prisma.counterparty.findFirst({
    where: {
      id: counterpartyId,
      OR: [
        { deliveryStops: { some: { deliveryRoute: { driverId } } } },
        { routeSheetStops: { some: { routeSheet: { driverId } } } },
        { visits: { some: { userId: driverId } } },
      ],
    },
    select: { id: true },
  });
  return !!hit;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ counterpartyId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  const { counterpartyId } = await params;
  const isFullAccess = FULL_ACCESS_ROLES.includes(session.user.role);

  if (!isFullAccess) {
    // Водій уточнює пін нарівні з торговим — і навіть частіше: він
    // під'їжджає фурою і першим бачить, що заїзд з іншого боку. Прив'язки
    // «свій клієнт» у нього немає (закріплень водіям не роздають), тож
    // обмежуємо тим, куди він реально їздив: точки маршрутів і візити.
    if (session.user.role === "DRIVER") {
      if (!(await droveTo(counterpartyId, session.user.id))) {
        return NextResponse.json({ error: "Ви туди не їздили" }, { status: 403 });
      }
    } else if (session.user.role === "SALES") {
      if (!(await ownsClient(counterpartyId, session.user.id))) {
        return NextResponse.json({ error: "Це не ваш клієнт" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
    }
  }

  const body = await req.json().catch(() => null);
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Потрібні координати lat і lng" }, { status: 400 });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "Координати поза межами" }, { status: 400 });
  }

  const exists = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ error: "Клієнта не знайдено" }, { status: 404 });
  }

  // Сирий SQL навмисно: оновлюємо рівно чотири колонки карти й не залежимо
  // від решти полів моделі, які можуть бути попереду міграцій бази.
  await prisma.$executeRaw`
    UPDATE "Counterparty"
    SET "deliveryLat" = ${lat}, "deliveryLng" = ${lng},
        "geoSource" = 'MANUAL', "geoAttemptedAt" = NOW()
    WHERE id = ${counterpartyId}`;

  return NextResponse.json({ id: counterpartyId, lat, lng, geoSource: "MANUAL" });
}
