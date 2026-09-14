import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { MEETING_ROLES, MeetingError, prepareUpload } from "@/lib/meetings";

/**
 * Посилання, за яким браузер сам кладе аудіо в R2.
 *
 * Тіло запиту до функції Vercel обмежене 4,5 МБ, а година наради — десятки
 * мегабайтів, тож через роут файл не йде: тут лише перевірка доступу, розміру й
 * типу. Тіло: { fileName, contentType, size }.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, MEETING_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const body = await req.json().catch(() => null);
    return NextResponse.json(await prepareUpload(id, body), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof MeetingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
