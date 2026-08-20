/**
 * Скільки людей на сайті просто зараз.
 *
 * Вікно — 5 хвилин: клієнт шле пачку раз на 15 секунд, тож активний
 * відвідувач за цей час обов'язково відзначиться, а той, хто закрив
 * вкладку, тихо випаде.
 *
 * Періоду тут немає навмисно: це не звіт, а лічильник, і фронт смикає
 * його щопівхвилини окремо від решти вкладки.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const WINDOW_MINUTES = 5;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

  const [online, pages] = await Promise.all([
    prisma.$queryRaw<Array<{ visitors: bigint }>>`
      SELECT COUNT(DISTINCT "visitorId") AS visitors
      FROM "SiteEvent"
      WHERE "createdAt" >= ${since}
    `,
    prisma.$queryRaw<Array<{ path: string; visitors: bigint }>>`
      SELECT "path" AS path, COUNT(DISTINCT "visitorId") AS visitors
      FROM "SiteEvent"
      WHERE "createdAt" >= ${since} AND "type" = 'page_view' AND "path" IS NOT NULL
      GROUP BY 1
      ORDER BY visitors DESC
      LIMIT 8
    `,
  ]);

  return NextResponse.json({
    windowMinutes: WINDOW_MINUTES,
    online: Number(online[0]?.visitors ?? 0),
    pages: pages.map((r) => ({ path: r.path, visitors: Number(r.visitors) })),
  });
}
