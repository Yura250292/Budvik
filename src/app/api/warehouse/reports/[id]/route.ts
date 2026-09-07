/** Одна накладна з позиціями. Своя — або будь-яка, якщо це офіс. */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, WAREHOUSE_ROLES, OFFICE_ROLES } from "@/lib/app/identity";
import { reportDto } from "@/lib/warehouse/reports";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, WAREHOUSE_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const isOffice = (OFFICE_ROLES as readonly string[]).includes(auth.me.role);

  const report = await prisma.warehouseReport.findFirst({
    where: { id, ...(isOffice ? {} : { userId: auth.me.userId }) },
    include: { items: { orderBy: { name: "asc" } } },
  });

  // 404, а не 403, на чужу накладну: інакше відповідь підказувала б, що
  // документ із таким id існує.
  if (!report) return NextResponse.json({ error: "Накладну не знайдено" }, { status: 404 });

  return NextResponse.json(
    {
      report: reportDto(report),
      items: report.items.map((i) => ({
        id: i.id,
        name: i.name,
        sku: i.sku,
        quantity: i.quantity,
        price: i.price,
        unit: i.unit,
        lineTotal: i.lineTotal,
        matchedProductId: i.matchedProductId,
        matchedProductName: i.matchedProductName,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
