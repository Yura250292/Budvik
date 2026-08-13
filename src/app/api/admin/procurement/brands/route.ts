import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Список брендів для селекта фільтра. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const brands = await prisma.brand.findMany({
    select: { id: true, name: true, _count: { select: { products: { where: { isActive: true } } } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    brands: brands
      .filter((b) => b._count.products > 0)
      .map((b) => ({ id: b.id, name: b.name, products: b._count.products })),
  });
}
