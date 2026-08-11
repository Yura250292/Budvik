import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Дані для «Аналітики» (/admin/analytics): замовлення → гроші → борги.
 *
 * Джерело — 1С, і ендпоінт віддає лише те, що 1С реально заповнює:
 *   - замовлення (SalesDocument docType ORDER, «ЗаказПокупателя»);
 *   - надходження (Payment, ПКО) — період фільтруємо по paidAt, бо
 *     createdAt тут — дата синхронізації, і по ній всі оплати «сьогоднішні»;
 *   - заборгованість (Counterparty.receivableBalance — сальдо з регістра 1С).
 *
 * Свідомо ВІДСУТНІ: прибуток/маржа/знижки (собівартість не вивантажується),
 * статуси замовлень (у 1С-замовлень немає життєвого циклу — все CONFIRMED),
 * розбивка готівка/безготівка (вид оплати з 1С не розрізняється), болти
 * (магазин не запущено), закупівлі (прихід ще не синхронізується), розріз
 * по торгових (він в аналітиці торгових — за реалізаціями, не замовленнями).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const repId = searchParams.get("repId");

  const dateFilter: Record<string, unknown> = {};
  if (from || to) {
    dateFilter.createdAt = {
      ...(from && { gte: new Date(from) }),
      ...(to && { lte: new Date(to + "T23:59:59") }),
    };
  }
  const repFilter = repId && repId !== "ALL" ? { salesRepId: repId } : {};

  // 1. Замовлення за період
  const salesDocs = await prisma.salesDocument.findMany({
    // docType ORDER: реалізації з 1С живуть у цій самій таблиці й без
    // фільтра задвоїли б кожну відвантажену партію.
    where: { docType: "ORDER", ...dateFilter, ...repFilter },
    include: {
      salesRep: { select: { id: true, name: true } },
      counterparty: { select: { id: true, name: true } },
      items: {
        include: { product: { select: { name: true, sku: true, image: true } } },
      },
      invoice: { select: { paymentStatus: true, paidAmount: true } },
      deliveryStop: {
        select: { status: true, deliveryRoute: { select: { number: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const active = salesDocs.filter((d) => d.status !== "CANCELLED");
  const totalRevenue = active.reduce((s, d) => s + d.totalAmount, 0);

  // 2. Оборот по днях
  const dailyMap = new Map<string, { revenue: number; count: number }>();
  for (const doc of active) {
    const day = new Date(doc.createdAt).toISOString().slice(0, 10);
    const d = dailyMap.get(day) || { revenue: 0, count: 0 };
    d.revenue += doc.totalAmount;
    d.count++;
    dailyMap.set(day, d);
  }

  // 3. Топ клієнтів за замовленнями
  const clientMap = new Map<string, { name: string; revenue: number; count: number }>();
  for (const doc of active) {
    if (!doc.counterparty) continue;
    const c = clientMap.get(doc.counterparty.id) || { name: doc.counterparty.name, revenue: 0, count: 0 };
    c.revenue += doc.totalAmount;
    c.count++;
    clientMap.set(doc.counterparty.id, c);
  }

  // 4. Надходження (ПКО з 1С). paidAt — дата грошей; для ручних записів
  //    без paidAt відступаємо на createdAt, щоб вони не випадали з періоду.
  const payPeriod =
    from || to
      ? {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to + "T23:59:59") }),
        }
      : null;
  const paymentWhere = payPeriod
    ? { OR: [{ paidAt: payPeriod }, { paidAt: null, createdAt: payPeriod }] }
    : {};

  const [paymentAgg, recentPayments] = await Promise.all([
    prisma.payment.aggregate({ where: paymentWhere, _sum: { amount: true }, _count: true }),
    prisma.payment.findMany({
      where: paymentWhere,
      select: {
        id: true,
        amount: true,
        paidAt: true,
        createdAt: true,
        invoice: { select: { counterparty: { select: { name: true } } } },
      },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      take: 50,
    }),
  ]);

  // 5. Заборгованість — сальдо дебіторки з 1С по контрагентах.
  //    Періодом не фільтрується: борг — це стан «на зараз», а не потік.
  const [debtAgg, topDebtors] = await Promise.all([
    prisma.counterparty.aggregate({
      where: { receivableBalance: { gt: 0 } },
      _sum: { receivableBalance: true },
      _count: true,
    }),
    prisma.counterparty.findMany({
      where: { receivableBalance: { gt: 0 } },
      select: { id: true, name: true, receivableBalance: true, phone: true },
      orderBy: { receivableBalance: "desc" },
      take: 30,
    }),
  ]);

  // 6. Торгові для фільтра
  const salesReps = await prisma.user.findMany({
    where: { role: "SALES" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    orders: salesDocs.map((d) => ({
      id: d.id,
      number: d.number,
      totalAmount: d.totalAmount,
      deliveryMethod: d.deliveryMethod,
      createdAt: d.createdAt,
      salesRep: d.salesRep,
      counterparty: d.counterparty,
      itemCount: d.items.length,
      itemsSummary: d.items.slice(0, 3).map((i) => ({
        name: i.product.name,
        qty: i.quantity,
        price: i.sellingPrice,
        image: i.product.image,
      })),
      invoiceStatus: d.invoice?.paymentStatus || null,
      paidAmount: d.invoice?.paidAmount || 0,
      deliveryStatus: d.deliveryStop?.status || null,
      routeNumber: d.deliveryStop?.deliveryRoute?.number || null,
    })),

    kpis: {
      totalOrders: active.length,
      totalRevenue,
      avgOrderValue: active.length > 0 ? totalRevenue / active.length : 0,
    },

    daily: Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date)),

    payments: {
      total: paymentAgg._sum.amount || 0,
      count: paymentAgg._count,
      recent: recentPayments.map((p) => ({
        id: p.id,
        amount: p.amount,
        date: p.paidAt ?? p.createdAt,
        counterparty: p.invoice?.counterparty?.name || null,
      })),
    },

    debts: {
      total: debtAgg._sum.receivableBalance || 0,
      count: debtAgg._count,
      top: topDebtors.map((c) => ({
        id: c.id,
        name: c.name,
        amount: c.receivableBalance || 0,
        phone: c.phone,
      })),
    },

    topClients: Array.from(clientMap.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15),

    salesReps,
  });
}
