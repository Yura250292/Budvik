import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildLowStockReport, DEFAULT_PARAMS } from "@/lib/procurement/low-stock";

/**
 * Дані для сторінки закупівель.
 *
 * Без brandId — список брендів з кількістю активних товарів (для селекта).
 * З brandId — звіт «чого мало» по бренду. Пороги приходять з форми,
 * дефолти — у DEFAULT_PARAMS.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const brandId = searchParams.get("brandId");

  if (!brandId) {
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

  const num = (key: keyof typeof DEFAULT_PARAMS) => {
    const raw = Number(searchParams.get(key));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PARAMS[key];
  };

  const report = await buildLowStockReport({
    brandId,
    expensivePrice: num("expensivePrice"),
    expensiveMin: num("expensiveMin"),
    cheapMin: num("cheapMin"),
  });
  if (!report) return NextResponse.json({ error: "Бренд не знайдено" }, { status: 404 });
  return NextResponse.json({ report });
}
