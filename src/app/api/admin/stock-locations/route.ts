import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES", "WAREHOUSE"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const locations = await prisma.stockLocation.findMany({
    where: { isActive: true },
    include: { _count: { select: { stocks: true } } },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return NextResponse.json(locations);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name, address, isDefault } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Вкажіть назву" }, { status: 400 });

  // If setting as default, unset others
  if (isDefault) {
    await prisma.stockLocation.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  }

  const location = await prisma.stockLocation.create({
    data: { name: name.trim(), address: address?.trim() || null, isDefault: !!isDefault },
  });
  return NextResponse.json(location, { status: 201 });
}
