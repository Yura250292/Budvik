import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Картка товару для панелі деталей у закупівлях.
 *
 * Опис у базі — це HTML, зіскоблений з сайту постачальника (теги <h2>,
 * <div class>, &mdash; тощо). Рендерити його як розмітку в адмінці означало б
 * пустити чужий HTML у сторінку, тож тут він перетворюється на чистий текст.
 *
 * Технічні характеристики (powerWatts, rpm…) не віддаємо: у базі вони
 * заповнені рівно в 0 товарів, і порожній блок лише займав би місце.
 */

/** HTML з сайту постачальника → читабельний текст. */
function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id обовʼязковий" }, { status: 400 });

  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true, sku: true, name: true, slug: true, description: true, image: true,
      price: true, wholesalePrice: true, stock: true,
      brand: { select: { name: true } },
      category: { select: { name: true } },
    },
  });
  if (!product) return NextResponse.json({ error: "Товар не знайдено" }, { status: 404 });

  // Останні рухи — щоб було видно, чи попит рівний, чи це один сплеск.
  const recent = await prisma.$queryRaw<Array<{ month: string; sold: bigint }>>`
    SELECT to_char(date_trunc('month', d."createdAt"), 'YYYY-MM') AS month,
           SUM(i.quantity)::bigint AS sold
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" d ON d.id = i."salesDocumentId"
    WHERE i."productId" = ${id}
      AND d."docType" IN ('REALIZATION','RETURN')
      AND d.status = 'CONFIRMED'
      AND d."createdAt" >= NOW() - INTERVAL '6 months'
    GROUP BY 1 ORDER BY 1
  `;

  // Хто брав останнім часом — закупівельнику це підказує, чи товар «під клієнта».
  const buyers = await prisma.$queryRaw<Array<{ name: string; sold: bigint; last: Date }>>`
    SELECT COALESCE(c.name, '—') AS name, SUM(i.quantity)::bigint AS sold, MAX(d."createdAt") AS last
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" d ON d.id = i."salesDocumentId"
    LEFT JOIN "Counterparty" c ON c.id = d."counterpartyId"
    WHERE i."productId" = ${id}
      AND d."docType" = 'REALIZATION'
      AND d.status = 'CONFIRMED'
      AND d."createdAt" >= NOW() - INTERVAL '6 months'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 5
  `;

  const text = product.description ? htmlToText(product.description) : "";
  return NextResponse.json({
    product: {
      ...product,
      description: text.slice(0, 4000),
      brandName: product.brand?.name ?? null,
      categoryName: product.category?.name ?? null,
    },
    months: recent.map((r) => ({ month: r.month, sold: Number(r.sold) })),
    buyers: buyers.map((b) => ({ name: b.name, sold: Number(b.sold), last: b.last })),
  });
}
