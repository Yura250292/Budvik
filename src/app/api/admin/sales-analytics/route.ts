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
import { parsePeriod } from "@/lib/analytics/period";

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
  const period = parsePeriod(url.searchParams);
  const { from, to } = period;
  const repFilter = url.searchParams.get("rep");

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
    createdAt: { gte: from, lte: to },
    ...(restrictToRep ? { salesRepId: restrictToRep } : {}),
  };

  // Спільна умова періоду для сирих запитів — щоб межі не розʼїхалися між ними.
  const periodCondition = Prisma.sql`AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}`;

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
        ${periodCondition}
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
    // AT TIME ZONE 'Europe/Kyiv' обовʼязково: без нього документ, проведений
    // о 23:30 за Києвом, потрапляв у наступний день (UTC ще 20:30/21:30).
    prisma.$queryRaw<Array<{ day: string; docs: number; amount: number }>>`
      SELECT
        to_char(date_trunc('day', s."createdAt" AT TIME ZONE 'Europe/Kyiv'), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS docs,
        SUM(s."totalAmount")::float AS amount
      FROM "SalesDocument" s
      WHERE s."externalId" IS NOT NULL
        AND s.status = 'CONFIRMED'
        ${periodCondition}
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
        ${periodCondition}
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
        ${periodCondition}
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
    period: {
      days: period.days,
      from: period.fromDay,
      to: period.toDay,
    },
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
      day: t.day,
      docs: t.docs,
      amount: t.amount,
    })),
    topProducts,
    topClients,
  });
}
