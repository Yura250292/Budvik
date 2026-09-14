import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { MEETING_ROLES, MeetingError, regenerateMeeting } from "@/lib/meetings";

/**
 * Перескласти підсумок готової наради (скажімо, після перейменування спікерів).
 * Транскрипт лишається; непідтверджені задачі народяться заново, надіслані — ні.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, MEETING_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    return NextResponse.json({ item: await regenerateMeeting(id) });
  } catch (e) {
    if (e instanceof MeetingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
