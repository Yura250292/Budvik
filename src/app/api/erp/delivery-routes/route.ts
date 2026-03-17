import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getNextDocumentNumber } from "@/lib/erp/document-numbers";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "DRIVER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const driverId = searchParams.get("driverId");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (driverId) where.driverId = driverId;

  // Drivers see only their own routes
  if (session.user.role === "DRIVER") {
    where.driverId = session.user.id;
  }

  const routes = await prisma.deliveryRoute.findMany({
    where,
    include: {
      driver: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      stops: {
        include: {
          salesDocument: { select: { id: true, number: true, status: true, totalAmount: true } },
          counterparty: { select: { id: true, name: true, address: true } },
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
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { driverId, date, vehicleInfo, fuelConsumption, fuelPricePer, notes, salesDocumentIds } = body;

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
        createdById: session.user.id,
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
