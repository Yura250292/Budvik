import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles } from "@/lib/app/identity";
import { feedPage } from "@/lib/rep-feed/feed-query";

/**
 * Стрічка подій усієї команди для керівника: оплати, накладні, повернення
 * й підказки кожного торгового, з іменем біля рядка. Торговому закрито —
 * тут чужі клієнти й гроші (middleware теж блокує /admin/feed для SALES).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, ["ADMIN", "MANAGER"]);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const repId = url.searchParams.get("repId") || undefined;

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
  });
}
