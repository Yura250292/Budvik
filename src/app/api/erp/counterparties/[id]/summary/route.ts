import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const counterparty = await prisma.counterparty.findUnique({
    where: { id },
    select: {
      id: true, name: true, code: true, type: true, phone: true, email: true, address: true, contactPerson: true,
      receivableBalance: true, balanceSyncedAt: true,
      // Пін на карті: картка показує, чи точка вже уточнена, і дає
      // торговому виправити її — геокодер здебільшого влучає лише в місто.
      deliveryLat: true, deliveryLng: true, geoSource: true,
    },
  });

  if (!counterparty) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }

  // Борг беремо з балансу взаєморозрахунків 1С, а не з несплачених
  // рахунків: рахунки тут — контейнери, які apply-payments створює вже
  // оплаченими, тож їхній залишок завжди ~0 і показував би нульовий борг.
  // Регістр 1С оновлюється кожним циклом обміну, тому після проведення
  // ПКО ця сума падає протягом кількох хвилин.
  const { receivableBalance, balanceSyncedAt, ...counterpartyInfo } = counterparty;
  const totalDebt = receivableBalance ?? 0;

  // Оплати клієнта — насамперед ПКО з 1С. Номер ордера лежить у notes.
  const payments = await prisma.payment.findMany({
    where: { invoice: { counterpartyId: id } },
    select: { id: true, amount: true, method: true, notes: true, paidAt: true, source: true, createdAt: true },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take: 10,
  });

  // Recent sales documents
  // docType ORDER: реалізації з 1С лежать у тій самій таблиці, і без фільтра
  // клієнт бачив би кожну свою покупку двічі.
  const whereDoc: Record<string, unknown> = { counterpartyId: id, docType: "ORDER" };
  if (session.user.role === "SALES") {
    whereDoc.salesRepId = session.user.id;
  }

  const recentSales = await prisma.salesDocument.findMany({
    where: whereDoc,
    select: {
      id: true, number: true, status: true, totalAmount: true, profitAmount: true, createdAt: true,
      salesRep: { select: { name: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          sellingPrice: true,
          product: { select: { id: true, name: true, image: true, sku: true } },
        },
        take: 5,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Top products for this client (most frequently ordered)
  const topProducts = await prisma.salesDocumentItem.groupBy({
    by: ["productId"],
    where: {
      salesDocument: {
        counterpartyId: id,
        docType: "ORDER",
        status: "CONFIRMED",
        ...(session.user.role === "SALES" ? { salesRepId: session.user.id } : {}),
      },
    },
    _sum: { quantity: true },
    _count: { productId: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: 10,
  });

  let topProductsWithDetails: any[] = [];
  if (topProducts.length > 0) {
    const productIds = topProducts.map((tp) => tp.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, image: true, sku: true, price: true, stock: true },
    });
    topProductsWithDetails = topProducts.map((tp) => {
      const product = products.find((p) => p.id === tp.productId);
      return {
        product,
        totalQuantity: tp._sum.quantity || 0,
        orderCount: tp._count.productId || 0,
      };
    }).filter((tp) => tp.product);
  }

  // Повернення від цього клієнта. Окремим блоком, а не разом із продажами:
  // вище фільтр docType ORDER (щоб покупка не двоїлася), і повернення туди
  // не потрапляють у принципі. Суми в базі від'ємні — розвертаємо для показу.
  const returnDocs = await prisma.salesDocument.findMany({
    where: {
      counterpartyId: id,
      docType: "RETURN",
      status: "CONFIRMED",
      ...(session.user.role === "SALES" ? { salesRepId: session.user.id } : {}),
    },
    select: {
      id: true, number: true, totalAmount: true, createdAt: true,
      salesRep: { select: { name: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          sellingPrice: true,
          product: { select: { id: true, name: true, image: true, sku: true } },
        },
        take: 5,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const returns = returnDocs.map((d) => ({
    ...d,
    totalAmount: -d.totalAmount,
    items: d.items.map((i) => ({ ...i, quantity: -i.quantity })),
  }));

  // Stats
  const confirmedSales = recentSales.filter((s) => s.status === "CONFIRMED");
  const totalSalesAmount = confirmedSales.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalReturned = returns.reduce((sum, r) => sum + r.totalAmount, 0);

  return NextResponse.json({
    counterparty: counterpartyInfo,
    debt: { total: totalDebt, syncedAt: balanceSyncedAt, invoices: [] },
    payments,
    sales: { items: recentSales, totalAmount: totalSalesAmount, count: confirmedSales.length },
    returns: { items: returns, totalAmount: totalReturned, count: returns.length },
    topProducts: topProductsWithDetails,
  });
}
