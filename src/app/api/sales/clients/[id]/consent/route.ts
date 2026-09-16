import { NextResponse } from "next/server";
import { CABINET_ROLES, requireRoles } from "@/lib/app/identity";
import { OutreachError, setClientConsent } from "@/lib/outreach";

/**
 * Згода клієнта на повідомлення і як йому зручніше писати — зі слів торгового.
 *
 * Ролі картки клієнта: хто клієнта відкрив і з ним говорив, той і фіксує.
 * Хто саме — лишається в marketingConsentById.
 */
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, CABINET_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    const body = await req.json().catch(() => null);
    return NextResponse.json(await setClientConsent(id, body, auth.me.userId));
  } catch (e) {
    if (e instanceof OutreachError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
