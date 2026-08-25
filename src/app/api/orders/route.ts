import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { REF_COOKIE } from "@/lib/ref-code";
import { createOrder } from "@/lib/orders/create-order";

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

/**
 * Оформлення замовлення з браузера.
 *
 * Уся логіка — у createOrder(): застосунок покупця ходить у той самий код,
 * і розійтися на кратності, цінах чи списанні складу вони не можуть.
 * Тут лишається рівно те, що специфічне для вебу — сесія NextAuth і кука
 * реферала.
 */
export async function POST(req: NextRequest) {
  // Сесія опційна: гість оформлює замовлення, лишивши імʼя, телефон і адресу.
  const session = await getServerSession(authOptions);

  const result = await createOrder(await req.json(), {
    userId: session?.user.id ?? null,
    role: session?.user.role ?? null,
    refCode: req.cookies.get(REF_COOKIE)?.value ?? null,
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
