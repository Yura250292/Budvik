import { NextResponse } from "next/server";
import { STAFF_ROLES, requireRoles } from "@/lib/app/identity";
import { listSharedMeetings } from "@/lib/meetings/share";

/**
 * Підсумки нарад, які керівник надіслав цій людині, — для кабінету
 * торгового, водія й складу.
 *
 * Лише свої: доступ дає рядок розсилки (src/lib/meetings/share.ts), тож чужої
 * наради не видно навіть підставивши id руками.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, STAFF_ROLES);
  if (!auth.ok) return auth.response;
  return NextResponse.json(
    { items: await listSharedMeetings(auth.me.userId) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
