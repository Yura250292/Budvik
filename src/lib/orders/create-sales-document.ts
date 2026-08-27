/**
 * Створення документа замовлення торгового — один шлях для сайту й застосунку.
 *
 * Це НЕ те саме, що createOrder із сусіднього файла. Там роздрібне замовлення
 * покупця (`Order`, Болти, гостьовий токен, миттєве списання складу); тут —
 * документ ERP (`SalesDocument` + `StockReservation`), який офіс потім
 * підтверджує, комплектує й везе. Дві різні таблиці й два різні життєві цикли,
 * тож і ядра два.
 *
 * Логіка жила інлайном у POST /api/erp/sales. Винесена з тієї самої причини,
 * що й createOrder: нативний екран замовлення в застосунку мусить писати
 * документ рівно так само — кратність пачки, закупівельна ціна, резерв складу.
 * Дві копії розійшлися б саме там, де розбіжність найдорожча — на залишках.
 *
 * Функція повертає результат, а не кидає виняток: помилка складу — це нормальна
 * відповідь клієнту (409), а не падіння роута.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getNextDocumentNumber } from "@/lib/erp/document-numbers";
import { getLatestPurchasePrice } from "@/lib/erp/sales";
import { packQtyOf, roundUpToPack } from "@/lib/pack-qty";

export type CreateSalesDocumentInput = {
  counterpartyId?: unknown;
  salesRepId?: unknown;
  items?: unknown;
  notes?: unknown;
};

export type CreateSalesDocumentContext = {
  userId: string;
  role: string;
};

type ItemInput = {
  productId: string;
  quantity: number;
  sellingPrice: number;
  purchasePrice?: number;
  discountPercent?: number;
};

/**
 * Форма документа, яку бачить клієнт. Одна на створення і на читання —
 * інакше застосунок і сайт отримували б на ту саму дію різні набори полів.
 */
const DOCUMENT_INCLUDE = {
  counterparty: { select: { id: true, name: true } },
  salesRep: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true } } } },
} satisfies Prisma.SalesDocumentInclude;

export type SalesDocumentDto = Prisma.SalesDocumentGetPayload<{ include: typeof DOCUMENT_INCLUDE }>;

export type CreateSalesDocumentResult =
  | { ok: true; doc: SalesDocumentDto }
  /** 400 — виправна помилка в даних, 409 — не вистачило вільного залишку. */
  | { ok: false; status: 400 | 409; error: string };

/** Мітка нестачі: щоб транзакція розрізняла «немає товару» і справжнє падіння. */
class OutOfStock extends Error {}

export async function createSalesDocument(
  body: CreateSalesDocumentInput,
  ctx: CreateSalesDocumentContext
): Promise<CreateSalesDocumentResult> {
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, status: 400, error: "Додайте товари" };
  }
  const items = rawItems as ItemInput[];

  /**
   * Торговий оформлює документ тільки на себе.
   *
   * Раніше salesRepId брався з тіла запиту без перевірки, і торговий міг
   * підставити чужий id — тобто записати продаж на колегу. Керівникові це
   * потрібно (оформлює за того, хто в полі), торговому — ні.
   */
  const salesRepId =
    ctx.role === "SALES"
      ? ctx.userId
      : (typeof body.salesRepId === "string" && body.salesRepId) || ctx.userId;

  const counterpartyId =
    typeof body.counterpartyId === "string" && body.counterpartyId ? body.counterpartyId : null;
  const notes = typeof body.notes === "string" && body.notes ? body.notes : null;

  const number = await getNextDocumentNumber("SD");

  // Кратність пачки: беремо з бази, бо клієнт міг надіслати некратну кількість.
  const packs = new Map(
    (
      await prisma.product.findMany({
        where: { id: { in: items.map((i) => i.productId) } },
        select: { id: true, packQty: true },
      })
    ).map((p) => [p.id, packQtyOf(p)])
  );

  // Закупівельну ціну підставляємо самі, якщо клієнт її не прислав.
  const processedItems = await Promise.all(
    items.map(async (item) => ({
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

  try {
    const doc = await prisma.$transaction(async (tx) => {
      // Вільний залишок = склад мінус уже зарезервоване чужими документами.
      for (const item of processedItems) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { name: true, stock: true },
        });
        if (!product) throw new OutOfStock(`Товар не знайдено: ${item.productId}`);

        const reserved = await tx.stockReservation.aggregate({
          where: { productId: item.productId },
          _sum: { quantity: true },
        });
        const available = product.stock - (reserved._sum.quantity || 0);
        if (available < item.quantity) {
          throw new OutOfStock(
            `Недостатньо товару "${product.name}" (доступно: ${available}, на складі: ${product.stock}, резерв: ${reserved._sum.quantity || 0})`
          );
        }
      }

      const created = await tx.salesDocument.create({
        data: {
          number,
          counterpartyId,
          salesRepId,
          totalAmount,
          notes,
          createdById: ctx.userId,
          items: { create: processedItems },
        },
      });

      await tx.stockReservation.createMany({
        data: processedItems.map((item) => ({
          productId: item.productId,
          salesDocumentId: created.id,
          quantity: item.quantity,
        })),
      });

      return tx.salesDocument.findUnique({
        where: { id: created.id },
        include: DOCUMENT_INCLUDE,
      });
    });

    if (!doc) return { ok: false, status: 409, error: "Документ не створено" };
    return { ok: true, doc };
  } catch (e) {
    /**
     * Нестача — це відповідь клієнту, а не збій.
     *
     * Раніше цей throw нікого не ловив, і торговий бачив 500 «Internal Server
     * Error» замість назви товару, якого не вистачило. 409, як у createOrder:
     * той самий випадок — за залишок хтось устиг раніше.
     */
    if (e instanceof OutOfStock) return { ok: false, status: 409, error: e.message };
    throw e;
  }
}
