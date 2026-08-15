/**
 * Аналітика продажів із 1С: хто скільки продав, яких брендів, кому.
 *
 * Усе рахується SQL-запитами, без моделі. Питання на кшталт «скільки продав
 * Кулик за жовтень» або «топ брендів по торговому» мають точну відповідь у
 * базі — просити її в моделі означало б платити за кожен перегляд і отримати
 * правдоподібне число замість правильного.
 *
 * Джерело — РЕАЛІЗАЦІЇ з 1С (docType REALIZATION): фактично відвантажене, а
 * не замовлене. Точні умови й чому саме такі — у SOURCE_FILTER
 * (src/lib/analytics/facts.ts), звідки вони й беруться.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { parsePeriod } from "@/lib/analytics/period";
import { SOURCE_FILTER, SALES_ONLY } from "@/lib/analytics/facts";

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

  // Спільна умова періоду для сирих запитів — щоб межі не розʼїхалися між ними.
  const periodCondition = Prisma.sql`AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}`;

  const [byRep, byBrand, totals, timeline, topProducts, topClients, skuTotals, skuByRep] = await Promise.all([
    // --- по торгових ---
    // Сирий SQL, а не groupBy: потрібен FILTER, щоб повернення віднімалися
    // від суми, але не рахувались як ще один проданий документ.
    prisma.$queryRaw<
      Array<{
        salesRepId: string | null;
        docs: number;
        amount: number;
        returns: number;
        profit: number;
        costedAmount: number;
      }>
    >`
      SELECT
        s."salesRepId" AS "salesRepId",
        COUNT(*) FILTER (WHERE ${SALES_ONLY})::int AS docs,
        COALESCE(SUM(s."totalAmount"), 0)::float AS amount,
        COALESCE(-SUM(s."totalAmount") FILTER (WHERE s."docType" = 'RETURN'), 0)::float AS returns,
        -- Вал рахується з ПОЗИЦІЙ, а не з SalesDocument.profitAmount: там
        -- підсумок по документу, а нам потрібна ще й база, від якої він
        -- рахувався. Без неї «вал 15%» неможливо відрізнити від «вал 15%,
        -- але собівартість відома лише для третини рядків».
        COALESCE((
          SELECT SUM((i."sellingPrice" - i."purchasePrice") * i.quantity)
          FROM "SalesDocumentItem" i
          JOIN "SalesDocument" d ON d.id = i."salesDocumentId"
          WHERE d."salesRepId" = s."salesRepId"
            AND d."externalId" IS NOT NULL AND d.status = 'CONFIRMED'
            AND d."docType" IN ('REALIZATION', 'RETURN')
            AND i."purchasePrice" > 0
            AND d."createdAt" >= ${period.from} AND d."createdAt" <= ${period.to}
        ), 0)::float AS profit,
        -- Виручка тих самих рядків: знаменник для чесного відсотка.
        COALESCE((
          SELECT SUM(i."sellingPrice" * i.quantity)
          FROM "SalesDocumentItem" i
          JOIN "SalesDocument" d ON d.id = i."salesDocumentId"
          WHERE d."salesRepId" = s."salesRepId"
            AND d."externalId" IS NOT NULL AND d.status = 'CONFIRMED'
            AND d."docType" IN ('REALIZATION', 'RETURN')
            AND i."purchasePrice" > 0
            AND d."createdAt" >= ${period.from} AND d."createdAt" <= ${period.to}
        ), 0)::float AS "costedAmount"
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
        ${periodCondition}
        ${repCondition}
      GROUP BY s."salesRepId"
    `,

    // --- по брендах ---
    // Підсумок береться з ПОЗИЦІЙ, а не документів: один документ містить
    // товари різних брендів, тож totalAmount документа розподілити не можна.
    prisma.$queryRaw<Array<{ brand: string | null; color: string | null; qty: number; amount: number; docs: number }>>`
      SELECT
        b.name AS brand,
        b.color AS color,
        SUM(i.quantity)::float AS qty,
        SUM(i.quantity * i."sellingPrice")::float AS amount,
        COUNT(DISTINCT s.id) FILTER (WHERE ${SALES_ONLY})::int AS docs
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      WHERE ${SOURCE_FILTER}
        ${periodCondition}
        ${repCondition}
      GROUP BY b.name, b.color
      ORDER BY amount DESC NULLS LAST
      LIMIT 25
    `,

    // --- загальні підсумки ---
    // Середній чек рахуємо як нетто-оборот на кількість ПРОДАЖІВ: інакше
    // повернення потрапило б у знаменник і занизило чек двічі.
    prisma.$queryRaw<Array<{ docs: number; amount: number; average: number; returns: number }>>`
      SELECT
        COUNT(*) FILTER (WHERE ${SALES_ONLY})::int AS docs,
        COALESCE(SUM(s."totalAmount"), 0)::float AS amount,
        COALESCE(
          SUM(s."totalAmount") / NULLIF(COUNT(*) FILTER (WHERE ${SALES_ONLY}), 0),
          0
        )::float AS average,
        COALESCE(-SUM(s."totalAmount") FILTER (WHERE s."docType" = 'RETURN'), 0)::float AS returns
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
        ${periodCondition}
        ${repCondition}
    `,

    // --- динаміка по днях ---
    // AT TIME ZONE 'Europe/Kyiv' обовʼязково: без нього документ, проведений
    // о 23:30 за Києвом, потрапляв у наступний день (UTC ще 20:30/21:30).
    prisma.$queryRaw<Array<{ day: string; docs: number; amount: number }>>`
      SELECT
        to_char(date_trunc('day', s."createdAt" AT TIME ZONE 'Europe/Kyiv'), 'YYYY-MM-DD') AS day,
        COUNT(*) FILTER (WHERE ${SALES_ONLY})::int AS docs,
        SUM(s."totalAmount")::float AS amount
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
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
      WHERE ${SOURCE_FILTER}
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
        COUNT(*) FILTER (WHERE ${SALES_ONLY})::int AS docs,
        SUM(s."totalAmount")::float AS amount
      FROM "SalesDocument" s
      JOIN "Counterparty" c ON c.id = s."counterpartyId"
      WHERE ${SOURCE_FILTER}
        ${periodCondition}
        ${repCondition}
      GROUP BY c.id, c.name
      ORDER BY amount DESC
      LIMIT 20
    `,

    // --- SKU: скільки різних товарів продано за період ---
    // Показник пропрацювання асортименту: оборот можна зробити й на трьох
    // позиціях, а SKU показує, наскільки широко торговий продає каталог.
    prisma.$queryRaw<Array<{ sku: number; linesPerDoc: number }>>`
      SELECT
        COUNT(DISTINCT i."productId") FILTER (WHERE ${SALES_ONLY})::int AS sku,
        COALESCE(
          COUNT(*) FILTER (WHERE ${SALES_ONLY})::float
            / NULLIF(COUNT(DISTINCT s.id) FILTER (WHERE ${SALES_ONLY}), 0),
          0
        ) AS "linesPerDoc"
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE ${SOURCE_FILTER}
        ${periodCondition}
        ${repCondition}
    `,

    // --- SKU по торгових ---
    // Окремим запитом, бо COUNT(DISTINCT) по торгових не складається в
    // загальний підсумок: той самий товар продають кілька торгових.
    prisma.$queryRaw<Array<{ repId: string | null; sku: number }>>`
      SELECT
        s."salesRepId" AS "repId",
        COUNT(DISTINCT i."productId") FILTER (WHERE ${SALES_ONLY})::int AS sku
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE ${SOURCE_FILTER}
        ${periodCondition}
        ${repCondition}
      GROUP BY s."salesRepId"
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
  const skuByRepId = new Map(skuByRep.filter((r) => r.repId).map((r) => [r.repId!, r.sku]));

  return NextResponse.json({
    period: {
      days: period.days,
      from: period.fromDay,
      to: period.toDay,
      // Початок підтягнули до межі історії — фронт мусить це підписати,
      // інакше обрізаний період читається як «стільки й продали».
      clamped: period.clamped,
    },
    scope: isFullAccess ? (repFilter ? "single" : "all") : "own",
    totals: {
      docs: totals[0]?.docs ?? 0,
      amount: totals[0]?.amount ?? 0,
      average: totals[0]?.average ?? 0,
      returns: totals[0]?.returns ?? 0,
      sku: skuTotals[0]?.sku ?? 0,
      linesPerDoc: skuTotals[0]?.linesPerDoc ?? 0,
    },
    byRep: byRep
      .filter((r) => r.salesRepId)
      .map((r) => ({
        id: r.salesRepId,
        name: repNameById.get(r.salesRepId!) ?? "—",
        docs: r.docs,
        amount: r.amount,
        returns: r.returns,
        profit: r.profit,
        costedAmount: r.costedAmount,
        sku: skuByRepId.get(r.salesRepId!) ?? 0,
      }))
      .sort((a, b) => b.amount - a.amount),
    byBrand: byBrand.map((b) => ({
      brand: b.brand ?? "Без бренду",
      color: b.color,
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
