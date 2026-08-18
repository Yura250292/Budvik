import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ORDER_STATUS_LABELS } from "@/lib/utils";
import type { OrderStatus } from "@prisma/client";

/**
 * Хто бачить і веде будь-яке замовлення, а не лише своє. Саме ці ролі мають
 * доступ до /admin/orders; водій, складовщик і оптовий клієнт — ні, хоча
 * раніше перевірка пропускала їх усіх, бо дивилась тільки на CLIENT.
 */
const STAFF_ROLES = ["ADMIN", "MANAGER", "SALES"] as const;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      // Бренд потрібен саме тут: на сторінці комплектації в адмінці склад
      // шукає товар по «YATO + артикул», а не по назві з 1С.
      items: { include: { product: { include: { brand: { select: { name: true } } } } } },
      user: { select: { name: true, email: true, phone: true } },
    },
  });

  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Власник — за userId, незалежно від ролі. Перевірка лише для CLIENT
  // відкривала деталі будь-якого замовлення оптовику, водію і складовщику.
  const isOwner = order.userId !== null && order.userId === session.user.id;
  const isStaff = (STAFF_ROLES as readonly string[]).includes(session.user.role);
  if (!isOwner && !isStaff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(order);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { status } = (await req.json()) as { status: OrderStatus };

  if (!status || !(status in ORDER_STATUS_LABELS)) {
    return NextResponse.json({ error: "Невідомий статус" }, { status: 400 });
  }

  const existing = await prisma.order.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, boltsEarned: true, boltsUsed: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = existing.userId !== null && existing.userId === session.user.id;
  const canEditStatus = (STAFF_ROLES as readonly string[]).includes(session.user.role);

  // Покупцю дозволено рівно одну зміну — скасувати ще не підтверджене
  // замовлення. Решта переходів — робота менеджера.
  if (!canEditStatus) {
    if (!isOwner || existing.status !== "PENDING" || status !== "CANCELLED") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (status === "CANCELLED") {
    const restored = await cancelOrder(id, existing.status);
    if (!restored) {
      return NextResponse.json({ error: "Замовлення вже скасовано" }, { status: 409 });
    }
  } else {
    await prisma.order.update({ where: { id }, data: { status } });
  }

  const order = await prisma.order.findUniqueOrThrow({
    where: { id },
    include: { items: { include: { product: true } } },
  });

  // Кешбек — лише зареєстрованому покупцю: гостю нема на що нараховувати.
  if (status === "DELIVERED" && existing.status !== "DELIVERED" && order.boltsEarned > 0 && order.userId) {
    const userId = order.userId;
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { boltsBalance: { increment: order.boltsEarned } },
      }),
      prisma.boltsTransaction.create({
        data: {
          userId,
          amount: order.boltsEarned,
          type: "EARNED",
          orderId: order.id,
          description: `Кешбек ${order.boltsEarned} Болтів за замовлення`,
        },
      }),
    ]);
  }

  // Покупець інакше дізнається про зміну, лише якщо сам зайде і оновить
  // сторінку. Гість бачить статус на своїй /order/[token].
  if (order.userId && existing.status !== status) {
    await prisma.notification.create({
      data: {
        userId: order.userId,
        type: "ORDER_STATUS",
        title: `Замовлення № ${order.orderNumber}: ${ORDER_STATUS_LABELS[status]}`,
        body:
          status === "CANCELLED"
            ? "Замовлення скасовано."
            : `Статус змінено на «${ORDER_STATUS_LABELS[status]}».`,
        relatedId: order.id,
      },
    });
  }

  return NextResponse.json(order);
}

/**
 * Скасування з поверненням залишків і Болтів.
 *
 * Повернення саме тут, в одному місці на всі шляхи скасування (покупець і
 * менеджер): списаний при створенні товар інакше зникав би зі складу назавжди.
 * Умова `status: previous` у транзакції відсікає гонку — два одночасні
 * скасування не повернуть залишок двічі.
 */
async function cancelOrder(id: string, previous: OrderStatus): Promise<boolean> {
  if (previous === "CANCELLED") return false;

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id, status: previous },
      data: { status: "CANCELLED" },
    });
    if (claimed.count === 0) return false;

    const order = await tx.order.findUniqueOrThrow({
      where: { id },
      select: { userId: true, boltsUsed: true, items: { select: { productId: true, quantity: true } } },
    });

    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
    }

    if (order.boltsUsed > 0 && order.userId) {
      await tx.user.update({
        where: { id: order.userId },
        data: { boltsBalance: { increment: order.boltsUsed } },
      });
      await tx.boltsTransaction.create({
        data: {
          userId: order.userId,
          amount: order.boltsUsed,
          type: "EARNED",
          orderId: id,
          description: `Повернення ${order.boltsUsed} Болтів за скасоване замовлення`,
        },
      });
    }

    return true;
  });
}
