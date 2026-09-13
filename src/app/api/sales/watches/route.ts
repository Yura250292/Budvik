import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRoles } from "@/lib/app/identity";
import { watchesFor } from "@/lib/rep-feed/watches";

/**
 * Запити «повідомити, коли приїде».
 *
 * GET — список з поточним залишком і станом; POST { productId } — підписатися
 * (якщо товар уже є — не підписуємо, а кажемо скільки); DELETE ?productId —
 * відписатися. Лише власні запити: userId із сесії.
 */
export const dynamic = "force-dynamic";

const ROLES = ["SALES", "ADMIN"] as const;

async function freeStock(productId: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ free: number }[]>(Prisma.sql`
    SELECT COALESCE(SUM(ls.available), 0)::int AS free
    FROM "LocationStock" ls
    JOIN "StockLocation" sl ON sl.id = ls."stockLocationId"
    WHERE ls."productId" = ${productId} AND sl."isService" = false
  `);
  return rows[0]?.free ?? null;
}

export async function GET(req: Request) {
  const auth = await requireRoles(req, ROLES);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: await watchesFor(auth.me.userId) });
}

export async function POST(req: Request) {
  const auth = await requireRoles(req, ROLES);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const productId = typeof body?.productId === "string" ? body.productId : "";
  const product = productId
    ? await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
    : null;
  if (!product) return NextResponse.json({ error: "Товар не знайдено" }, { status: 404 });

  const free = (await freeStock(productId)) ?? 0;
  if (free > 0) {
    return NextResponse.json({ watching: false, inStock: free });
  }

  // Повторна підписка оновлює createdAt — це новий ключ події, тож
  // виконаний раніше запит спрацює знову, коли товар знову приїде.
  await prisma.productWatch.upsert({
    where: { userId_productId: { userId: auth.me.userId, productId } },
    create: { userId: auth.me.userId, productId },
    update: { createdAt: new Date() },
  });
  return NextResponse.json({ watching: true, inStock: 0 });
}

export async function DELETE(req: Request) {
  const auth = await requireRoles(req, ROLES);
  if (!auth.ok) return auth.response;
  const productId = new URL(req.url).searchParams.get("productId") ?? "";
  await prisma.productWatch.deleteMany({ where: { userId: auth.me.userId, productId } });
  return NextResponse.json({ watching: false });
}
