import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getNextDocumentNumber } from "@/lib/erp/document-numbers";
import { requireRoles, DRIVER_ROLES, OFFICE_ROLES } from "@/lib/app/identity";

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, DRIVER_ROLES);
  if (!auth.ok) return auth.response;
  const me = auth.me;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const driverId = searchParams.get("driverId");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (driverId) where.driverId = driverId;

  // Drivers see only their own routes — і лише передані їм. Чернетка
  // логіста (PLANNED) для водія не існує: він побачив би напівскладений
  // список і поїхав би за ним.
  if (me.role === "DRIVER") {
    where.driverId = me.userId;
    where.status = status && status !== "PLANNED"
      ? status
      : { in: ["ASSIGNED", "IN_PROGRESS", "COMPLETED"] };
  }

  const routes = await prisma.deliveryRoute.findMany({
    where,
    include: {
      driver: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      stops: {
        include: {
          salesDocument: { select: { id: true, number: true, status: true, totalAmount: true } },
          counterparty: {
            select: {
              id: true,
              name: true,
              address: true,
              // Стан піна: редактор точок підсвічує клієнтів без координат
              // і тих, кому пін поставив геокодер (geoSource ≠ MANUAL).
              deliveryLat: true,
              deliveryLng: true,
              geoSource: true,
            },
          },
        },
        orderBy: { sequence: "asc" },
      },
      _count: { select: { stops: true } },
    },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(routes);
}

export async function POST(req: NextRequest) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;
  const me = auth.me;

  const body = await req.json();
  const {
    driverId,
    date,
    vehicleInfo,
    fuelConsumption,
    fuelPricePer,
    notes,
    salesDocumentIds,
    // Клієнти, знайдені пошуком по базі: точки без накладної. Логіст
    // збирає маршрут по пам'яті («Коваль у Жовтанцях»), ще до документів.
    counterpartyIds,
  } = body as {
    driverId?: string | null;
    date?: string;
    vehicleInfo?: string | null;
    fuelConsumption?: number | null;
    fuelPricePer?: number | null;
    notes?: string | null;
    salesDocumentIds?: string[];
    counterpartyIds?: string[];
  };

  if (!date) {
    return NextResponse.json({ error: "Вкажіть дату" }, { status: 400 });
  }

  const number = await getNextDocumentNumber("DR");

  const route = await prisma.$transaction(async (tx) => {
    const created = await tx.deliveryRoute.create({
      data: {
        number,
        driverId: driverId || null,
        date: new Date(date),
        vehicleInfo: vehicleInfo || null,
        fuelConsumption: fuelConsumption || null,
        fuelPricePer: fuelPricePer || null,
        notes: notes || null,
        createdById: me.userId,
      },
    });

    // Add sales documents as stops
    if (salesDocumentIds && salesDocumentIds.length > 0) {
      for (let i = 0; i < salesDocumentIds.length; i++) {
        const doc = await tx.salesDocument.findUnique({
          where: { id: salesDocumentIds[i] },
          include: {
            counterparty: {
              select: { id: true, address: true, deliveryAddress: true, deliveryLat: true, deliveryLng: true },
            },
          },
        });
        if (!doc) continue;

        await tx.deliveryStop.create({
          data: {
            deliveryRouteId: created.id,
            salesDocumentId: doc.id,
            counterpartyId: doc.counterpartyId || null,
            sequence: i + 1,
            // prefer deliveryAddress (НП / delivery point) over billing address
            address: doc.counterparty?.deliveryAddress || doc.counterparty?.address || null,
          },
        });

        // Update delivery method on document
        await tx.salesDocument.update({
          where: { id: doc.id },
          data: { deliveryMethod: "DRIVER" },
        });
      }
    }

    // Клієнти з бази — точки без накладної, після замовлень.
    if (counterpartyIds && counterpartyIds.length > 0) {
      let sequence = await tx.deliveryStop.count({
        where: { deliveryRouteId: created.id },
      });

      for (const counterpartyId of Array.from(new Set(counterpartyIds))) {
        const cp = await tx.counterparty.findUnique({
          where: { id: counterpartyId },
          select: { id: true, address: true, deliveryAddress: true },
        });
        if (!cp) continue;

        // Того самого клієнта могло вже привести його ж замовлення —
        // тоді другої точки не треба: водій під'їжджає раз.
        const already = await tx.deliveryStop.findFirst({
          where: { deliveryRouteId: created.id, counterpartyId: cp.id },
          select: { id: true },
        });
        if (already) continue;

        sequence += 1;
        await tx.deliveryStop.create({
          data: {
            deliveryRouteId: created.id,
            counterpartyId: cp.id,
            kind: "DELIVERY",
            sequence,
            address: cp.deliveryAddress || cp.address || null,
          },
        });
      }
    }

    return tx.deliveryRoute.findUnique({
      where: { id: created.id },
      include: {
        driver: { select: { id: true, name: true } },
        stops: {
          include: {
            counterparty: { select: { id: true, name: true, address: true } },
            salesDocument: { select: { id: true, number: true, totalAmount: true } },
          },
          orderBy: { sequence: "asc" },
        },
      },
    });
  });

  return NextResponse.json(route, { status: 201 });
}
