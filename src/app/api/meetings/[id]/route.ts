import { NextResponse } from "next/server";
import { STAFF_ROLES, requireRoles } from "@/lib/app/identity";
import { MeetingError } from "@/lib/meetings";
import { getSharedMeeting } from "@/lib/meetings/share";

/**
 * Одна нарада в кабінеті: підсумок, рішення, хто що робить.
 * Не надсилали цій людині (або керівник прибрав) — 404.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, STAFF_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    return NextResponse.json(
      { item: await getSharedMeeting(auth.me.userId, id) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    if (e instanceof MeetingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
