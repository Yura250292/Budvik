import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Скільки замовлень віддаємо в таблицю. Підсумки (КПІ, графік, топ клієнтів)
 * рахуються по ВСЬОМУ періоду в базі й від цього числа не залежать.
 */
const ORDERS_PAGE_SIZE = 300;

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

  // 1. Замовлення за період.
  //
  // Було: findMany БЕЗ take, з items → product по кожному документу. На
  // бойових даних це 3 682 мс і 5.6 МБ JSON на 2 577 документів — при тому,
  // що з усіх позицій у відповідь ідуть лише лічильник і три штуки прев'ю.
  // Агрегати (оборот по днях, топ клієнтів, КПІ) рахувалися в JS по всьому
  // масиву, тобто весь він тягнувся з бази саме заради них.
  //
  // Стало: агрегати рахує Postgres (нижче), а сюди беремо лише сторінку
  // документів для таблиці. docType ORDER: реалізації з 1С живуть у цій
  // самій таблиці й без фільтра задвоїли б кожну відвантажену партію.
  const docWhere = { docType: "ORDER" as const, ...dateFilter, ...repFilter };

  const salesDocs = await prisma.salesDocument.findMany({
    where: docWhere,
    include: {
      salesRep: { select: { id: true, name: true } },
      counterparty: { select: { id: true, name: true } },
      _count: { select: { items: true } },
      invoice: { select: { paymentStatus: true, paidAmount: true } },
      deliveryStop: {
        select: { status: true, deliveryRoute: { select: { number: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: ORDERS_PAGE_SIZE,
  });

  // Прев'ю позицій (до трьох на документ) — одним запитом на всю сторінку.
  // Вкладений `items: { take: 3 }` у Prisma коштує окремого підзапиту на
  // кожен рядок; віконна функція робить те саме за один рейс до бази.
  const docIds = salesDocs.map((d) => d.id);
  const itemPreviews = docIds.length
    ? await prisma.$queryRaw<
        { salesDocumentId: string; quantity: number; sellingPrice: number; name: string; image: string | null }[]
      >`
        SELECT x."salesDocumentId", x.quantity, x."sellingPrice", x.name, x.image
        FROM (
          SELECT i."salesDocumentId", i.quantity, i."sellingPrice", pr.name, pr.image,
                 row_number() OVER (PARTITION BY i."salesDocumentId" ORDER BY i.id) AS rn
          FROM "SalesDocumentItem" i
          JOIN "Product" pr ON pr.id = i."productId"
          WHERE i."salesDocumentId" = ANY(${docIds})
        ) x
        WHERE x.rn <= 3
      `
    : [];

  const previewsByDoc = new Map<string, typeof itemPreviews>();
  for (const row of itemPreviews) {
    const list = previewsByDoc.get(row.salesDocumentId) ?? [];
    list.push(row);
    previewsByDoc.set(row.salesDocumentId, list);
  }

  // 2-3. Агрегати рахує Postgres по ВСЬОМУ періоду, а не по завантаженій
  //      сторінці — інакше КПІ й графік показували б лише останні
  //      ORDERS_PAGE_SIZE замовлень. Скасовані сюди не входять, як і раніше.
  const aggWhere = {
    ...docWhere,
    status: { not: "CANCELLED" as const },
  };

  const [kpiAgg, dailyGroups, clientGroups] = await Promise.all([
    prisma.salesDocument.aggregate({
      where: aggWhere,
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.$queryRaw<{ date: string; revenue: number; count: number }[]>`
      SELECT to_char(d."createdAt", 'YYYY-MM-DD') AS date,
             coalesce(sum(d."totalAmount"), 0)::float8 AS revenue,
             count(*)::int AS count
      FROM "SalesDocument" d
      WHERE d."docType" = 'ORDER'
        AND d.status <> 'CANCELLED'
        ${from ? Prisma.sql`AND d."createdAt" >= ${new Date(from)}` : Prisma.empty}
        ${to ? Prisma.sql`AND d."createdAt" <= ${new Date(to + "T23:59:59")}` : Prisma.empty}
        ${repId && repId !== "ALL" ? Prisma.sql`AND d."salesRepId" = ${repId}` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<{ id: string; name: string; revenue: number; count: number }[]>`
      SELECT c.id, c.name,
             coalesce(sum(d."totalAmount"), 0)::float8 AS revenue,
             count(*)::int AS count
      FROM "SalesDocument" d
      JOIN "Counterparty" c ON c.id = d."counterpartyId"
      WHERE d."docType" = 'ORDER'
        AND d.status <> 'CANCELLED'
        ${from ? Prisma.sql`AND d."createdAt" >= ${new Date(from)}` : Prisma.empty}
        ${to ? Prisma.sql`AND d."createdAt" <= ${new Date(to + "T23:59:59")}` : Prisma.empty}
        ${repId && repId !== "ALL" ? Prisma.sql`AND d."salesRepId" = ${repId}` : Prisma.empty}
      GROUP BY c.id, c.name
      ORDER BY revenue DESC
      LIMIT 15
    `,
  ]);

  const totalOrders = kpiAgg._count;
  const totalRevenue = kpiAgg._sum.totalAmount ?? 0;

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
      itemCount: d._count.items,
      itemsSummary: (previewsByDoc.get(d.id) ?? []).map((i) => ({
        name: i.name,
        qty: i.quantity,
        price: i.sellingPrice,
        image: i.image,
      })),
      invoiceStatus: d.invoice?.paymentStatus || null,
      paidAmount: d.invoice?.paidAmount || 0,
      deliveryStatus: d.deliveryStop?.status || null,
      routeNumber: d.deliveryStop?.deliveryRoute?.number || null,
    })),

    // Скільки замовлень реально в періоді проти скількох віддали в orders —
    // клієнт показує таблицю по сторінці, а підсумки по всьому періоду.
    ordersTotal: totalOrders,
    ordersReturned: salesDocs.length,

    kpis: {
      totalOrders,
      totalRevenue,
      avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    },

    daily: dailyGroups,

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

    topClients: clientGroups,

    salesReps,
  });
}
