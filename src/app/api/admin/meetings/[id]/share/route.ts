import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { MEETING_ROLES, MeetingError } from "@/lib/meetings";
import { getShareState, pushMeetingShare, shareMeeting, unshareMeeting } from "@/lib/meetings/share";

/**
 * Підсумок наради — команді в кабінети (src/lib/meetings/share.ts).
 *
 * GET — кому вже надіслано і кого запропонувати.
 * POST { userIds } — надіслати; тим, хто вже має, нічого не станеться.
 * POST { action: "push" } — пуш тим, хто його ще не отримав, і поза робочими
 *   годинами теж: цю кнопку керівник натискає свідомо.
 * DELETE ?userId= — прибрати в однієї людини; без параметра — в усіх.
 *
 * Пуш чекаємо тут же, а не після відповіді: людей до двох десятків, а
 * керівник одразу бачить, кому пуш пішов.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function failed(e: unknown) {
  if (e instanceof MeetingError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
}

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireRoles(req, MEETING_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    return NextResponse.json({ state: await getShareState(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failed(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireRoles(req, MEETING_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const added = body.action === "push" ? 0 : (await shareMeeting(id, body)).added;
    const pushed = await pushMeetingShare(id, { force: body.action === "push" });
    return NextResponse.json({ added, pushed, state: await getShareState(id) });
  } catch (e) {
    return failed(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireRoles(req, MEETING_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const userId = new URL(req.url).searchParams.get("userId");
  try {
    await unshareMeeting(id, userId || null);
    return NextResponse.json({ state: await getShareState(id) });
  } catch (e) {
    return failed(e);
  }
}
