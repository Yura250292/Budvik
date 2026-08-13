/**
 * Додати точку до маршруту.
 *
 * Два види точок:
 *   1. Замовлення — `{ salesDocumentId }`. Класика: накладна, контрагент,
 *      адреса з його картки.
 *   2. Бонусна поїздка — `{ kind: "PICKUP" | "ERRAND", title, ... }`.
 *      Забрати товар, відвезти ремонт на пошту. Накладної немає, оплата
 *      задається вручну (payOverride), бо тариф 25/15 ₴ за точку тут не
 *      підходить: поїздка на пошту не дорівнює вигрузці в магазині.
 *
 * Правити можна, поки водій не поїхав — і в чернетці, і в переданому
 * маршруті (див. lib/routes/editable.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadEditableRoute } from "@/lib/routes/editable";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const {
    salesDocumentId,
    kind,
    title,
    address,
    lat,
    lng,
    payOverride,
    zoneOverride,
    counterpartyId,
    notes,
  } = body as {
    salesDocumentId?: string;
    kind?: "DELIVERY" | "PICKUP" | "ERRAND";
    title?: string;
    address?: string;
    lat?: number;
    lng?: number;
    payOverride?: number;
    zoneOverride?: "CITY" | "OBLAST";
    counterpartyId?: string;
    notes?: string;
  };

  const loaded = await loadEditableRoute(id);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const stopKind = kind ?? (salesDocumentId ? "DELIVERY" : "ERRAND");

  // --- Бонусна поїздка: без накладної, з ручною назвою й оплатою ---
  if (stopKind !== "DELIVERY") {
    if (!title || !title.trim()) {
      return NextResponse.json(
        { error: "Напишіть, що зробити — водій прочитає це в чек-листі" },
        { status: 400 }
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const count = await tx.deliveryStop.count({ where: { deliveryRouteId: id } });
      return tx.deliveryStop.create({
        data: {
          deliveryRouteId: id,
          kind: stopKind,
          title: title.trim(),
          counterpartyId: counterpartyId || null,
          address: address?.trim() || null,
          lat: typeof lat === "number" && Number.isFinite(lat) ? lat : null,
          lng: typeof lng === "number" && Number.isFinite(lng) ? lng : null,
          payOverride:
            typeof payOverride === "number" && Number.isFinite(payOverride)
              ? payOverride
              : null,
          zoneOverride: zoneOverride ?? null,
          notes: notes?.trim() || null,
          sequence: count + 1,
        },
      });
    });

    return NextResponse.json({ ok: true, stop: created }, { status: 201 });
  }

  // --- Звичайна доставка ---
  if (!salesDocumentId) {
    return NextResponse.json({ error: "Оберіть замовлення" }, { status: 400 });
  }

  const doc = await prisma.salesDocument.findUnique({
    where: { id: salesDocumentId },
    include: {
      counterparty: { select: { address: true, deliveryAddress: true } },
      deliveryStop: { select: { id: true, deliveryRouteId: true } },
    },
  });
  if (!doc) return NextResponse.json({ error: "Замовлення не знайдено" }, { status: 404 });

  // Одна накладна — один маршрут (salesDocumentId @unique). Без цієї
  // перевірки був би сирий P2002 замість зрозумілого тексту.
  if (doc.deliveryStop) {
    return NextResponse.json(
      {
        error:
          doc.deliveryStop.deliveryRouteId === id
            ? "Це замовлення вже є в маршруті"
            : "Це замовлення вже стоїть в іншому маршруті — спершу приберіть його звідти",
      },
      { status: 409 }
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const count = await tx.deliveryStop.count({ where: { deliveryRouteId: id } });
    const stop = await tx.deliveryStop.create({
      data: {
        deliveryRouteId: id,
        salesDocumentId: doc.id,
        counterpartyId: doc.counterpartyId || null,
        kind: "DELIVERY",
        sequence: count + 1,
        address:
          address?.trim() ||
          doc.counterparty?.deliveryAddress ||
          doc.counterparty?.address ||
          null,
      },
    });
    await tx.salesDocument.update({
      where: { id: doc.id },
      data: { deliveryMethod: "DRIVER" },
    });
    return stop;
  });

  return NextResponse.json({ ok: true, stop: created }, { status: 201 });
}
