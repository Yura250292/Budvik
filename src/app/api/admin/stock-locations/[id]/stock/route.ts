import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES", "WAREHOUSE"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim();

  const where: Record<string, unknown> = { stockLocationId: id };
  if (search) {
    where.product = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
      ],
    };
  }

  const stocks = await prisma.locationStock.findMany({
    where,
    include: { product: { select: { id: true, name: true, sku: true, image: true, stock: true } } },
    orderBy: { product: { name: "asc" } },
    take: 100,
  });
  return NextResponse.json(stocks);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { productId, quantity } = await req.json();
  if (!productId || quantity === undefined) {
    return NextResponse.json({ error: "Вкажіть товар і кількість" }, { status: 400 });
  }

  const stock = await prisma.locationStock.upsert({
    where: { stockLocationId_productId: { stockLocationId: id, productId } },
    update: { quantity },
    create: { stockLocationId: id, productId, quantity },
    include: { product: { select: { id: true, name: true, sku: true } } },
  });
  return NextResponse.json(stock);
}
