import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

// PATCH — update optimized stop order + total distance from route planner
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
  const { stopSequences, totalDistanceKm, totalFuelCost } = body;
  // stopSequences: [{ stopId: string, sequence: number, distanceKm?: number }]

  await prisma.$transaction(async (tx) => {
    if (stopSequences && Array.isArray(stopSequences)) {
      for (const s of stopSequences) {
        await tx.deliveryStop.update({
          where: { id: s.stopId },
          data: {
            sequence: s.sequence,
            ...(s.distanceKm !== undefined && { distanceKm: s.distanceKm }),
          },
        });
      }
    }
    if (totalDistanceKm !== undefined || totalFuelCost !== undefined) {
      await tx.deliveryRoute.update({
        where: { id },
        data: {
          ...(totalDistanceKm !== undefined && { totalDistanceKm }),
          ...(totalFuelCost !== undefined && { totalFuelCost }),
        },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
