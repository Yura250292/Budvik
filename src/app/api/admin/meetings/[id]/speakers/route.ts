import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { MEETING_ROLES, MeetingError, renameSpeaker } from "@/lib/meetings";

/** Хто є хто: { label: "A", name?, userId? }. Текст транскрипту не переписується. */
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, MEETING_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const body = await req.json().catch(() => null);
    return NextResponse.json({ speakerMap: await renameSpeaker(id, body) });
  } catch (e) {
    if (e instanceof MeetingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
