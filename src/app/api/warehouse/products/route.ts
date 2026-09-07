/**
 * Пошук товару для складу: що це, скільки є і на якому складі лежить.
 *
 * Свій роут, а не /api/erp/products, і не заради стилю: той віддає ще й
 * закупівельну ціну з SupplierProduct. Складовщикові вона ні до чого, а
 * розширити там список ролей означало б віддати її разом з усім іншим.
 *
 * Лише читання: залишками керує обмін з 1С, і жодна дія на складі їх тут не
 * змінює.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, WAREHOUSE_ROLES } from "@/lib/app/identity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, WAREHOUSE_ROLES);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(Number(searchParams.get("limit")) || 30, 50);

  if (q.length < 2) return NextResponse.json({ products: [] });

  /**
   * Кожне слово має знайтися — інакше «дриль ударний» видає всі дрилі й усе
   * ударне поспіль, і потрібний рядок опиняється на сотій позиції.
   */
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 5);

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      AND: terms.map((term) => ({
        OR: [
          { sku: { contains: term, mode: "insensitive" as const } },
          { name: { contains: term, mode: "insensitive" as const } },
        ],
      })),
    },
    select: {
      id: true,
      name: true,
      sku: true,
      stock: true,
      packQty: true,
      image: true,
      brand: { select: { name: true } },
      locationStocks: {
        where: { quantity: { gt: 0 } },
        select: {
          quantity: true,
          available: true,
          stockLocation: { select: { name: true, isService: true } },
        },
      },
    },
    take: limit * 3,
  });

  // Точний артикул — завжди першим: складовщик шукає саме його, а не схоже.
  const lower = q.toLowerCase();
  const scored = products
    .map((p) => {
      const sku = (p.sku || "").toLowerCase();
      let score = 0;
      if (sku === lower) score += 1000;
      else if (sku.startsWith(lower)) score += 400;
      else if (sku.includes(lower)) score += 150;
      if (p.name.toLowerCase().startsWith(lower)) score += 200;
      if (p.stock > 0) score += 20;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit);

  return NextResponse.json(
    {
      products: scored.map(({ p }) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        packQty: p.packQty,
        image: p.image,
        brand: p.brand?.name ?? null,
        stock: p.stock,
        locations: p.locationStocks
          .map((ls) => ({
            name: ls.stockLocation.name,
            quantity: ls.quantity,
            available: ls.available,
            isService: ls.stockLocation.isService,
          }))
          .sort((a, b) => b.quantity - a.quantity),
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
