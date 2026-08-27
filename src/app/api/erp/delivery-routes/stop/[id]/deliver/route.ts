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

  const stop = await prisma.deliveryStop.findUnique({
    where: { id },
    include: { deliveryRoute: true },
  });

  if (!stop) {
    return NextResponse.json({ error: "Зупинку не знайдено" }, { status: 404 });
  }

  // Driver can only deliver their own routes
  if (me.role === "DRIVER" && stop.deliveryRoute.driverId !== me.userId) {
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
  } else if (stop.deliveryRoute.status === "ASSIGNED") {
    await prisma.deliveryRoute.update({
      where: { id: stop.deliveryRouteId },
      data: { status: "IN_PROGRESS" },
    });
  }

  return NextResponse.json({ ok: true });
}
