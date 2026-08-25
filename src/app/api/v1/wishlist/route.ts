/**
 * Обране покупця — на сервері.
 *
 * На сайті обране живе в localStorage і зникає разом із кукі браузера. У
 * застосунку так не можна: обране обіцяно показувати офлайн, тобто воно має
 * пережити перевстановлення й зміну телефона. Заразом воно підтягується й на
 * сайті, коли людина заходить із того самого акаунта.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CARD_SELECT } from "@/lib/catalog/query";
import { serializeCard, shopIdentity, unauthorized } from "@/lib/shop/api";

export const dynamic = "force-dynamic";

/** Скільки товарів тримати в обраному. Далі це вже не список, а другий каталог. */
const MAX_ITEMS = 200;

export async function GET(req: Request) {
  const me = await shopIdentity(req);
  if (!me) return unauthorized();

  const rows = await prisma.wishlistItem.findMany({
    where: { userId: me.userId },
    orderBy: { createdAt: "desc" },
    select: { productId: true },
  });

  if (rows.length === 0) return NextResponse.json({ items: [] });

  const products = await prisma.product.findMany({
    where: { id: { in: rows.map((r) => r.productId) } },
    select: CARD_SELECT,
  });

  /**
   * Порядок беремо з обраного, а не з бази: людина очікує побачити зверху те,
   * що зберегла останнім. findMany поверне рядки в довільному порядку.
   */
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = rows
    .map((r) => byId.get(r.productId))
    .filter((p) => p !== undefined)
    .map(serializeCard);

  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const me = await shopIdentity(req);
  if (!me) return unauthorized();

  const { productId } = await req.json().catch(() => ({}));
  if (typeof productId !== "string" || !productId) {
    return NextResponse.json({ error: "Не вказано товар" }, { status: 400 });
  }

  const exists = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ error: "Товар не знайдено" }, { status: 404 });

  const count = await prisma.wishlistItem.count({ where: { userId: me.userId } });
  if (count >= MAX_ITEMS) {
    return NextResponse.json(
      { error: `В обраному вже ${MAX_ITEMS} товарів — приберіть щось зайве` },
      { status: 400 }
    );
  }

  /**
   * upsert, а не create: подвійний натиск на серці не має ставати помилкою
   * унікального індексу — для людини це та сама дія з тим самим результатом.
   */
  await prisma.wishlistItem.upsert({
    where: { userId_productId: { userId: me.userId, productId } },
    create: { userId: me.userId, productId },
    update: {},
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const me = await shopIdentity(req);
  if (!me) return unauthorized();

  const productId = new URL(req.url).searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "Не вказано товар" }, { status: 400 });
  }

  // deleteMany, а не delete: прибирання того, чого вже немає, — не помилка.
  await prisma.wishlistItem.deleteMany({ where: { userId: me.userId, productId } });

  return NextResponse.json({ ok: true });
}
