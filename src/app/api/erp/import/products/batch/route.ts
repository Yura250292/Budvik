import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateSlug } from "@/lib/import-1c";
import crypto from "crypto";

function generateSKU(name: string): string {
  const hash = crypto.createHash("md5").update(name).digest("hex").slice(0, 8).toUpperCase();
  return `1C-${hash}`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const items: { name: string; sku?: string; price?: number; stock?: number; category?: string }[] = body.items;

  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Немає товарів" }, { status: 400 });
  }

  // Ensure default category
  let defaultCategory = await prisma.category.findFirst({
    where: { slug: "import-z-1s" },
  });
  if (!defaultCategory) {
    defaultCategory = await prisma.category.create({
      data: { name: "Імпорт з 1С", slug: "import-z-1s" },
    });
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const product of items) {
    try {
      const existing = await prisma.product.findFirst({
        where: { name: product.name },
      });
      if (existing) {
        skipped++;
        continue;
      }

      let slug = generateSlug(product.name);
      if (!slug) slug = `product-${Date.now()}`;

      const slugExists = await prisma.product.findFirst({ where: { slug } });
      if (slugExists) {
        slug = `${slug}-${Date.now().toString(36)}`;
      }

      const sku = product.sku || generateSKU(product.name);
      const skuExists = await prisma.product.findFirst({ where: { sku } });

      let categoryId = defaultCategory.id;
      if (product.category) {
        const cat = await prisma.category.findFirst({
          where: { name: { equals: product.category, mode: "insensitive" } },
        });
        if (cat) categoryId = cat.id;
      }

      await prisma.product.create({
        data: {
          name: product.name,
          slug,
          sku: skuExists ? `${sku}-${Date.now().toString(36)}` : sku,
          description: "",
          price: product.price && !isNaN(product.price) ? product.price : 0,
          stock: product.stock && !isNaN(product.stock) ? product.stock : 0,
          categoryId,
          isActive: true,
        },
      });
      created++;
    } catch (e: any) {
      errors.push(`"${product.name.slice(0, 40)}": ${e.message}`);
    }
  }

  return NextResponse.json({ created, skipped, errors: errors.slice(0, 10), total: items.length });
}
