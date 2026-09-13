import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { FIELD_ROLES, requireRoles } from "@/lib/app/identity";
import { parsePushPrefs, PUSH_CATEGORIES } from "@/lib/rep-feed/prefs";

/**
 * Які категорії пушів стрічки торговий вимкнув.
 *
 * Міняє лише себе — id із сесії, не з тіла. Невідомі типи в тілі мовчки
 * відкидаються (parsePushPrefs), тож старий застосунок із застарілим
 * списком нічого не зламає.
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
    return NextResponse.json({ error: "Очікується { mutedTypes: string[] }" }, { status: 400 });
  }
  const prefs = parsePushPrefs(body);

  await prisma.user.update({
    where: { id: auth.me.userId },
    data: { notificationPrefs: prefs },
  });
  return NextResponse.json({ ...prefs, categories: PUSH_CATEGORIES });
}
