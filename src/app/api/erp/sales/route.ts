import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { findReplacements } from "@/lib/erp/superseded";
import { createSalesDocument } from "@/lib/orders/create-sales-document";
import { requireRoles, STAFF_ROLES, CABINET_ROLES } from "@/lib/app/identity";

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, STAFF_ROLES);
  if (!auth.ok) return auth.response;
  const me = auth.me;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const salesRepId = searchParams.get("salesRepId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  // Список ERP — це замовлення: саме їх збирають, комплектують і везуть.
  // Реалізації з 1С лежать у тій самій таблиці, але в роботі складу й водія
  // не беруть участі (це вже факт відвантаження).
  const where: Record<string, unknown> = { docType: "ORDER" };
  if (status) where.status = status;
  if (salesRepId) where.salesRepId = salesRepId;

  // Межі доби — київські. Наївний new Date("2026-08-10") дав би опівніч
  // UTC, і документ, оформлений о 01:30 ночі, випадав би з «сьогодні»
  // (той самий баг уже фіксили для звітів — див. src/lib/date/kyiv.ts).
  if (from || to) {
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (from) createdAt.gte = kyivDayStart(from);
    if (to) createdAt.lte = kyivDayEnd(to);
    where.createdAt = createdAt;
  }

  // SALES role can only see their own documents
  if (me.role === "SALES") {
    where.salesRepId = me.userId;
  }

  // WAREHOUSE sees only relevant statuses
  if (me.role === "WAREHOUSE" && !status) {
    where.status = { in: ["CONFIRMED", "PACKING", "IN_TRANSIT"] };
  }

  // DRIVER sees only dispatched/delivered
  if (me.role === "DRIVER" && !status) {
    where.status = { in: ["IN_TRANSIT", "DELIVERED"] };
  }

  const docs = await prisma.salesDocument.findMany({
    where,
    include: {
      counterparty: { select: { id: true, name: true } },
      salesRep: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
    // Стеля на випадок запиту без періоду («Всі»): в окремих торгових
    // історія на тисячі документів, і віддавати її цілком у телефон
    // немає сенсу — далі першого екрана ніхто не гортає.
    take: 300,
  });

  // Чернетка з 1С, яку офіс замінив власним документом, лишається в списку,
  // але з міткою: два документи на одну поставку без пояснення читаються як
  // задвоєння, а з міткою — як «замовляли стільки, поїхало стільки».
  const replacements = await findReplacements(docs);
  if (replacements.size === 0) return NextResponse.json(docs);

  return NextResponse.json(
    docs.map((d) => {
      const replacedBy = replacements.get(d.id);
      return replacedBy ? { ...d, replacedBy } : d;
    })
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireRoles(req, CABINET_ROLES);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const result = await createSalesDocument(body, {
    userId: auth.me.userId,
    role: auth.me.role,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.doc, { status: 201 });
}
