import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BOLTS_CASHBACK_RATE, BOLTS_MAX_USAGE_RATE } from "@/lib/utils";
import { getBrandDiscounts, getWholesalePrice } from "@/lib/wholesale-pricing";
import { findSalesRepByRefCode, REF_COOKIE } from "@/lib/ref-code";
import { packQtyOf, roundUpToPack } from "@/lib/pack-qty";

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
      // кожного замовлення.
      items: { include: { product: { select: { id: true, name: true, slug: true, image: true } } } },
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(orders);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { items, useBolts } = await req.json();

  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Кошик порожній" }, { status: 400 });
  }

  const productIds = items.map((i: any) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
  });

  let totalAmount = 0;
  const orderItems: { productId: string; quantity: number; price: number }[] = [];

  const isWholesale = session.user.role === "WHOLESALE";
  const brandDiscounts = isWholesale ? await getBrandDiscounts() : new Map<string, number>();

  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) continue;
    // Кратність тримаємо на сервері, а не лише в кошику: у localStorage міг
    // лежати старий рядок без packQty, та й запит може прийти повз інтерфейс.
    const pack = packQtyOf(product);
    const quantity = roundUpToPack(item.quantity, pack);
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
    orderItems.push({
      productId: product.id,
      quantity,
      price: itemPrice,
    });
    totalAmount += itemPrice * quantity;
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  let boltsUsed = 0;
  // Wholesale users don't use or earn bolts
  if (!isWholesale && useBolts && user) {
    const maxBolts = totalAmount * BOLTS_MAX_USAGE_RATE;
    boltsUsed = Math.min(user.boltsBalance, maxBolts);
  }

  const finalAmount = totalAmount - boltsUsed;
  const boltsEarned = isWholesale ? 0 : Math.floor(finalAmount * BOLTS_CASHBACK_RATE);

  /**
   * Торговий, у чий оборот піде замовлення. Якщо клієнт ще нічий, але має
   * куку з QR — доганяємо прив'язку тут: типовий шлях «відсканував QR
   * розлогіненим, потім увійшов давнім акаунтом» інакше лишив би торгового
   * без його ж клієнта.
   */
  let salesRepId = user?.referredBySalesRepId ?? null;
  if (!salesRepId && !isWholesale) {
    const rep = await findSalesRepByRefCode(req.cookies.get(REF_COOKIE)?.value);
    if (rep && rep.id !== session.user.id) {
      const claimed = await prisma.user.updateMany({
        where: { id: session.user.id, referredBySalesRepId: null },
        data: { referredBySalesRepId: rep.id },
      });
      if (claimed.count > 0) salesRepId = rep.id;
    }
  }

  const order = await prisma.order.create({
    data: {
      userId: session.user.id,
      totalAmount: finalAmount,
      boltsUsed,
      boltsEarned,
      status: "PENDING",
      salesRepId,
      items: { create: orderItems },
    },
    include: { items: { include: { product: true } } },
  });

  // Update stock
  for (const item of orderItems) {
    await prisma.product.update({
      where: { id: item.productId },
      data: { stock: { decrement: item.quantity } },
    });
  }

  // Deduct bolts if used
  if (boltsUsed > 0) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { boltsBalance: { decrement: boltsUsed } },
    });
    await prisma.boltsTransaction.create({
      data: {
        userId: session.user.id,
        amount: -boltsUsed,
        type: "SPENT",
        orderId: order.id,
        description: `Використано ${boltsUsed} Болтів для замовлення`,
      },
    });
  }

  return NextResponse.json(order);
}
