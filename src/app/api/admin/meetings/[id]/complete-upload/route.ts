import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { MEETING_ROLES, MeetingError, completeUpload } from "@/lib/meetings";

/**
 * Браузер доклав файл: перевіряємо, що об'єкт справді є в R2, і ставимо нараду
 * в чергу воркера. Тіло: { key, durationMs? }. Повторний виклик після успіху —
 * не помилка (відповідь могла обірватись).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, MEETING_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const body = await req.json().catch(() => null);
    return NextResponse.json({ item: await completeUpload(id, body) });
  } catch (e) {
    if (e instanceof MeetingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
