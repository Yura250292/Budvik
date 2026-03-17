import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET — get single route
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const route = await prisma.savedRoute.findUnique({
    where: { id },
    include: { stops: { orderBy: { sequence: "asc" } } },
  });

  if (!route) {
    return NextResponse.json({ error: "Маршрут не знайдено" }, { status: 404 });
  }

  return NextResponse.json(route);
}

// PUT — update route
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const {
    name, startAddress, startLat, startLng,
    vehicleType, consumption, pricePerUnit,
    totalDistanceKm, totalDurationMin, totalFuelCost,
    routeGeometry, stops,
  } = body;

  // Delete old stops and recreate
  await prisma.savedRouteStop.deleteMany({ where: { savedRouteId: id } });

  const route = await prisma.savedRoute.update({
    where: { id },
    data: {
      name,
      startAddress,
      startLat,
      startLng,
      vehicleType,
      consumption,
      pricePerUnit,
      totalDistanceKm,
      totalDurationMin,
      totalFuelCost,
      routeGeometry: routeGeometry ?? undefined,
      stops: {
        create: (stops || []).map((s: { address: string; displayName?: string; lat: number; lng: number; sequence: number }) => ({
          address: s.address,
          displayName: s.displayName,
          lat: s.lat,
          lng: s.lng,
          sequence: s.sequence,
        })),
      },
    },
    include: { stops: { orderBy: { sequence: "asc" } } },
  });

  return NextResponse.json(route);
}

// DELETE — delete route
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const { id } = await params;
  await prisma.savedRoute.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
