import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const access = await prisma.salesRepCategoryAccess.findMany({
    where: { salesRepId: id },
    include: { category: { select: { id: true, name: true, slug: true } } },
    orderBy: { category: { name: "asc" } },
  });
  return NextResponse.json(access);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const { categoryIds } = await req.json();

  if (!Array.isArray(categoryIds)) {
    return NextResponse.json({ error: "Невалідні дані" }, { status: 400 });
  }

  // Replace all category access
  await prisma.$transaction(async (tx) => {
    await tx.salesRepCategoryAccess.deleteMany({ where: { salesRepId: id } });
    if (categoryIds.length > 0) {
      await tx.salesRepCategoryAccess.createMany({
        data: categoryIds.map((categoryId: string) => ({ salesRepId: id, categoryId })),
      });
    }
  });

  const updated = await prisma.salesRepCategoryAccess.findMany({
    where: { salesRepId: id },
    include: { category: { select: { id: true, name: true, slug: true } } },
  });
  return NextResponse.json(updated);
}
