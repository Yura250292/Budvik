import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildLowStockReport, DEFAULT_PARAMS } from "@/lib/procurement/low-stock";
import { parseVelocityDays } from "@/lib/analytics/velocity-window";

/**
 * Звіт закупівель.
 *
 * brandId необов'язковий: без нього — огляд по всьому складу зі зведенням
 * по брендах, з ним — звіт по одному бренду. Список брендів для селекта
 * віддає окремий /brands, щоб цей маршрут завжди повертав звіт.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const num = (key: keyof typeof DEFAULT_PARAMS) => {
    const raw = Number(searchParams.get(key));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PARAMS[key];
  };

  const report = await buildLowStockReport({
    brandId: searchParams.get("brandId") || null,
    expensivePrice: num("expensivePrice"),
    expensiveMin: num("expensiveMin"),
    cheapMin: num("cheapMin"),
    includeDead: searchParams.get("includeDead") === "1",
    search: searchParams.get("search") ?? undefined,
    velocityDays: parseVelocityDays(searchParams.get("days")),
  });
  if (!report) return NextResponse.json({ error: "Бренд не знайдено" }, { status: 404 });
  return NextResponse.json({ report });
}
