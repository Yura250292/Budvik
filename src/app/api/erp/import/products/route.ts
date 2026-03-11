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

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const mode = formData.get("mode") as string | null;

  if (!file) {
    return NextResponse.json({ error: "Файл не завантажено" }, { status: 400 });
  }

  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith(".csv") && !fileName.endsWith(".txt")) {
    return NextResponse.json({ error: "Підтримуються формати: CSV, TXT" }, { status: 400 });
  }

  const text = await file.text();
  const lines = text.trim().split("\n");

  if (lines.length < 2) {
    return NextResponse.json({ error: "Файл порожній або не містить даних" }, { status: 400 });
  }

  // Parse CSV - detect separator
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"(.*)"$/, "$1").toLowerCase());

  // Find the product name column
  const nameIdx = headers.findIndex((h) =>
    ["product_name", "name", "назва", "найменування", "наименование", "товар"].includes(h)
  );

  if (nameIdx === -1) {
    return NextResponse.json({
      error: "Не знайдено колонку з назвою товару. Очікується: product_name, name, назва, товар",
    }, { status: 400 });
  }

  // Optional columns
  const skuIdx = headers.findIndex((h) => ["sku", "артикул", "код", "id"].includes(h));
  const priceIdx = headers.findIndex((h) => ["price", "ціна", "цена"].includes(h));
  const costIdx = headers.findIndex((h) => ["cost_price", "собівартість", "себестоимость", "wholesale_price"].includes(h));
  const stockIdx = headers.findIndex((h) => ["stock", "залишок", "остаток", "кількість"].includes(h));
  const catIdx = headers.findIndex((h) => ["category", "категорія", "категория"].includes(h));

  // Parse product names
  const products: { name: string; sku?: string; price?: number; cost_price?: number; stock?: number; category?: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line, sep);
    const name = cols[nameIdx]?.trim().replace(/^"(.*)"$/, "$1");
    if (!name || name.length < 3) continue;

    products.push({
      name,
      sku: skuIdx >= 0 ? cols[skuIdx]?.trim().replace(/^"(.*)"$/, "$1") : undefined,
      price: priceIdx >= 0 ? parseFloat(cols[priceIdx]?.replace(",", ".").replace(/\s/g, "")) : undefined,
      cost_price: costIdx >= 0 ? parseFloat(cols[costIdx]?.replace(",", ".").replace(/\s/g, "")) : undefined,
      stock: stockIdx >= 0 ? parseInt(cols[stockIdx]?.trim(), 10) : undefined,
      category: catIdx >= 0 ? cols[catIdx]?.trim().replace(/^"(.*)"$/, "$1") : undefined,
    });
  }

  if (products.length === 0) {
    return NextResponse.json({ error: "Не знайдено товарів у файлі" }, { status: 400 });
  }

  // Preview mode
  if (mode === "preview") {
    return NextResponse.json({
      count: products.length,
      items: products.slice(0, 50).map((p) => ({
        name: p.name,
        sku: p.sku || generateSKU(p.name),
        price: p.price || 0,
        cost_price: p.cost_price || 0,
        stock: p.stock || 0,
      })),
    });
  }

  // Import mode
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Ensure default category
  let defaultCategory = await prisma.category.findFirst({
    where: { slug: "import-z-1s" },
  });
  if (!defaultCategory) {
    defaultCategory = await prisma.category.create({
      data: { name: "Імпорт з 1С", slug: "import-z-1s" },
    });
  }

  for (const product of products) {
    try {
      // Skip duplicates by name
      const existing = await prisma.product.findFirst({
        where: { name: product.name },
      });
      if (existing) {
        skipped++;
        continue;
      }

      let slug = generateSlug(product.name);
      if (!slug) slug = `product-${Date.now()}`;

      // Ensure slug uniqueness
      const slugExists = await prisma.product.findFirst({ where: { slug } });
      if (slugExists) {
        slug = `${slug}-${Date.now().toString(36)}`;
      }

      const sku = product.sku || generateSKU(product.name);
      const skuExists = await prisma.product.findFirst({ where: { sku } });

      // Resolve category if specified
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

  return NextResponse.json({
    created,
    skipped,
    errors: errors.slice(0, 30),
    total: products.length,
  });
}

function parseCSVLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
