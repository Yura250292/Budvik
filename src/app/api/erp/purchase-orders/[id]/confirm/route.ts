import { NextRequest, NextResponse } from "next/server";
import { confirmPurchaseOrder } from "@/lib/erp/purchase-orders";
import { requireRoles, OFFICE_ROLES } from "@/lib/app/identity";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    await confirmPurchaseOrder(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Помилка" },
      { status: 400 }
    );
  }
}
