import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getNextDocumentNumber } from "@/lib/erp/document-numbers";
import { getLatestPurchasePrice } from "@/lib/erp/sales";
import { kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { packQtyOf, roundUpToPack } from "@/lib/pack-qty";
import { findReplacements } from "@/lib/erp/superseded";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES", "WAREHOUSE", "DRIVER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
  if (session.user.role === "SALES") {
    where.salesRepId = session.user.id;
  }

  // WAREHOUSE sees only relevant statuses
  if (session.user.role === "WAREHOUSE" && !status) {
    where.status = { in: ["CONFIRMED", "PACKING", "IN_TRANSIT"] };
  }

  // DRIVER sees only dispatched/delivered
  if (session.user.role === "DRIVER" && !status) {
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
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { counterpartyId, salesRepId, items, notes } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Додайте товари" }, { status: 400 });
  }

  const number = await getNextDocumentNumber("SD");

  // Кратність пачки: беремо з бази, бо клієнт міг надіслати некратну кількість.
  const packs = new Map(
    (
      await prisma.product.findMany({
        where: { id: { in: items.map((i: { productId: string }) => i.productId) } },
        select: { id: true, packQty: true },
      })
    ).map((p) => [p.id, packQtyOf(p)])
  );

  // Auto-fill purchase prices for items that don't have them
  const processedItems = await Promise.all(
    items.map(async (item: { productId: string; quantity: number; sellingPrice: number; purchasePrice?: number; discountPercent?: number }) => ({
      productId: item.productId,
      quantity: roundUpToPack(item.quantity, packs.get(item.productId) ?? 1),
      sellingPrice: item.sellingPrice,
      purchasePrice: item.purchasePrice || (await getLatestPurchasePrice(item.productId)),
      discountPercent: item.discountPercent || 0,
    }))
  );

  const totalAmount = processedItems.reduce(
    (sum, item) => sum + item.quantity * item.sellingPrice,
    0
  );

  // Create document + reservations in a transaction
  const doc = await prisma.$transaction(async (tx) => {
    // Check stock availability (stock minus existing reservations)
    for (const item of processedItems) {
      const product = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true, stock: true } });
      if (!product) throw new Error(`Товар не знайдено: ${item.productId}`);

      const reserved = await tx.stockReservation.aggregate({
        where: { productId: item.productId },
        _sum: { quantity: true },
      });
      const available = product.stock - (reserved._sum.quantity || 0);
      if (available < item.quantity) {
        throw new Error(`Недостатньо товару "${product.name}" (доступно: ${available}, на складі: ${product.stock}, резерв: ${reserved._sum.quantity || 0})`);
      }
    }

    const created = await tx.salesDocument.create({
      data: {
        number,
        counterpartyId: counterpartyId || null,
        salesRepId: salesRepId || session.user.id,
        totalAmount,
        notes: notes || null,
        createdById: session.user.id,
        items: { create: processedItems },
      },
    });

    // Create stock reservations
    await tx.stockReservation.createMany({
      data: processedItems.map((item) => ({
        productId: item.productId,
        salesDocumentId: created.id,
        quantity: item.quantity,
      })),
    });

    return tx.salesDocument.findUnique({
      where: { id: created.id },
      include: {
        counterparty: { select: { id: true, name: true } },
        salesRep: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
  });

  return NextResponse.json(doc, { status: 201 });
}
