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
    select: { id: true, name: true, code: true, type: true, phone: true, email: true, address: true, contactPerson: true },
  });

  if (!counterparty) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }

  // Unpaid invoices (debt)
  const invoices = await prisma.invoice.findMany({
    where: { counterpartyId: id, paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
    select: { id: true, number: true, totalAmount: true, paidAmount: true, paymentStatus: true, dueDate: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const totalDebt = invoices.reduce((sum, inv) => sum + (inv.totalAmount - inv.paidAmount), 0);

  // Recent sales documents
  const whereDoc: Record<string, unknown> = { counterpartyId: id };
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

  // Stats
  const confirmedSales = recentSales.filter((s) => s.status === "CONFIRMED");
  const totalSalesAmount = confirmedSales.reduce((sum, s) => sum + s.totalAmount, 0);

  return NextResponse.json({
    counterparty,
    debt: { total: totalDebt, invoices },
    sales: { items: recentSales, totalAmount: totalSalesAmount, count: confirmedSales.length },
    topProducts: topProductsWithDetails,
  });
}
