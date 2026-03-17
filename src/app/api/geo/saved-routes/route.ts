import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET — list saved routes
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const routes = await prisma.savedRoute.findMany({
    include: { stops: { orderBy: { sequence: "asc" } } },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(routes);
}

// POST — save a new route
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const body = await req.json();
  const {
    name, startAddress, startLat, startLng,
    vehicleType, consumption, pricePerUnit,
    totalDistanceKm, totalDurationMin, totalFuelCost,
    routeGeometry, stops,
  } = body as {
    name: string;
    startAddress: string;
    startLat: number;
    startLng: number;
    vehicleType?: string;
    consumption?: number;
    pricePerUnit?: number;
    totalDistanceKm?: number;
    totalDurationMin?: number;
    totalFuelCost?: number;
    routeGeometry?: unknown;
    stops: Array<{ address: string; displayName?: string; lat: number; lng: number; sequence: number }>;
  };

  if (!name || !startAddress || startLat == null || startLng == null) {
    return NextResponse.json({ error: "Назва та початкова точка обов'язкові" }, { status: 400 });
  }

  const route = await prisma.savedRoute.create({
    data: {
      name,
      startAddress,
      startLat,
      startLng,
      vehicleType: vehicleType || "fuel",
      consumption: consumption ?? 10,
      pricePerUnit: pricePerUnit ?? 56,
      totalDistanceKm,
      totalDurationMin,
      totalFuelCost,
      routeGeometry: routeGeometry ?? undefined,
      createdById: userId,
      stops: {
        create: (stops || []).map((s) => ({
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

  return NextResponse.json(route, { status: 201 });
}
