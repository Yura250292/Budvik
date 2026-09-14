import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { MEETING_ROLES, MeetingError, playbackUrl } from "@/lib/meetings";

/**
 * Запис наради для плеєра: перенаправлення на підписане посилання в R2.
 *
 * Байти йдуть із Cloudflare напряму (перемотка працює через Range), а доступ
 * перевіряється тут. Посилання живе годину і ніде не зберігається.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, MEETING_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const url = await playbackUrl(id);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof MeetingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
