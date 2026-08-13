/**
 * Правка й видалення окремої точки маршруту.
 *
 * PATCH  — зона (місто/область), ручна оплата, назва, адреса, координати,
 *          примітка, порядковий номер.
 * DELETE — прибрати точку; решта перенумеровується підряд, а звільнена
 *          накладна повертається у стан «спосіб доставки не визначено».
 *
 * Зона тут пріоритетніша за override на картці клієнта: той самий магазин
 * сьогодні приймає в місті, а завтра — на заміській філії, і зарплата має
 * рахуватися за фактом конкретного виїзду.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isEditable, notEditableReason, resequence } from "@/lib/routes/editable";

/** Точка + статус її маршруту — спільна преамбула обох методів. */
async function loadStop(id: string) {
  return prisma.deliveryStop.findUnique({
    where: { id },
    select: {
      id: true,
      deliveryRouteId: true,
      salesDocumentId: true,
      kind: true,
      deliveryRoute: { select: { status: true } },
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const stop = await loadStop(id);
  if (!stop) return NextResponse.json({ error: "Точку не знайдено" }, { status: 404 });
  if (!isEditable(stop.deliveryRoute.status)) {
    return NextResponse.json(
      { error: notEditableReason(stop.deliveryRoute.status) },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { zoneOverride, payOverride, title, address, lat, lng, notes, sequence } =
    body as {
      zoneOverride?: "CITY" | "OBLAST" | null;
      payOverride?: number | null;
      title?: string | null;
      address?: string | null;
      lat?: number | null;
      lng?: number | null;
      notes?: string | null;
      sequence?: number;
    };

  const data: Record<string, unknown> = {};
  // null — свідоме «повернути до автоматичного визначення», тому
  // розрізняємо його з undefined («поле не чіпали»).
  if (zoneOverride !== undefined) data.zoneOverride = zoneOverride ?? null;
  if (payOverride !== undefined) {
    data.payOverride =
      typeof payOverride === "number" && Number.isFinite(payOverride) ? payOverride : null;
  }
  if (title !== undefined) data.title = title?.trim() || null;
  if (address !== undefined) data.address = address?.trim() || null;
  if (lat !== undefined) data.lat = typeof lat === "number" && Number.isFinite(lat) ? lat : null;
  if (lng !== undefined) data.lng = typeof lng === "number" && Number.isFinite(lng) ? lng : null;
  if (notes !== undefined) data.notes = notes?.trim() || null;
  if (sequence !== undefined && Number.isFinite(sequence)) data.sequence = sequence;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нема чого змінювати" }, { status: 400 });
  }

  const updated = await prisma.deliveryStop.update({ where: { id }, data });
  return NextResponse.json({ ok: true, stop: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const stop = await loadStop(id);
  if (!stop) return NextResponse.json({ error: "Точку не знайдено" }, { status: 404 });
  if (!isEditable(stop.deliveryRoute.status)) {
    return NextResponse.json(
      { error: notEditableReason(stop.deliveryRoute.status) },
      { status: 400 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.deliveryStop.delete({ where: { id } });

    // Накладна більше нікуди не їде — знімаємо з неї спосіб доставки,
    // інакше вона зникне зі списку доступних для інших маршрутів.
    if (stop.salesDocumentId) {
      await tx.salesDocument.update({
        where: { id: stop.salesDocumentId },
        data: { deliveryMethod: null },
      });
    }

    await resequence(tx, stop.deliveryRouteId);
  });

  return NextResponse.json({ ok: true });
}
