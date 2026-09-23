import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles } from "@/lib/app/identity";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { feedCounts } from "@/lib/rep-feed/feed-query";
import { parseAdminFeedPrefs } from "@/lib/rep-feed/prefs";

/**
 * Цифра біля пункту «Стрічка подій» у сайдбарі: нові з останнього
 * перегляду й усього за сьогодні. Опитується раз на хвилину, як дзвіночок.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, ["ADMIN", "MANAGER"]);
  if (!auth.ok) return auth.response;

  const user = await prisma.user.findUnique({
    where: { id: auth.me.userId },
    select: { notificationPrefs: true },
  });
  const { feedSeenAt } = parseAdminFeedPrefs(user?.notificationPrefs);
  const counts = await feedCounts(feedSeenAt ? new Date(feedSeenAt) : null, kyivDayStart(kyivDate(new Date())));
  return NextResponse.json(counts);
}
