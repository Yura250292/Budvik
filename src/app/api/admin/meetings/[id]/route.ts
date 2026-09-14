import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { MEETING_ROLES, MeetingError, deleteMeeting, getMeeting, updateMeeting } from "@/lib/meetings";

/**
 * Одна нарада: стан (сторінка опитує його, поки воркер працює), правка назви
 * й дати, видалення разом із записом у R2.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function fail(e: unknown) {
  if (e instanceof MeetingError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
}

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireRoles(req, MEETING_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    return NextResponse.json({ item: await getMeeting(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireRoles(req, MEETING_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const body = await req.json().catch(() => null);
    return NextResponse.json({ item: await updateMeeting(id, body) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireRoles(req, MEETING_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await deleteMeeting(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
