/**
 * Провалювання в SKU: наскільки широко пропрацьований асортимент по клієнтах.
 *
 * Без ?client — список клієнтів за період: скільки РІЗНИХ товарів купив кожен,
 * скільки документів і на яку суму. Саме тут видно різницю між клієнтом,
 * якому торговий продає 30 позицій, і тим, хто роками бере ті самі 3–4.
 *
 * З ?client=<id> — розгортання одного клієнта: перелік куплених товарів із
 * кількістю та сумами. Ці самі дані згодом піде читати ШІ-аналітика, щоб
 * радити, яких клієнтів розпрацьовувати.
 *
 * Джерело й фільтри — ті самі, що в основній аналітиці.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { parsePeriod } from "@/lib/analytics/period";
import { SOURCE_FILTER } from "@/lib/analytics/facts";

export const dynamic = "force-dynamic";

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
  const clientId = url.searchParams.get("client");

  // Торговий бачить лише своїх клієнтів — як і в основній аналітиці.
  const restrictToRep = isFullAccess ? repFilter : userId;

  const repCondition = restrictToRep
    ? Prisma.sql`AND s."salesRepId" = ${restrictToRep}`
    : Prisma.empty;
  const periodCondition = Prisma.sql`AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}`;

  // --- розгортання одного клієнта: його товари за період ---
  if (clientId) {
    const products = await prisma.$queryRaw<
      Array<{ name: string; code: string | null; brand: string | null; qty: number; amount: number; docs: number }>
    >`
      SELECT
        p.name,
        p.sku AS code,
        b.name AS brand,
        SUM(i.quantity)::float AS qty,
        SUM(i.quantity * i."sellingPrice")::float AS amount,
        COUNT(DISTINCT s.id)::int AS docs
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      WHERE ${SOURCE_FILTER}
        AND s."counterpartyId" = ${clientId}
        ${periodCondition}
        ${repCondition}
      GROUP BY p.id, p.name, p.sku, b.name
      ORDER BY amount DESC
    `;

    return NextResponse.json({ products });
  }

  // --- список клієнтів із шириною асортименту ---
  // mode() бере торгового, який найчастіше возить цього клієнта: без фільтра
  // торгового треба розуміти, чия це зона відповідальності.
  const clients = await prisma.$queryRaw<
    Array<{ id: string; name: string; sku: number; docs: number; lines: number; amount: number; repId: string | null }>
  >`
    SELECT
      c.id,
      c.name,
      COUNT(DISTINCT i."productId")::int AS sku,
      COUNT(DISTINCT s.id)::int AS docs,
      COUNT(*)::int AS lines,
      SUM(i.quantity * i."sellingPrice")::float AS amount,
      mode() WITHIN GROUP (ORDER BY s."salesRepId") AS "repId"
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    JOIN "Counterparty" c ON c.id = s."counterpartyId"
    WHERE ${SOURCE_FILTER}
      ${periodCondition}
      ${repCondition}
    GROUP BY c.id, c.name
    ORDER BY sku DESC, amount DESC
    LIMIT 500
  `;

  const repIds = Array.from(new Set(clients.map((c) => c.repId).filter((id): id is string => !!id)));
  const reps = repIds.length
    ? await prisma.user.findMany({ where: { id: { in: repIds } }, select: { id: true, name: true } })
    : [];
  const repNameById = new Map(reps.map((r) => [r.id, r.name]));

  return NextResponse.json({
    period: { days: period.days, from: period.fromDay, to: period.toDay },
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      sku: c.sku,
      docs: c.docs,
      linesPerDoc: c.docs > 0 ? c.lines / c.docs : 0,
      amount: c.amount,
      repName: c.repId ? (repNameById.get(c.repId) ?? null) : null,
    })),
  });
}
