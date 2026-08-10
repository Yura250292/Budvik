import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET — list warehouses with coordinates
export async function GET() {
  const session = await getServerSession(authOptions);
  // Той самий перелік ролей, що й у /api/admin/stock-locations: адреси складів
  // не мають бути видні клієнтам, а раніше сюди пускало будь-кого залогіненого.
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!role || !["ADMIN", "MANAGER", "SALES", "WAREHOUSE"].includes(role)) {
    return NextResponse.json({ error: "Доступ заборонено" }, { status: 403 });
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
  // where обов'язковий: без нього updateMany переписує ВСІ склади, а не лише
  // ті, що були дефолтними.
  if (isDefault) {
    await prisma.stockLocation.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
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
    await prisma.stockLocation.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  }

  const warehouse = await prisma.stockLocation.update({
    where: { id },
    data: { name, address, lat, lng, isDefault },
  });

  return NextResponse.json(warehouse);
}
