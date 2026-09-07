/**
 * Фото своєї накладної.
 *
 * Окремо від /api/admin/warehouse-reports/[id]/photo, бо там гейт ADMIN/MANAGER.
 * Знімки накладних приватні: віддаємо їх через S3 API, а не публічним
 * посиланням R2, і лише власникові або офісу.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, WAREHOUSE_ROLES, OFFICE_ROLES } from "@/lib/app/identity";
import { getFile } from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, WAREHOUSE_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const isOffice = (OFFICE_ROLES as readonly string[]).includes(auth.me.role);

  const report = await prisma.warehouseReport.findFirst({
    where: { id, ...(isOffice ? {} : { userId: auth.me.userId }) },
    select: { photoKey: true, photoMimeType: true },
  });

  if (!report?.photoKey) {
    return NextResponse.json({ error: "Фото не знайдено" }, { status: 404 });
  }

  const file = await getFile(report.photoKey);
  if (!file) return NextResponse.json({ error: "Фото не знайдено у сховищі" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      "Content-Type": report.photoMimeType || file.contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
