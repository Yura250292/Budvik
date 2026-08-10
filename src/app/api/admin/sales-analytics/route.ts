/**
 * Аналітика продажів із 1С: хто скільки продав, яких брендів, кому.
 *
 * Усе рахується SQL-запитами, без моделі. Питання на кшталт «скільки продав
 * Кулик за жовтень» або «топ брендів по торговому» мають точну відповідь у
 * базі — просити її в моделі означало б платити за кожен перегляд і отримати
 * правдоподібне число замість правильного.
 *
 * Джерело — SalesDocument із externalId (тобто прийшли з 1С; документи,
 * створені вручну на сайті, у звіт не потрапляють) і лише проведені
 * (status CONFIRMED): непроведене замовлення ще не пішло на склад.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/** Ролі, яким видно чужі продажі. Торговий бачить лише свої. */
const FULL_ACCESS_ROLES = new Set(["ADMIN", "MANAGER"]);

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const role = (session.user as { role?: string }).role ?? "CLIENT";
  const userId = (session.user as { id?: string }).id;
  const isFullAccess = FULL_ACCESS_ROLES.has(role);

  if (!isFullAccess && role !== "SALES") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const url = new URL(req.url);
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10)));
  const repFilter = url.searchParams.get("rep");

  const from = new Date();
  from.setDate(from.getDate() - days);

  // Торговий бачить лише свої продажі — незалежно від того, що прийшло в
  // параметрах: інакше будь-хто підставив би чужий id у запит.
  const restrictToRep = isFullAccess ? repFilter : userId;

  // Спільний фільтр для сирих запитів. Prisma.sql, а не інтерполяція рядків:
  // значення лишається параметром запиту.
  const repCondition = restrictToRep
    ? Prisma.sql`AND s."salesRepId" = ${restrictToRep}`
    : Prisma.empty;

  const where = {
    externalId: { not: null },
    status: "CONFIRMED" as const,
    createdAt: { gte: from },
    ...(restrictToRep ? { salesRepId: restrictToRep } : {}),
  };

  const [byRep, byBrand, totals, timeline, topProducts, topClients] = await Promise.all([
    // --- по торгових ---
    prisma.salesDocument.groupBy({
      by: ["salesRepId"],
      where,
      _count: { id: true },
      _sum: { totalAmount: true },
    }),

    // --- по брендах ---
    // Підсумок береться з ПОЗИЦІЙ, а не документів: один документ містить
    // товари різних брендів, тож totalAmount документа розподілити не можна.
    prisma.$queryRaw<Array<{ brand: string | null; qty: number; amount: number; docs: number }>>`
      SELECT
        b.name AS brand,
        SUM(i.quantity)::float AS qty,
        SUM(i.quantity * i."sellingPrice")::float AS amount,
        COUNT(DISTINCT s.id)::int AS docs
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      WHERE s."externalId" IS NOT NULL
        AND s.status = 'CONFIRMED'
        AND s."createdAt" >= ${from}
        ${repCondition}
      GROUP BY b.name
      ORDER BY amount DESC NULLS LAST
      LIMIT 25
    `,

    // --- загальні підсумки ---
    prisma.salesDocument.aggregate({
      where,
      _count: { id: true },
      _sum: { totalAmount: true },
      _avg: { totalAmount: true },
    }),

    // --- динаміка по днях ---
    prisma.$queryRaw<Array<{ day: Date; docs: number; amount: number }>>`
      SELECT
        date_trunc('day', s."createdAt") AS day,
        COUNT(*)::int AS docs,
        SUM(s."totalAmount")::float AS amount
      FROM "SalesDocument" s
      WHERE s."externalId" IS NOT NULL
        AND s.status = 'CONFIRMED'
        AND s."createdAt" >= ${from}
        ${repCondition}
      GROUP BY 1
      ORDER BY 1
    `,

    // --- топ товарів ---
    prisma.$queryRaw<Array<{ name: string; sku: string; qty: number; amount: number }>>`
      SELECT
        p.name,
        p.sku,
        SUM(i.quantity)::float AS qty,
        SUM(i.quantity * i."sellingPrice")::float AS amount
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      WHERE s."externalId" IS NOT NULL
        AND s.status = 'CONFIRMED'
        AND s."createdAt" >= ${from}
        ${repCondition}
      GROUP BY p.id, p.name, p.sku
      ORDER BY amount DESC
      LIMIT 20
    `,

    // --- топ клієнтів ---
    prisma.$queryRaw<Array<{ name: string; docs: number; amount: number }>>`
      SELECT
        c.name,
        COUNT(*)::int AS docs,
        SUM(s."totalAmount")::float AS amount
      FROM "SalesDocument" s
      JOIN "Counterparty" c ON c.id = s."counterpartyId"
      WHERE s."externalId" IS NOT NULL
        AND s.status = 'CONFIRMED'
        AND s."createdAt" >= ${from}
        ${repCondition}
      GROUP BY c.id, c.name
      ORDER BY amount DESC
      LIMIT 20
    `,
  ]);

  // Імена торгових окремим запитом: groupBy не вміє join.
  const repIds = byRep.map((r) => r.salesRepId).filter((id): id is string => !!id);
  const reps = repIds.length
    ? await prisma.user.findMany({
        where: { id: { in: repIds } },
        select: { id: true, name: true },
      })
    : [];
  const repNameById = new Map(reps.map((r) => [r.id, r.name]));

  return NextResponse.json({
    period: { days, from: from.toISOString() },
    scope: isFullAccess ? (repFilter ? "single" : "all") : "own",
    totals: {
      docs: totals._count.id,
      amount: totals._sum.totalAmount ?? 0,
      average: totals._avg.totalAmount ?? 0,
    },
    byRep: byRep
      .filter((r) => r.salesRepId)
      .map((r) => ({
        id: r.salesRepId,
        name: repNameById.get(r.salesRepId!) ?? "—",
        docs: r._count.id,
        amount: r._sum.totalAmount ?? 0,
      }))
      .sort((a, b) => b.amount - a.amount),
    byBrand: byBrand.map((b) => ({
      brand: b.brand ?? "Без бренду",
      qty: b.qty,
      amount: b.amount,
      docs: b.docs,
    })),
    timeline: timeline.map((t) => ({
      day: t.day.toISOString().slice(0, 10),
      docs: t.docs,
      amount: t.amount,
    })),
    topProducts,
    topClients,
  });
}
