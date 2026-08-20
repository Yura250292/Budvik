/**
 * Що дивляться і що з цього кладуть у кошик.
 *
 * Ключова колонка — конверсія перегляд→кошик. Товар із сотнею переглядів
 * і нулем додавань означає одне з трьох: ціна відлякує, немає в
 * наявності або фото/опис не переконують. Це і є привід зайнятися
 * карткою.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod } from "@/lib/analytics/period";

export const dynamic = "force-dynamic";

const LIMIT = 50;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const { from, to, fromDay, toDay } = parsePeriod(searchParams);

  /**
   * Один прохід по подіях замість двох запитів із наступним склеюванням:
   * FILTER рахує перегляди й додавання в кошик поруч, а LEFT JOIN на
   * Product підтягує назву. JOIN саме LEFT — товар могли прибрати з
   * каталогу після того, як його дивилися, і рядок не має зникати.
   */
  const rows = await prisma.$queryRaw<
    Array<{
      product_id: string;
      name: string | null;
      slug: string | null;
      price: unknown;
      views: bigint;
      viewers: bigint;
      carts: bigint;
    }>
  >`
    SELECT
      e."productId"                                         AS product_id,
      p."name"                                              AS name,
      p."slug"                                              AS slug,
      p."price"                                             AS price,
      COUNT(*) FILTER (WHERE e."type" = 'product_view')      AS views,
      COUNT(DISTINCT e."visitorId") FILTER (WHERE e."type" = 'product_view') AS viewers,
      COUNT(*) FILTER (WHERE e."type" = 'add_to_cart')       AS carts
    FROM "SiteEvent" e
    LEFT JOIN "Product" p ON p."id" = e."productId"
    WHERE e."productId" IS NOT NULL
      AND e."type" IN ('product_view', 'add_to_cart')
      AND e."createdAt" >= ${from} AND e."createdAt" <= ${to}
    GROUP BY 1, 2, 3, 4
    ORDER BY views DESC, carts DESC
    LIMIT ${LIMIT}
  `;

  return NextResponse.json({
    period: { from: fromDay, to: toDay },
    products: rows.map((r) => {
      const views = Number(r.views);
      const carts = Number(r.carts);
      return {
        productId: r.product_id,
        // Товар міг зникнути з каталогу — показуємо це прямо, а не
        // порожнім рядком у таблиці.
        name: r.name ?? "Товар видалено з каталогу",
        slug: r.slug,
        price: r.price != null ? Number(r.price) : null,
        views,
        viewers: Number(r.viewers),
        carts,
        conversion: views > 0 ? (carts / views) * 100 : 0,
      };
    }),
  });
}
