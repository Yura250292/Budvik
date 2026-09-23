import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles } from "@/lib/app/identity";
import { ADMIN_PUSH_CATEGORIES, parseAdminFeedPrefs } from "@/lib/rep-feed/prefs";
import { savePrefs } from "@/lib/rep-feed/prefs-store";

/**
 * Про які події команди керівник хоче пуш (типово — ні про які). Міняє
 * лише себе: id із сесії. Пише злиттям, тож позначка «переглянув стрічку»
 * не губиться.
 */
export const dynamic = "force-dynamic";

const ALLOWED = new Set<string>(ADMIN_PUSH_CATEGORIES.map((c) => c.type));

function out(raw: unknown) {
  const { adminTypes } = parseAdminFeedPrefs(raw);
  return NextResponse.json({
    adminTypes: adminTypes.filter((t) => ALLOWED.has(t)),
    categories: ADMIN_PUSH_CATEGORIES,
  });
}

export async function GET(req: Request) {
  const auth = await requireRoles(req, ["ADMIN", "MANAGER"]);
  if (!auth.ok) return auth.response;
  const user = await prisma.user.findUnique({
    where: { id: auth.me.userId },
    select: { notificationPrefs: true },
  });
  return out(user?.notificationPrefs);
}

export async function PATCH(req: Request) {
  const auth = await requireRoles(req, ["ADMIN", "MANAGER"]);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !Array.isArray(body.adminTypes)) {
    return NextResponse.json({ error: "Очікується { adminTypes: string[] }" }, { status: 400 });
  }
  const adminTypes = parseAdminFeedPrefs(body).adminTypes.filter((t) => ALLOWED.has(t));
  return out(await savePrefs(auth.me.userId, { adminTypes }));
}
