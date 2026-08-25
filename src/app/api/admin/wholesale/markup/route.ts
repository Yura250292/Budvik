/**
 * Коефіцієнт «роздріб = опт × k» по брендах — для товарів без роздрібної
 * ціни в 1С (див. lib/pricing/retail-markup.ts).
 *
 * GET   — бренди з коефіцієнтом і кількістю товарів, чия ціна розрахункова
 *         (щоб було видно, кого зачепить зміна).
 * PATCH — { brandId, retailMarkup: number | null } — записати коефіцієнт
 *         (null = загальний) і одразу перерахувати розрахункові ціни бренду:
 *         чекати нічного прогону 1С не треба, опт уже лежить у wholesalePrice.
 *
 * Кеш вітрини скидаємо тут же: це перша адмін-дія, що змінює ціни на
 * сторінках каталогу, і година TTL для неї — задовго.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bustStorefrontCache } from "@/lib/storefront-cache";
import { DEFAULT_RETAIL_MARKUP, effectiveMarkup, isValidMarkup, RETAIL_MARKUP_MAX, RETAIL_MARKUP_MIN } from "@/lib/pricing/retail-markup";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [brands, derived, noPrice] = await Promise.all([
    prisma.brand.findMany({
      where: { isActive: true },
      select: { id: true, name: true, retailMarkup: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.groupBy({
      by: ["brandId"],
      where: { priceDerived: true, isActive: true },
      _count: { _all: true },
    }),
    // У наявності, без ціни, але з оптом — саме їх підхопить наступний прогін.
    prisma.product.groupBy({
      by: ["brandId"],
      where: { isActive: true, stock: { gt: 0 }, price: 0, wholesalePrice: { gt: 0 } },
      _count: { _all: true },
    }),
  ]);

  const derivedBy = new Map(derived.map((d) => [d.brandId, d._count._all]));
  const noPriceBy = new Map(noPrice.map((d) => [d.brandId, d._count._all]));

  return NextResponse.json({
    defaultMarkup: DEFAULT_RETAIL_MARKUP,
    min: RETAIL_MARKUP_MIN,
    max: RETAIL_MARKUP_MAX,
    brands: brands.map((b) => ({
      id: b.id,
      name: b.name,
      retailMarkup: b.retailMarkup,
      derivedCount: derivedBy.get(b.id) ?? 0,
      pendingCount: noPriceBy.get(b.id) ?? 0,
    })),
  });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const brandId = typeof body.brandId === "string" ? body.brandId : "";
  const markup: number | null = body.retailMarkup === null || body.retailMarkup === "" ? null : Number(body.retailMarkup);

  if (!brandId) return NextResponse.json({ error: "brandId обовʼязковий" }, { status: 400 });
  if (markup !== null && !isValidMarkup(markup)) {
    return NextResponse.json(
      { error: `Коефіцієнт має бути числом від ${RETAIL_MARKUP_MIN} до ${RETAIL_MARKUP_MAX}` },
      { status: 400 }
    );
  }

  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true } });
  if (!brand) return NextResponse.json({ error: "Бренд не знайдено" }, { status: 404 });

  const k = effectiveMarkup(markup);

  // Один UPDATE замість циклу: розрахункових товарів у бренду сотні, а
  // формула та сама, що в deriveRetailPrice — round(опт × k).
  const [, recomputed] = await prisma.$transaction([
    prisma.brand.update({ where: { id: brandId }, data: { retailMarkup: markup } }),
    prisma.$executeRaw`
      UPDATE "Product"
      SET price = ROUND("wholesalePrice" * ${k}), "updatedAt" = now()
      WHERE "brandId" = ${brandId} AND "priceDerived" = true AND "wholesalePrice" > 0
        AND price <> ROUND("wholesalePrice" * ${k})
    `,
  ]);

  bustStorefrontCache();

  return NextResponse.json({ ok: true, brand: brand.name, retailMarkup: markup, effective: k, recomputed });
}
