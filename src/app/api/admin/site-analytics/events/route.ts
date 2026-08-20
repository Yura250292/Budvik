/**
 * Кліки й воронка: що люди роблять і де сходять з дистанції.
 *
 * Воронка рахується по СЕСІЯХ, а не по подіях: питання «скільки візитів
 * дійшло до кошика» — про людей, а не про кількість натискань. Кроки
 * навмисно не вимагають послідовності (людина могла покласти товар із
 * каталогу, не відкриваючи картку) — кожен крок це «чи траплялося таке в
 * цій сесії».
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod } from "@/lib/analytics/period";

export const dynamic = "force-dynamic";

/** Людські назви типів подій для таблиці. */
const TYPE_LABELS: Record<string, string> = {
  page_view: "Перегляд сторінки",
  product_view: "Перегляд товару",
  search: "Пошук",
  add_to_cart: "Додав у кошик",
  add_to_wishlist: "Додав в обране",
  add_to_compare: "Додав у порівняння",
  order_placed: "Оформив замовлення",
  phone_click: "Клік по контакту",
};

const CONTACT_LABELS: Record<string, string> = {
  tel: "Телефон",
  mailto: "Пошта",
  viber: "Viber",
  telegram: "Telegram",
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const { from, to, fromDay, toDay } = parsePeriod(searchParams);

  const [byType, contacts, funnel] = await Promise.all([
    prisma.$queryRaw<Array<{ type: string; events: bigint; visitors: bigint }>>`
      SELECT "type" AS type, COUNT(*) AS events, COUNT(DISTINCT "visitorId") AS visitors
      FROM "SiteEvent"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY 1
      ORDER BY events DESC
    `,

    prisma.$queryRaw<Array<{ label: string; clicks: bigint; visitors: bigint }>>`
      SELECT COALESCE("label", 'інше') AS label, COUNT(*) AS clicks, COUNT(DISTINCT "visitorId") AS visitors
      FROM "SiteEvent"
      WHERE "type" = 'phone_click'
        AND "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY 1
      ORDER BY clicks DESC
    `,

    // Один прохід: кожен крок — окремий FILTER по тому самому набору
    // сесій періоду. «Відкрив оформлення» — це page_view на /checkout,
    // окремої події для нього ми не пишемо.
    prisma.$queryRaw<
      Array<{
        sessions: bigint;
        viewed: bigint;
        carted: bigint;
        checkout: bigint;
        ordered: bigint;
      }>
    >`
      SELECT
        COUNT(DISTINCT "sessionId")                                                AS sessions,
        COUNT(DISTINCT "sessionId") FILTER (WHERE "type" = 'product_view')         AS viewed,
        COUNT(DISTINCT "sessionId") FILTER (WHERE "type" = 'add_to_cart')          AS carted,
        COUNT(DISTINCT "sessionId") FILTER (WHERE "type" = 'page_view' AND "path" = '/checkout') AS checkout,
        COUNT(DISTINCT "sessionId") FILTER (WHERE "type" = 'order_placed')         AS ordered
      FROM "SiteEvent"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
    `,
  ]);

  const f = funnel[0];
  const n = (v: bigint | undefined) => Number(v ?? 0);
  const sessions = n(f?.sessions);

  // Частку рахуємо від початку воронки, а не від попереднього кроку:
  // «до кошика дійшло 8% візитів» читається однозначно, тоді як
  // ланцюжок відсотків від сусіда доводиться перемножувати в голові.
  const step = (value: number, label: string) => ({
    label,
    sessions: value,
    share: sessions > 0 ? (value / sessions) * 100 : 0,
  });

  return NextResponse.json({
    period: { from: fromDay, to: toDay },
    byType: byType.map((r) => ({
      type: r.type,
      label: TYPE_LABELS[r.type] ?? r.type,
      events: Number(r.events),
      visitors: Number(r.visitors),
    })),
    contacts: contacts.map((r) => ({
      label: CONTACT_LABELS[r.label] ?? r.label,
      clicks: Number(r.clicks),
      visitors: Number(r.visitors),
    })),
    funnel: [
      step(sessions, "Візити"),
      step(n(f?.viewed), "Відкрили товар"),
      step(n(f?.carted), "Поклали в кошик"),
      step(n(f?.checkout), "Відкрили оформлення"),
      step(n(f?.ordered), "Замовили"),
    ],
  });
}
