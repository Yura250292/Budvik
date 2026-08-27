/**
 * Відмітка бонусної поїздки водієм: зробив / не вийшло.
 *
 * Окремо від /api/visits навмисно. Візит прив'язаний до КЛІЄНТА
 * (@@unique [userId, day, counterpartyId]), а «відвезти ремонт на пошту»
 * клієнта не має взагалі — такий запис туди просто не влазить. Тому для
 * поїздок без контрагента станом служить сам DeliveryStop.status, поле
 * якого давно є в схемі й досі використовувалося лише в /deliver.
 *
 * Звичайні доставки сюди не ходять: там відмітка — це Visit з грошима й
 * координатами, і дві паралельні правди про одну точку нікому не потрібні.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, DRIVER_ROLES } from "@/lib/app/identity";


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRoles(req, DRIVER_ROLES);
  if (!auth.ok) return auth.response;
  const me = auth.me;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { status, comment } = body as {
    status?: "DELIVERED" | "FAILED" | "PENDING";
    comment?: string;
  };

  if (status && !["DELIVERED", "FAILED", "PENDING"].includes(status)) {
    return NextResponse.json({ error: "Некоректний статус" }, { status: 400 });
  }

  const stop = await prisma.deliveryStop.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      counterpartyId: true,
      deliveryRoute: { select: { id: true, driverId: true, status: true } },
    },
  });
  if (!stop) return NextResponse.json({ error: "Точку не знайдено" }, { status: 404 });

  if (stop.kind === "DELIVERY") {
    return NextResponse.json(
      { error: "Доставка відмічається через візит, а не тут" },
      { status: 422 }
    );
  }

  // Водій відмічає лише свій маршрут; підставити чужий id не вийде, бо
  // driverId береться з бази й порівнюється із сесією.
  if (
    me.role === "DRIVER" &&
    stop.deliveryRoute.driverId !== me.userId
  ) {
    return NextResponse.json({ error: "Це маршрут іншого водія" }, { status: 403 });
  }

  const next = status ?? "DELIVERED";

  await prisma.$transaction(async (tx) => {
    await tx.deliveryStop.update({
      where: { id },
      data: {
        status: next,
        deliveredAt: next === "DELIVERED" ? new Date() : null,
        ...(comment !== undefined && { notes: comment?.trim() || null }),
      },
    });

    // Перша відмітка дня переводить маршрут у роботу — та сама логіка, що
    // в /deliver: водій поїхав, отже маршрут уже не «переданий», а «в дорозі».
    if (next !== "PENDING" && stop.deliveryRoute.status === "ASSIGNED") {
      await tx.deliveryRoute.update({
        where: { id: stop.deliveryRoute.id },
        data: { status: "IN_PROGRESS" },
      });
    }
  });

  return NextResponse.json({ ok: true, status: next });
}
