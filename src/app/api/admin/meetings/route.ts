import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { rateLimit } from "@/lib/shop/rate-limit";
import { MEETING_ROLES, MeetingError, createMeeting, listMeetings } from "@/lib/meetings";

/**
 * Наради: список і нова.
 *
 * Аудіо в тілі не їде — його браузер кладе в R2 сам (upload-url →
 * complete-upload). Текстова нотатка приходить одразу і стає в чергу на підсумок.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, MEETING_ROLES);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await listMeetings(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const auth = await requireRoles(req, MEETING_ROLES);
  if (!auth.ok) return auth.response;

  const limit = await rateLimit(`meeting-create:${auth.me.userId}`, 30, 3600);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Забагато нарад за годину — зачекайте" }, { status: 429 });
  }
  try {
    const body = await req.json().catch(() => null);
    return NextResponse.json({ item: await createMeeting(auth.me.userId, body) }, { status: 201 });
  } catch (e) {
    if (e instanceof MeetingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
