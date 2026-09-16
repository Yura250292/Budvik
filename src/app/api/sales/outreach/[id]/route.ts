import { NextResponse } from "next/server";
import { CABINET_ROLES, requireRoles } from "@/lib/app/identity";
import { OutreachError, setOutreachOutcome } from "@/lib/outreach";

/** Результат пропозиції руками: автор або офіс. */
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, CABINET_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    const body = (await req.json().catch(() => null)) as { outcome?: unknown } | null;
    const item = await setOutreachOutcome(id, body?.outcome, auth.me);
    return NextResponse.json({ item: { ...item, canEdit: true } });
  } catch (e) {
    if (e instanceof OutreachError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
