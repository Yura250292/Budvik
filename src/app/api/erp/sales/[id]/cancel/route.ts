import { NextRequest, NextResponse } from "next/server";
import { cancelSalesDocument } from "@/lib/erp/sales";
import { requireRoles, CABINET_ROLES } from "@/lib/app/identity";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRoles(req, CABINET_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    await cancelSalesDocument(id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
