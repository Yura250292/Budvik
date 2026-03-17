import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { salesDocumentId } = await req.json();

  const route = await prisma.deliveryRoute.findUnique({ where: { id } });
  if (!route) return NextResponse.json({ error: "Маршрут не знайдено" }, { status: 404 });
  if (route.status !== "PLANNED") return NextResponse.json({ error: "Маршрут вже виконується або завершений" }, { status: 400 });

  const doc = await prisma.salesDocument.findUnique({
    where: { id: salesDocumentId },
    include: { counterparty: { select: { address: true } } },
  });
  if (!doc) return NextResponse.json({ error: "Замовлення не знайдено" }, { status: 404 });

  const stopCount = await prisma.deliveryStop.count({ where: { deliveryRouteId: id } });

  await prisma.$transaction([
    prisma.deliveryStop.create({
      data: {
        deliveryRouteId: id,
        salesDocumentId: doc.id,
        counterpartyId: doc.counterpartyId || null,
        sequence: stopCount + 1,
        address: doc.counterparty?.address || null,
      },
    }),
    prisma.salesDocument.update({
      where: { id: salesDocumentId },
      data: { deliveryMethod: "DRIVER" },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
