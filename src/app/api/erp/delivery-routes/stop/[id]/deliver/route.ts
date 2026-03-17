import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "DRIVER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const stop = await prisma.deliveryStop.findUnique({
    where: { id },
    include: { deliveryRoute: true },
  });

  if (!stop) {
    return NextResponse.json({ error: "Зупинку не знайдено" }, { status: 404 });
  }

  // Driver can only deliver their own routes
  if (session.user.role === "DRIVER" && stop.deliveryRoute.driverId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.deliveryStop.update({
    where: { id },
    data: { status: "DELIVERED", deliveredAt: new Date() },
  });

  // Check if all stops are delivered → complete the route
  const allStops = await prisma.deliveryStop.findMany({
    where: { deliveryRouteId: stop.deliveryRouteId },
  });
  const allDelivered = allStops.every((s) => s.id === id ? true : s.status === "DELIVERED");

  if (allDelivered) {
    await prisma.deliveryRoute.update({
      where: { id: stop.deliveryRouteId },
      data: { status: "COMPLETED" },
    });
  } else if (stop.deliveryRoute.status === "PLANNED") {
    await prisma.deliveryRoute.update({
      where: { id: stop.deliveryRouteId },
      data: { status: "IN_PROGRESS" },
    });
  }

  return NextResponse.json({ ok: true });
}
