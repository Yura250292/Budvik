import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles } from "@/lib/app/identity";
import { feedPage } from "@/lib/rep-feed/feed-query";
import { parseAdminFeedPrefs } from "@/lib/rep-feed/prefs";
import { savePrefs } from "@/lib/rep-feed/prefs-store";

/**
 * Стрічка подій усієї команди для керівника: оплати, накладні, повернення
 * й підказки кожного торгового, з іменем біля рядка. Торговому закрито —
 * тут чужі клієнти й гроші (middleware теж блокує /admin/feed для SALES).
 *
 * Перша сторінка (без курсора) — це «керівник відкрив стрічку»: повертаємо
 * попередню позначку перегляду `seenAt` (новіші рядки сторінка підсвічує) і
 * ставимо нову — цифра в сайдбарі обнуляється.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, ["ADMIN", "MANAGER"]);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const repId = url.searchParams.get("repId") || undefined;

  const firstPage = !url.searchParams.get("cursor");
  let seenAt: string | null = null;
  if (firstPage) {
    const me = await prisma.user.findUnique({ where: { id: auth.me.userId }, select: { notificationPrefs: true } });
    seenAt = parseAdminFeedPrefs(me?.notificationPrefs).feedSeenAt;
    await savePrefs(auth.me.userId, { feedSeenAt: new Date().toISOString() });
  }

  const [page, reps] = await Promise.all([
    feedPage({
      userId: repId,
      filter: url.searchParams.get("filter"),
      cursor: url.searchParams.get("cursor"),
    }),
    prisma.user.findMany({
      where: { role: "SALES" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Відфільтрували за людиною — feedPage не підставив імені; повертаємо його.
  const repName = repId ? (reps.find((r) => r.id === repId)?.name.trim() ?? null) : null;
  return NextResponse.json({
    rows: repId ? page.rows.map((r) => ({ ...r, rep: repName ? { id: repId, name: repName } : null })) : page.rows,
    nextCursor: page.nextCursor,
    reps: reps.map((r) => ({ id: r.id, name: r.name.trim() })),
    ...(firstPage ? { seenAt } : {}),
  });
}
