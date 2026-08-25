/**
 * Замовлення в застосунку.
 *
 * POST ходить у той самий createOrder(), що й сайт, — кратність пакування,
 * вибір ціни, Болти й атомарне списання складу є рівно в одному місці й
 * розійтися не можуть.
 *
 * Авторизація тут необовʼязкова навмисно: людина має змогти купити свердло,
 * не заводячи акаунт. Гість отримує guestToken і стежить за замовленням за
 * ним — так само, як на сайті.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createOrder } from "@/lib/orders/create-order";
import { shopIdentity, unauthorized } from "@/lib/shop/api";

export const dynamic = "force-dynamic";

/** Скільки замовлень віддавати в історію. Глибше — окремий запит із курсором. */
const HISTORY_TAKE = 50;

export async function GET(req: Request) {
  const me = await shopIdentity(req);
  if (!me) return unauthorized();

  const orders = await prisma.order.findMany({
    where: { userId: me.userId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_TAKE,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalAmount: true,
      boltsUsed: true,
      boltsEarned: true,
      deliveryMethod: true,
      city: true,
      address: true,
      createdAt: true,
      items: {
        select: {
          quantity: true,
          price: true,
          // Повний Product на кожен рядок роздував би відповідь у мегабайти:
          // description і характеристики їхали б для кожної позиції кожного
          // замовлення. packQty потрібен для «Повторити замовлення».
          product: { select: { id: true, name: true, slug: true, image: true, packQty: true } },
        },
      },
    },
  });

  return NextResponse.json({ orders }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const me = await shopIdentity(req);

  const result = await createOrder(await req.json().catch(() => ({})), {
    userId: me?.userId ?? null,
    role: me?.role ?? null,
    /**
     * Куки реферала в застосунку немає: QR торгового веде на сайт і ставить
     * її браузеру. Прив'язка залогіненого покупця до торгового вже лежить у
     * User.referredBySalesRepId — createOrder бере її звідти, тож замовлення
     * з застосунку однаково потрапляє в оборот свого торгового.
     */
    refCode: null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    id: result.id,
    orderNumber: result.orderNumber,
    guestToken: result.guestToken,
  });
}
