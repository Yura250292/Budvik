import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { FIELD_ROLES, requireRoles } from "@/lib/app/identity";
import { parsePushPrefs, PUSH_CATEGORIES } from "@/lib/rep-feed/prefs";
import { savePrefs } from "@/lib/rep-feed/prefs-store";

/**
 * Які категорії пушів стрічки торговий вимкнув.
 *
 * Міняє лише себе — id із сесії, не з тіла. Невідомі типи в тілі мовчки
 * відкидаються (parsePushPrefs), тож старий застосунок із застарілим
 * списком нічого не зламає.
 *
 * Пишеться лише те, що прийшло в тілі (злиттям, prefs-store.ts): старий
 * застосунок шле самі mutedTypes, і вибір «чужі накладні» від цього не
 * скидається.
 */
export async function GET(req: Request) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;

  const user = await prisma.user.findUnique({
    where: { id: auth.me.userId },
    select: { notificationPrefs: true },
  });
  return NextResponse.json({
    ...parsePushPrefs(user?.notificationPrefs),
    categories: PUSH_CATEGORIES,
  });
}

export async function PATCH(req: Request) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Очікується { mutedTypes?: string[], othersDocs?: boolean }" }, { status: 400 });
  }
  const parsed = parsePushPrefs(body);
  const patch: Record<string, unknown> = {};
  if ("mutedTypes" in body) patch.mutedTypes = parsed.mutedTypes;
  if ("othersDocs" in body) patch.othersDocs = parsed.othersDocs;

  const saved = await savePrefs(auth.me.userId, patch);
  return NextResponse.json({ ...parsePushPrefs(saved), categories: PUSH_CATEGORIES });
}
