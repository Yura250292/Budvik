/**
 * Створення роздрібного замовлення — один шлях для сайту і застосунку.
 *
 * Раніше вся ця логіка лежала всередині POST /api/orders. Мобільний застосунок
 * мусить оформлювати замовлення рівно так само: кратність пакування, вибір
 * ціни, списання Болтів, атрибуція торговому й атомарне списання складу — це
 * гроші й залишки, і дві копії неминуче розійшлися б рівно там, де розбіжність
 * найдорожча.
 *
 * Функція повертає результат, а не кидає виняток і не будує NextResponse:
 * так обидва входи самі вирішують, у якій формі відповісти, і жоден із них не
 * може випадково проковтнути помилку складу.
 */

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { BOLTS_CASHBACK_RATE, BOLTS_MAX_USAGE_RATE } from "@/lib/utils";
import { getBrandDiscounts, getWholesalePrice } from "@/lib/wholesale-pricing";
import { findSalesRepByRefCode } from "@/lib/ref-code";
import { packQtyOf, roundUpToPack } from "@/lib/pack-qty";
import { normalizePhone } from "@/lib/phone";
import { notifyStaffNewOrder } from "@/lib/telegram/order-alerts";

/** Один кошик — не оптова заявка: стільки різних позицій роздріб не набирає. */
const MAX_ITEMS = 100;

export type CreateOrderInput = {
  items: unknown;
  useBolts?: unknown;
  contactName?: unknown;
  phone?: unknown;
  city?: unknown;
  address?: unknown;
  comment?: unknown;
  deliveryMethod?: unknown;
};

export type CreateOrderContext = {
  /** Хто оформлює; null — гість. */
  userId: string | null;
  /** Роль із сесії або токена застосунку; визначає оптове ціноутворення. */
  role: string | null;
  /** Значення куки budvik_ref, якщо покупець прийшов за QR торгового. */
  refCode: string | null;
};

export type CreateOrderResult =
  | { ok: true; id: string; orderNumber: number; guestToken: string | null }
  /** status уже готовий для відповіді: 400 — виправна помилка, 409 — гонка за складом. */
  | { ok: false; status: 400 | 409; error: string };

export async function createOrder(
  body: CreateOrderInput,
  ctx: CreateOrderContext
): Promise<CreateOrderResult> {
  const { items, useBolts, contactName, phone, city, address, comment } = body;
  const deliveryMethod = body.deliveryMethod === "PICKUP" ? "PICKUP" : "DELIVERY";

  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, status: 400, error: "Кошик порожній" };
  }
  if (items.length > MAX_ITEMS) {
    return { ok: false, status: 400, error: "Забагато позицій у замовленні" };
  }

  const name = typeof contactName === "string" ? contactName.trim() : "";
  // normalizePhone приймає рядок; тіло запиту тут ще нетипізоване, бо приходить
  // і з браузера, і з застосунку — усе, що не рядок, однаково відсіється нижче.
  const normalizedPhone = normalizePhone(typeof phone === "string" ? phone : "");
  if (!name) {
    return { ok: false, status: 400, error: "Вкажіть імʼя" };
  }
  if (!normalizedPhone) {
    return { ok: false, status: 400, error: "Вкажіть коректний номер телефону" };
  }
  const cityValue = typeof city === "string" ? city.trim() : "";
  const addressValue = typeof address === "string" ? address.trim() : "";
  if (deliveryMethod === "DELIVERY" && (!cityValue || !addressValue)) {
    return { ok: false, status: 400, error: "Вкажіть місто та адресу доставки" };
  }

  const productIds = items.map((i: { productId: string }) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });

  const missing = items.filter(
    (i: { productId: string }) => !products.some((p) => p.id === i.productId)
  );
  if (missing.length > 0) {
    // Раніше такі позиції мовчки випадали з замовлення — людина бачила у
    // підсумку меншу суму, ніж у кошику, без жодного пояснення.
    return {
      ok: false,
      status: 400,
      error: "Деякі товари вже недоступні. Оновіть кошик і спробуйте ще раз.",
    };
  }

  const isWholesale = ctx.role === "WHOLESALE";
  const brandDiscounts = isWholesale ? await getBrandDiscounts() : new Map<string, number>();

  let totalAmount = 0;
  const orderItems: { productId: string; quantity: number; price: number }[] = [];

  for (const item of items as { productId: string; quantity: unknown }[]) {
    const product = products.find((p) => p.id === item.productId)!;
    // Кратність тримаємо на сервері, а не лише в кошику: у localStorage міг
    // лежати старий рядок без packQty, та й запит може прийти повз інтерфейс.
    const pack = packQtyOf(product);
    const quantity = roundUpToPack(Number(item.quantity) || 0, pack);
    if (product.stock < quantity) {
      return {
        ok: false,
        status: 400,
        error: `Недостатньо товару "${product.name}" на складі`,
      };
    }
    let itemPrice = isWholesale
      ? getWholesalePrice(product.price, product.name, brandDiscounts)
      : product.price;
    if (!isWholesale && product.isPromo && product.promoPrice) {
      itemPrice = product.promoPrice;
    }
    orderItems.push({ productId: product.id, quantity, price: itemPrice });
    totalAmount += itemPrice * quantity;
  }

  const user = ctx.userId ? await prisma.user.findUnique({ where: { id: ctx.userId } }) : null;

  let boltsUsed = 0;
  // Гість Болтів не має, оптовик їх не використовує і не заробляє.
  if (!isWholesale && useBolts && user) {
    boltsUsed = Math.min(user.boltsBalance, totalAmount * BOLTS_MAX_USAGE_RATE);
  }

  const finalAmount = totalAmount - boltsUsed;
  const boltsEarned = !isWholesale && user ? Math.floor(finalAmount * BOLTS_CASHBACK_RATE) : 0;

  /**
   * Торговий, у чий оборот піде замовлення. Якщо клієнт ще нічий, але має
   * куку з QR — доганяємо прив'язку тут: типовий шлях «відсканував QR
   * розлогіненим, потім увійшов давнім акаунтом» інакше лишив би торгового
   * без його ж клієнта. Гостю прив'язувати нічого — беремо торгового з куки
   * напряму, щоб замовлення все одно потрапило в його оборот.
   */
  let salesRepId = user?.referredBySalesRepId ?? null;
  if (!salesRepId && !isWholesale) {
    const rep = await findSalesRepByRefCode(ctx.refCode ?? undefined);
    if (rep && rep.id !== ctx.userId) {
      if (user) {
        const claimed = await prisma.user.updateMany({
          where: { id: user.id, referredBySalesRepId: null },
          data: { referredBySalesRepId: rep.id },
        });
        if (claimed.count > 0) salesRepId = rep.id;
      } else {
        salesRepId = rep.id;
      }
    }
  }

  const guestToken = user ? null : randomUUID();

  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId: user?.id ?? null,
          contactName: name,
          phone: normalizedPhone,
          city: deliveryMethod === "DELIVERY" ? cityValue : null,
          address: deliveryMethod === "DELIVERY" ? addressValue : null,
          deliveryMethod,
          paymentMethod: "COD",
          comment:
            typeof comment === "string" && comment.trim() ? comment.trim().slice(0, 500) : null,
          guestToken,
          totalAmount: finalAmount,
          boltsUsed,
          boltsEarned,
          status: "PENDING",
          salesRepId,
          items: { create: orderItems },
        },
        include: { items: { include: { product: { select: { name: true } } } } },
      });

      // Списання складу умовним UPDATE, а не decrement: між перевіркою вище і
      // цим рядком паралельне замовлення могло забрати останню одиницю, і
      // беззастережний decrement загнав би залишок у мінус.
      for (const item of orderItems) {
        const taken = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (taken.count === 0) throw new Error("STOCK_CONFLICT");
      }

      if (boltsUsed > 0 && user) {
        await tx.user.update({
          where: { id: user.id },
          data: { boltsBalance: { decrement: boltsUsed } },
        });
        await tx.boltsTransaction.create({
          data: {
            userId: user.id,
            amount: -boltsUsed,
            type: "SPENT",
            orderId: created.id,
            description: `Використано ${boltsUsed} Болтів для замовлення`,
          },
        });
      }

      return created;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "STOCK_CONFLICT") {
      return {
        ok: false,
        status: 409,
        error: "Товар щойно розібрали. Оновіть кошик і спробуйте ще раз.",
      };
    }
    throw e;
  }

  // Сповіщення — після коміту: зовнішній HTTP усередині транзакції тримав би
  // її відкритою на час відповіді Telegram.
  await notifyStaffNewOrder({
    id: order.id,
    orderNumber: order.orderNumber,
    contactName: order.contactName,
    phone: order.phone,
    city: order.city,
    address: order.address,
    deliveryMethod: order.deliveryMethod,
    comment: order.comment,
    totalAmount: order.totalAmount,
    isGuest: !order.userId,
    items: order.items.map((i) => ({ name: i.product.name, quantity: i.quantity })),
  }).catch(() => {});

  const staff = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "MANAGER"] } },
    select: { id: true },
  });
  if (staff.length > 0) {
    await prisma.notification.createMany({
      data: staff.map((s) => ({
        userId: s.id,
        type: "NEW_ORDER",
        title: `Нове замовлення № ${order.orderNumber}`,
        body: `${order.contactName} · ${order.phone}`,
        relatedId: order.id,
      })),
    });
  }

  return {
    ok: true,
    id: order.id,
    orderNumber: order.orderNumber,
    guestToken: order.guestToken,
  };
}
