import { NextRequest, NextResponse } from "next/server";
import { deliverSalesDocument } from "@/lib/erp/sales";
import { requireRoles, DRIVER_ROLES } from "@/lib/app/identity";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRoles(req, DRIVER_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    await deliverSalesDocument(id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
