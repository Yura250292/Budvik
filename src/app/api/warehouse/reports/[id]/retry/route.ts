/**
 * Ще одна спроба прочитати накладну — тим самим фото.
 *
 * Потрібно саме тому, що найчастіша причина невдачі не в знімку: обірваний
 * виклик до Gemini, стеля запитів, хвилина без зв'язку. Змушувати людину
 * бігти назад до накладної й перезнімати її через це — найдорожчий спосіб
 * виправити чужу помилку.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, WAREHOUSE_ROLES, OFFICE_ROLES } from "@/lib/app/identity";
import { processReport, reportDto } from "@/lib/warehouse/reports";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, WAREHOUSE_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const isOffice = (OFFICE_ROLES as readonly string[]).includes(auth.me.role);

  const report = await prisma.warehouseReport.findFirst({
    where: { id, ...(isOffice ? {} : { userId: auth.me.userId }) },
  });
  if (!report) return NextResponse.json({ error: "Накладну не знайдено" }, { status: 404 });

  if (report.status === "DONE") {
    return NextResponse.json({ report: reportDto(report) });
  }

  /**
   * Лічильник спроб обнуляємо: три невдачі поспіль зробили звіт FAILED, і без
   * цього кнопка «Спробувати ще раз» не робила б нічого, крім четвертого
   * запису в errorMessage.
   */
  const fresh = await prisma.warehouseReport.update({
    where: { id: report.id },
    data: { attempts: 0, status: "PENDING", errorMessage: null },
  });

  const result = await processReport(fresh);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, canRetry: result.willRetry },
      { status: 422 }
    );
  }

  return NextResponse.json({ report: reportDto(result.report) });
}
