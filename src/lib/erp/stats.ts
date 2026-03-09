import { prisma } from "@/lib/prisma";

export async function getSalesStats(from?: string, to?: string) {
  const dateFilter: Record<string, unknown> = {};
  if (from || to) {
    dateFilter.confirmedAt = {
      ...(from && { gte: new Date(from) }),
      ...(to && { lte: new Date(to + "T23:59:59") }),
    };
  }

  const docs = await prisma.salesDocument.findMany({
    where: { status: "CONFIRMED", ...dateFilter },
    include: {
      items: {
        include: { product: { select: { name: true, categoryId: true, category: { select: { name: true } } } } },
      },
      salesRep: { select: { id: true, name: true } },
      counterparty: { select: { name: true } },
    },
    orderBy: { confirmedAt: "desc" },
  });

  // Totals
  const totalSales = docs.reduce((s, d) => s + d.totalAmount, 0);
  const totalProfit = docs.reduce((s, d) => s + d.profitAmount, 0);
  const totalDocs = docs.length;
  const avgMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

  // By brand
  const brandStats = new Map<string, { sales: number; profit: number; quantity: number }>();
  // By category
  const categoryStats = new Map<string, { sales: number; profit: number; quantity: number }>();
  // By sales rep
  const repStats = new Map<string, { name: string; sales: number; profit: number; docs: number }>();
  // Top products
  const productStats = new Map<string, { name: string; sales: number; profit: number; quantity: number }>();
  // By month
  const monthlyStats = new Map<string, { sales: number; profit: number; docs: number }>();

  for (const doc of docs) {
    // Monthly
    const month = doc.confirmedAt ? new Date(doc.confirmedAt).toISOString().slice(0, 7) : "unknown";
    const mStats = monthlyStats.get(month) || { sales: 0, profit: 0, docs: 0 };
    mStats.sales += doc.totalAmount;
    mStats.profit += doc.profitAmount;
    mStats.docs += 1;
    monthlyStats.set(month, mStats);

    // By rep
    if (doc.salesRep) {
      const rStats = repStats.get(doc.salesRep.id) || { name: doc.salesRep.name, sales: 0, profit: 0, docs: 0 };
      rStats.sales += doc.totalAmount;
      rStats.profit += doc.profitAmount;
      rStats.docs += 1;
      repStats.set(doc.salesRep.id, rStats);
    }

    for (const item of doc.items) {
      const itemSales = item.sellingPrice * item.quantity;
      const itemProfit = (item.sellingPrice - item.purchasePrice) * item.quantity;

      // Extract brand from product name (simple approach)
      const productName = item.product.name;
      const words = productName.replace(/\([^)]*\)/g, "").trim().split(/\s+/);
      let brand = "ІНШЕ";
      for (let i = words.length - 1; i >= 0; i--) {
        if (words[i].length >= 2 && words[i] === words[i].toUpperCase() && /^[A-ZА-ЯІЇЄҐ]/.test(words[i])) {
          brand = words[i];
          break;
        }
      }
      if (brand === "ІНШЕ" && words.length > 0 && /^[A-Z][a-z]/.test(words[0]) && words[0].length >= 3) {
        brand = words[0];
      }

      const bStats = brandStats.get(brand) || { sales: 0, profit: 0, quantity: 0 };
      bStats.sales += itemSales;
      bStats.profit += itemProfit;
      bStats.quantity += item.quantity;
      brandStats.set(brand, bStats);

      // Category
      const catName = item.product.category?.name || "Без категорії";
      const cStats = categoryStats.get(catName) || { sales: 0, profit: 0, quantity: 0 };
      cStats.sales += itemSales;
      cStats.profit += itemProfit;
      cStats.quantity += item.quantity;
      categoryStats.set(catName, cStats);

      // Product
      const pStats = productStats.get(item.productId) || { name: productName, sales: 0, profit: 0, quantity: 0 };
      pStats.sales += itemSales;
      pStats.profit += itemProfit;
      pStats.quantity += item.quantity;
      productStats.set(item.productId, pStats);
    }
  }

  return {
    totals: { totalSales, totalProfit, totalDocs, avgMargin: Math.round(avgMargin * 10) / 10 },
    byBrand: Array.from(brandStats.entries())
      .map(([brand, data]) => ({ brand, ...data, margin: data.sales > 0 ? Math.round((data.profit / data.sales) * 1000) / 10 : 0 }))
      .sort((a, b) => b.sales - a.sales),
    byCategory: Array.from(categoryStats.entries())
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.sales - a.sales),
    byRep: Array.from(repStats.entries())
      .map(([id, data]) => ({ id, ...data, margin: data.sales > 0 ? Math.round((data.profit / data.sales) * 1000) / 10 : 0 }))
      .sort((a, b) => b.sales - a.sales),
    topProducts: Array.from(productStats.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 20),
    monthly: Array.from(monthlyStats.entries())
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export async function getPurchaseStats(from?: string, to?: string) {
  const dateFilter: Record<string, unknown> = {};
  if (from || to) {
    dateFilter.confirmedAt = {
      ...(from && { gte: new Date(from) }),
      ...(to && { lte: new Date(to + "T23:59:59") }),
    };
  }

  const orders = await prisma.purchaseOrder.findMany({
    where: { status: "CONFIRMED", ...dateFilter },
    include: {
      supplier: { select: { id: true, name: true } },
      items: true,
    },
  });

  const totalPurchases = orders.reduce((s, o) => s + o.totalAmount, 0);
  const totalDocs = orders.length;

  // By supplier
  const supplierStats = new Map<string, { name: string; total: number; docs: number }>();
  for (const order of orders) {
    const sStats = supplierStats.get(order.supplierId) || { name: order.supplier.name, total: 0, docs: 0 };
    sStats.total += order.totalAmount;
    sStats.docs += 1;
    supplierStats.set(order.supplierId, sStats);
  }

  return {
    totals: { totalPurchases, totalDocs },
    bySupplier: Array.from(supplierStats.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.total - a.total),
  };
}

export async function getFinancialReport(from?: string, to?: string) {
  const dateFilter = (field: string) => {
    const filter: Record<string, unknown> = {};
    if (from || to) {
      filter[field] = {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(to + "T23:59:59") }),
      };
    }
    return filter;
  };

  // Revenue (confirmed sales)
  const sales = await prisma.salesDocument.aggregate({
    where: { status: "CONFIRMED", ...dateFilter("confirmedAt") },
    _sum: { totalAmount: true, profitAmount: true },
    _count: true,
  });

  // Purchases (confirmed)
  const purchases = await prisma.purchaseOrder.aggregate({
    where: { status: "CONFIRMED", ...dateFilter("confirmedAt") },
    _sum: { totalAmount: true },
    _count: true,
  });

  // Receivables (unpaid/partial invoices)
  const receivables = await prisma.invoice.findMany({
    where: { paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
    include: { counterparty: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const totalReceivable = receivables.reduce((s, inv) => s + (inv.totalAmount - inv.paidAmount), 0);

  // Inventory value
  const supplierProducts = await prisma.supplierProduct.findMany({
    include: { product: { select: { stock: true, name: true } } },
  });

  // Use latest purchase price per product
  const productPrices = new Map<string, { price: number; stock: number; name: string }>();
  for (const sp of supplierProducts) {
    const existing = productPrices.get(sp.productId);
    if (!existing || sp.lastUpdated > (existing as any).lastUpdated) {
      productPrices.set(sp.productId, { price: sp.purchasePrice, stock: sp.product.stock, name: sp.product.name });
    }
  }
  const inventoryValue = Array.from(productPrices.values()).reduce((s, p) => s + p.price * p.stock, 0);

  // Commission totals
  const commissions = await prisma.commissionRecord.aggregate({
    where: dateFilter("createdAt"),
    _sum: { commissionAmount: true },
  });

  const pendingCommissions = await prisma.commissionRecord.aggregate({
    where: { status: { in: ["PENDING", "APPROVED"] } },
    _sum: { commissionAmount: true },
  });

  return {
    revenue: sales._sum.totalAmount || 0,
    costOfGoods: (sales._sum.totalAmount || 0) - (sales._sum.profitAmount || 0),
    grossProfit: sales._sum.profitAmount || 0,
    salesCount: sales._count,
    purchases: purchases._sum.totalAmount || 0,
    purchasesCount: purchases._count,
    receivables: {
      total: totalReceivable,
      items: receivables.map((inv) => ({
        id: inv.id,
        number: inv.number,
        counterparty: inv.counterparty.name,
        total: inv.totalAmount,
        paid: inv.paidAmount,
        remaining: inv.totalAmount - inv.paidAmount,
        dueDate: inv.dueDate,
      })),
    },
    inventoryValue,
    commissions: commissions._sum.commissionAmount || 0,
    pendingCommissions: pendingCommissions._sum.commissionAmount || 0,
  };
}
