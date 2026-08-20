/**
 * Нічний зріз вебаналітики + чистка сирих подій.
 *
 * Дві задачі в одному проході, бо вони пов'язані: перш ніж видаляти
 * сирі події, з них треба зняти денні підсумки, інакше історія
 * відвідуваності зникне разом із рядками.
 *
 * Викликається Vercel Cron (Authorization: Bearer CRON_SECRET) або
 * вручну із заголовком x-cron-secret — як у close-abandoned. Адмін теж
 * може смикнути через сесію, щоб перевірити роботу.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart, kyivDayEnd } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

/** Скільки тримаємо сирі події. Денні підсумки лишаються назавжди. */
const RAW_RETENTION_DAYS = 180;

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = req.headers.get("x-cron-secret");
  const bearer = req.headers.get("authorization");
  const viaCron = Boolean(
    cronSecret &&
      ((headerSecret && headerSecret === cronSecret) || bearer === `Bearer ${cronSecret}`)
  );

  if (!viaCron) {
    const session = await getServerSession(authOptions);
    if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Рахуємо вчорашню добу: сьогоднішня ще триває, і її підсумок був би
  // неповним. Запуск о 03:30 за Києвом — вчора вже точно закрите.
  const yesterday = kyivDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const from = kyivDayStart(yesterday);
  const to = kyivDayEnd(yesterday);

  const [agg] = await prisma.$queryRaw<
    Array<{
      visitors: bigint;
      sessions: bigint;
      page_views: bigint;
      product_views: bigint;
      searches: bigint;
      add_to_carts: bigint;
      orders_placed: bigint;
      phone_clicks: bigint;
    }>
  >`
    SELECT
      COUNT(DISTINCT "visitorId")                                   AS visitors,
      COUNT(DISTINCT "sessionId")                                   AS sessions,
      COUNT(*) FILTER (WHERE "type" = 'page_view')                  AS page_views,
      COUNT(*) FILTER (WHERE "type" = 'product_view')               AS product_views,
      COUNT(*) FILTER (WHERE "type" = 'search')                     AS searches,
      COUNT(*) FILTER (WHERE "type" = 'add_to_cart')                AS add_to_carts,
      COUNT(*) FILTER (WHERE "type" = 'order_placed')               AS orders_placed,
      COUNT(*) FILTER (WHERE "type" = 'phone_click')                AS phone_clicks
    FROM "SiteEvent"
    WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
  `;

  const stats = {
    visitors: Number(agg?.visitors ?? 0),
    sessions: Number(agg?.sessions ?? 0),
    pageViews: Number(agg?.page_views ?? 0),
    productViews: Number(agg?.product_views ?? 0),
    searches: Number(agg?.searches ?? 0),
    addToCarts: Number(agg?.add_to_carts ?? 0),
    ordersPlaced: Number(agg?.orders_placed ?? 0),
    phoneClicks: Number(agg?.phone_clicks ?? 0),
  };

  // upsert, а не create: повторний запуск того самого дня має
  // перерахувати рядок, а не впасти на унікальному індексі.
  const day = new Date(`${yesterday}T00:00:00Z`);
  await prisma.siteDailyStat.upsert({
    where: { date: day },
    create: { date: day, ...stats },
    update: stats,
  });

  const cutoff = new Date(Date.now() - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const pruned = await prisma.siteEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return NextResponse.json({ ok: true, day: yesterday, ...stats, pruned: pruned.count });
}

/** Vercel Cron ходить GET-ом, ручний виклик зручніше робити POST-ом. */
export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
