/**
 * Ручне виправлення піна клієнта на карті.
 *
 * Окремий вузький ендпоінт, а не загальний PATCH контрагента: там
 * редагуються реквізити й доступ лише в ADMIN, а пін на карті посуває
 * і керівник, і робиться це десятками за раз. Ставимо geoSource=MANUAL —
 * після цього бекфіл цей рядок обходить.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ counterpartyId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!FULL_ACCESS_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { counterpartyId } = await params;
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
