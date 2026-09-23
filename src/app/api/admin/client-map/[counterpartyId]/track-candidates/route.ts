/**
 * Кандидати на точку клієнта з треку торгового — для попапу адмін-карти.
 *
 * Лише офіс: торговий свою точку ставить «Я зараз тут», стоячи біля
 * дверей, а чужі стоянки йому бачити ні до чого. Нічого не пише — точку
 * ставить людина звичайним PATCH /api/admin/client-map/[id]. Чому
 * кандидати, а не автомат, — див. lib/routes/pin-candidates.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRoles, OFFICE_ROLES } from "@/lib/app/identity";
import { pinCandidates } from "@/lib/routes/pin-candidates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ counterpartyId: string }> }) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const { counterpartyId } = await params;
  const result = await pinCandidates(counterpartyId);
  if (!result) return NextResponse.json({ error: "Клієнта не знайдено" }, { status: 404 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
