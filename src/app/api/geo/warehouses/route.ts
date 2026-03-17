import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET — list warehouses with coordinates
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const warehouses = await prisma.stockLocation.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  return NextResponse.json(warehouses);
}

// POST — create warehouse
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!role || !["ADMIN", "MANAGER"].includes(role)) {
    return NextResponse.json({ error: "Доступ заборонено" }, { status: 403 });
  }

  const body = await req.json();
  const { name, address, lat, lng, isDefault } = body as {
    name: string;
    address?: string;
    lat?: number;
    lng?: number;
    isDefault?: boolean;
  };

  if (!name) {
    return NextResponse.json({ error: "Назва обов'язкова" }, { status: 400 });
  }

  // If setting as default, unset others
  if (isDefault) {
    await prisma.stockLocation.updateMany({ data: { isDefault: false } });
  }

  const warehouse = await prisma.stockLocation.create({
    data: { name, address, lat, lng, isDefault: isDefault || false },
  });

  return NextResponse.json(warehouse, { status: 201 });
}

// PUT — update warehouse (by id in body)
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!role || !["ADMIN", "MANAGER"].includes(role)) {
    return NextResponse.json({ error: "Доступ заборонено" }, { status: 403 });
  }

  const body = await req.json();
  const { id, name, address, lat, lng, isDefault } = body;

  if (!id) {
    return NextResponse.json({ error: "ID обов'язковий" }, { status: 400 });
  }

  if (isDefault) {
    await prisma.stockLocation.updateMany({ data: { isDefault: false } });
  }

  const warehouse = await prisma.stockLocation.update({
    where: { id },
    data: { name, address, lat, lng, isDefault },
  });

  return NextResponse.json(warehouse);
}
