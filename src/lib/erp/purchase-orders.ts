/**
 * Прихід: список накладних і дії над ними.
 *
 * У таблиці PurchaseOrder лежать документи двох походжень, і `externalId`
 * їх розрізняє: заповнений — надходження з 1С (обмін, канал `purchase_doc`),
 * порожній — документ сайту (ручна накладна, AI-скан, файловий імпорт).
 *
 * Документ з 1С на сайті НЕ редагується, не проводиться і не скасовується:
 * усе це робить 1С, а обмін привозить результат наступним циклом. Спроба
 * зробити це тут не «нічого не зламає», а розійдеться з базою обліку.
 *
 * Залишки прихід не рухає — ні з 1С, ні з сайту: Product.stock рахується з
 * LocationStock за регістром 1С (apply-stock.ts) і перезаписується щоп'ять
 * хвилин. Інкремент, який тут колись робило підтвердження, жив до
 * наступного циклу обміну й лише плутав склад.
 */

import { prisma } from "@/lib/prisma";
import { kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import type { Prisma } from "@prisma/client";

/** Стеля списку: без періоду історія надходжень — це тисячі документів. */
export const PURCHASE_LIST_TAKE = 300;

export type PurchaseSource = "1c" | "site";

export type PurchaseListFilters = {
  /** Київська доба, YYYY-MM-DD. */
  from?: string | null;
  to?: string | null;
  supplierId?: string | null;
  stockLocationId?: string | null;
  status?: string | null;
  source?: PurchaseSource | null;
  /** Пошук за номером документа. */
  q?: string | null;
  take?: number;
};

/** Документ, створений обміном з 1С. */
export function isOneCPurchaseOrder(po: { externalId?: string | null }): boolean {
  return !!po.externalId;
}

function buildWhere(f: PurchaseListFilters): Prisma.PurchaseOrderWhereInput {
  const where: Prisma.PurchaseOrderWhereInput = {};

  // Межі доби — київські: наївний new Date("2026-09-01") дав би опівніч UTC,
  // і накладна, оформлена о 01:30 ночі, випала б із «сьогодні».
  if (f.from || f.to) {
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (f.from) createdAt.gte = kyivDayStart(f.from);
    if (f.to) createdAt.lte = kyivDayEnd(f.to);
    where.createdAt = createdAt;
  }
  if (f.supplierId) where.supplierId = f.supplierId;
  if (f.stockLocationId) where.stockLocationId = f.stockLocationId;
  if (f.status) where.status = f.status as Prisma.PurchaseOrderWhereInput["status"];
  if (f.source === "1c") where.externalId = { not: null };
  if (f.source === "site") where.externalId = null;
  if (f.q?.trim()) where.number = { contains: f.q.trim(), mode: "insensitive" };

  return where;
}

export type PurchaseListResult = {
  items: Awaited<ReturnType<typeof fetchOrders>>;
  summary: { count: number; total: number; suppliers: number };
  /** Список обрізано стелею — у фільтрі більше документів, ніж показано. */
  truncated: boolean;
};

async function fetchOrders(where: Prisma.PurchaseOrderWhereInput, take: number) {
  return prisma.purchaseOrder.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true } },
      stockLocation: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * Список надходжень із підсумком за тим самим фільтром.
 *
 * Підсумок рахується запитом, а не по видимих рядках: інакше плитки
 * показували б суму перших 300 документів і мовчки суперечили б фільтру.
 */
export async function listPurchaseOrders(f: PurchaseListFilters): Promise<PurchaseListResult> {
  const where = buildWhere(f);
  const take = f.take ?? PURCHASE_LIST_TAKE;

  const [items, agg, suppliers] = await Promise.all([
    fetchOrders(where, take),
    prisma.purchaseOrder.aggregate({ where, _count: { _all: true }, _sum: { totalAmount: true } }),
    prisma.purchaseOrder.groupBy({ by: ["supplierId"], where }),
  ]);

  return {
    items,
    summary: {
      count: agg._count._all,
      total: agg._sum.totalAmount ?? 0,
      suppliers: suppliers.length,
    },
    truncated: agg._count._all > items.length,
  };
}

/** Постачальники, за якими взагалі є надходження, — для фільтра списку. */
export async function purchaseSuppliers(): Promise<Array<{ id: string; name: string }>> {
  const rows = await prisma.purchaseOrder.groupBy({ by: ["supplierId"], _count: { _all: true } });
  if (rows.length === 0) return [];
  const suppliers = await prisma.counterparty.findMany({
    where: { id: { in: rows.map((r) => r.supplierId) } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return suppliers;
}

/** Спільна відмова для документів, якими володіє 1С. */
function assertEditable(po: { externalId: string | null }): void {
  if (po.externalId) {
    throw new Error("Документ із 1С: проводиться, змінюється і скасовується лише в 1С");
  }
}

export async function confirmPurchaseOrder(id: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!po) throw new Error("Документ не знайдено");
  assertEditable(po);
  if (po.status !== "DRAFT") throw new Error("Можна підтвердити тільки чернетку");

  await prisma.$transaction(async (tx) => {
    // Залишок НЕ чіпаємо — див. коментар угорі файлу. Єдине, що дає
    // проведення сайтового документа понад статус, — свіжа ціна закупівлі
    // в довіднику постачальника.
    for (const item of po.items) {
      await tx.supplierProduct.upsert({
        where: {
          supplierId_productId: {
            supplierId: po.supplierId,
            productId: item.productId,
          },
        },
        update: {
          purchasePrice: item.purchasePrice,
          lastUpdated: new Date(),
        },
        create: {
          supplierId: po.supplierId,
          productId: item.productId,
          purchasePrice: item.purchasePrice,
        },
      });
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
  });
}

export async function cancelPurchaseOrder(id: string) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id } });

  if (!po) throw new Error("Документ не знайдено");
  assertEditable(po);
  if (po.status === "CANCELLED") throw new Error("Документ вже скасовано");

  await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
}
