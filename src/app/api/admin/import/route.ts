import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseCommerceML, parseCSV, generateSlug } from "@/lib/import-1c";
import type { ParsedProduct } from "@/lib/import-1c";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!["ADMIN", "MANAGER"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const format = formData.get("format") as string; // "xml" | "csv"

    if (!file) {
      return NextResponse.json({ error: "Файл не завантажено" }, { status: 400 });
    }

    const text = await file.text();
    let products: ParsedProduct[] = [];
    let importType = "csv";

    if (format === "xml" || file.name.endsWith(".xml")) {
      const result = parseCommerceML(text);
      products = result.products;
      importType = "commerceml";

      // Auto-create categories from XML
      if (result.categories.length > 0) {
        for (const cat of result.categories) {
          const slug = generateSlug(cat.name);
          await prisma.category.upsert({
            where: { slug },
            update: { name: cat.name },
            create: { name: cat.name, slug },
          });
        }
      }
    } else {
      products = parseCSV(text);
      importType = "csv";
    }

    if (products.length === 0) {
      // Debug: show top-level XML keys to help diagnose format issues
      let debugInfo = "";
      if (format === "xml" || file.name.endsWith(".xml")) {
        try {
          const { XMLParser } = await import("fast-xml-parser");
          const parser = new XMLParser({ ignoreAttributes: false });
          const doc = parser.parse(text);
          const topKeys = Object.keys(doc);
          const rootKey = topKeys.find(k => k !== "?xml") || topKeys[0];
          const root = doc[rootKey];
          const innerKeys = root && typeof root === "object" ? Object.keys(root) : [];
          debugInfo = ` Структура: ${rootKey} → [${innerKeys.join(", ")}]`;
        } catch {}
      }
      return NextResponse.json(
        { error: `Не знайдено товарів у файлі. Перевірте формат.${debugInfo}` },
        { status: 400 }
      );
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    // Get all categories for matching
    const allCategories = await prisma.category.findMany();

    for (const p of products) {
      try {
        if (!p.sku || !p.name) {
          skipped++;
          continue;
        }

        // Find matching category
        let categoryId: string | null = null;
        if (p.category) {
          const cat = allCategories.find(
            (c) =>
              c.name.toLowerCase() === p.category!.toLowerCase() ||
              c.slug === generateSlug(p.category!)
          );
          if (cat) {
            categoryId = cat.id;
          } else {
            // Auto-create category
            const slug = generateSlug(p.category);
            const newCat = await prisma.category.upsert({
              where: { slug },
              update: {},
              create: { name: p.category, slug },
            });
            categoryId = newCat.id;
            allCategories.push(newCat);
          }
        }

        // Default category if none found
        if (!categoryId) {
          let defaultCat = allCategories.find((c) => c.slug === "imported");
          if (!defaultCat) {
            defaultCat = await prisma.category.create({
              data: { name: "Імпортовані", slug: "imported" },
            });
            allCategories.push(defaultCat);
          }
          categoryId = defaultCat.id;
        }

        // Check if product exists by SKU
        const existing = await prisma.product.findUnique({
          where: { sku: p.sku },
        });

        if (existing) {
          // Update existing product
          await prisma.product.update({
            where: { sku: p.sku },
            data: {
              name: p.name,
              ...(p.description && { description: p.description }),
              ...(p.price !== undefined && !isNaN(p.price) && { price: p.price }),
              ...(p.stock !== undefined && !isNaN(p.stock) && { stock: p.stock }),
              ...(categoryId && { categoryId }),
              ...(p.image && { image: p.image }),
            },
          });
          updated++;
        } else {
          // Create new product
          const slug = generateSlug(p.name) + "-" + p.sku.toLowerCase().replace(/[^a-z0-9]/g, "");
          await prisma.product.create({
            data: {
              sku: p.sku,
              name: p.name,
              slug,
              description: p.description || "",
              price: p.price || 0,
              stock: p.stock || 0,
              categoryId,
              image: p.image || null,
            },
          });
          created++;
        }
      } catch (err: any) {
        errors++;
        errorDetails.push(`SKU ${p.sku}: ${err.message}`);
      }
    }

    // Log import
    await prisma.importLog.create({
      data: {
        type: importType,
        filename: file.name,
        status: errors > 0 ? "partial" : "success",
        created,
        updated,
        skipped,
        errors,
        details: errorDetails.length > 0 ? errorDetails.join("\n") : null,
      },
    });

    return NextResponse.json({
      success: true,
      summary: {
        total: products.length,
        created,
        updated,
        skipped,
        errors,
      },
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Помилка обробки файлу: " + err.message },
      { status: 500 }
    );
  }
}

// GET - import history
export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!["ADMIN", "MANAGER"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const logs = await prisma.importLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(logs);
}
