import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BOLTS_CASHBACK_RATE, BOLTS_MAX_USAGE_RATE } from "@/lib/utils";
import { getBrandDiscounts, getWholesalePrice } from "@/lib/wholesale-pricing";
import { findSalesRepByRefCode, REF_COOKIE } from "@/lib/ref-code";
import { packQtyOf, roundUpToPack } from "@/lib/pack-qty";
import { normalizePhone } from "@/lib/phone";
import { notifyStaffNewOrder } from "@/lib/telegram/order-alerts";

/** Один кошик — не оптова заявка: стільки різних позицій роздріб не набирає. */
const MAX_ITEMS = 100;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const where: any = {};
  if (session.user.role === "CLIENT" || session.user.role === "WHOLESALE") {
    where.userId = session.user.id;
  }

  const orders = await prisma.order.findMany({
    where,
    include: {
      // Споживачі списку читають із товару лише назву (плюс quantity/price з
      // позиції) — повний Product на кожен рядок роздував відповідь у
      // мегабайти: description і характеристики їхали для кожної позиції
      // кожного замовлення. packQty потрібен для «Повторити замовлення».
      items: {
        include: {
          product: { select: { id: true, name: true, slug: true, image: true, packQty: true } },
        },
      },
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(orders);
}

export async function POST(req: NextRequest) {
  // Сесія опційна: гість оформлює замовлення, лишивши імʼя, телефон і адресу.
  const session = await getServerSession(authOptions);

  const body = await req.json();
  const { items, useBolts, contactName, phone, city, address, comment } = body;
  const deliveryMethod = body.deliveryMethod === "PICKUP" ? "PICKUP" : "DELIVERY";

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Кошик порожній" }, { status: 400 });
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json({ error: "Забагато позицій у замовленні" }, { status: 400 });
  }

  const name = typeof contactName === "string" ? contactName.trim() : "";
  const normalizedPhone = normalizePhone(phone);
  if (!name) {
    return NextResponse.json({ error: "Вкажіть імʼя" }, { status: 400 });
  }
  if (!normalizedPhone) {
    return NextResponse.json({ error: "Вкажіть коректний номер телефону" }, { status: 400 });
  }
  const cityValue = typeof city === "string" ? city.trim() : "";
  const addressValue = typeof address === "string" ? address.trim() : "";
  if (deliveryMethod === "DELIVERY" && (!cityValue || !addressValue)) {
    return NextResponse.json({ error: "Вкажіть місто та адресу доставки" }, { status: 400 });
  }

  const productIds = items.map((i: any) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });

  const missing = items.filter((i: any) => !products.some((p) => p.id === i.productId));
  if (missing.length > 0) {
    // Раніше такі позиції мовчки випадали з замовлення — людина бачила у
    // підсумку меншу суму, ніж у кошику, без жодного пояснення.
    return NextResponse.json(
      { error: "Деякі товари вже недоступні. Оновіть кошик і спробуйте ще раз." },
      { status: 400 }
    );
  }

  const isWholesale = session?.user.role === "WHOLESALE";
  const brandDiscounts = isWholesale ? await getBrandDiscounts() : new Map<string, number>();

  let totalAmount = 0;
  const orderItems: { productId: string; quantity: number; price: number }[] = [];

  for (const item of items) {
    const product = products.find((p) => p.id === item.productId)!;
    // Кратність тримаємо на сервері, а не лише в кошику: у localStorage міг
    // лежати старий рядок без packQty, та й запит може прийти повз інтерфейс.
    const pack = packQtyOf(product);
    const quantity = roundUpToPack(Number(item.quantity) || 0, pack);
    if (product.stock < quantity) {
      return NextResponse.json(
        { error: `Недостатньо товару "${product.name}" на складі` },
        { status: 400 }
      );
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

  const user = session ? await prisma.user.findUnique({ where: { id: session.user.id } }) : null;

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
    const rep = await findSalesRepByRefCode(req.cookies.get(REF_COOKIE)?.value);
    if (rep && rep.id !== session?.user.id) {
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
          comment: typeof comment === "string" && comment.trim() ? comment.trim().slice(0, 500) : null,
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
      return NextResponse.json(
        { error: "Товар щойно розібрали. Оновіть кошик і спробуйте ще раз." },
        { status: 409 }
      );
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

  return NextResponse.json({
    id: order.id,
    orderNumber: order.orderNumber,
    guestToken: order.guestToken,
  });
}
