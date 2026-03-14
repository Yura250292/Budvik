import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateSlug } from "@/lib/import-1c";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const execAsync = promisify(exec);

// Allow up to 5 minutes for .dt processing (file can be ~1.4GB)
export const maxDuration = 300;

// Increase body size limit for large .dt files
export const dynamic = "force-dynamic";

interface DtImportResult {
  products: string[];
  counterparties: string[];
}

async function runPythonConverter(dtFilePath: string, outputDir: string): Promise<DtImportResult> {
  const scriptPath = path.join(process.cwd(), "scripts", "convert-1c-dt.py");

  // Verify script exists
  try {
    await fs.access(scriptPath);
  } catch {
    throw new Error("Python конвертер не знайдено: scripts/convert-1c-dt.py");
  }

  // Run the converter with a 4-minute timeout
  // Pipe 'n' to stdin to skip the cleanup prompt
  const { stdout, stderr } = await execAsync(
    `echo "n" | python3 "${scriptPath}" "${dtFilePath}" "${outputDir}"`,
    { timeout: 240_000, maxBuffer: 10 * 1024 * 1024 }
  );

  console.log("[dt-import] Python stdout:", stdout);
  if (stderr) console.warn("[dt-import] Python stderr:", stderr);

  // Read resulting CSV files
  const productsPath = path.join(outputDir, "products.csv");
  const counterpartiesPath = path.join(outputDir, "counterparties.csv");

  const products: string[] = [];
  const counterparties: string[] = [];

  try {
    const productsCSV = await fs.readFile(productsPath, "utf-8");
    const lines = productsCSV.trim().split("\n");
    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // CSV with single column, may be quoted
      const name = line.replace(/^"(.*)"$/, "$1").trim();
      if (name && name.length > 3) products.push(name);
    }
  } catch {
    console.warn("[dt-import] products.csv not found");
  }

  try {
    const counterpartiesCSV = await fs.readFile(counterpartiesPath, "utf-8");
    const lines = counterpartiesCSV.trim().split("\n");
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const name = line.replace(/^"(.*)"$/, "$1").trim();
      if (name && name.length > 3) counterparties.push(name);
    }
  } catch {
    console.warn("[dt-import] counterparties.csv not found");
  }

  return { products, counterparties };
}

function determineCounterpartyType(name: string): "SUPPLIER" | "CUSTOMER" | "BOTH" {
  const upper = name.toUpperCase();
  if (
    upper.startsWith("ТОВ ") || upper.startsWith("ТОВ\"") ||
    upper.startsWith("ТОВАРИСТВО") ||
    upper.startsWith("ФОП ") ||
    upper.startsWith("ПП ") ||
    upper.startsWith("ПРАТ") ||
    upper.startsWith("ПРИВАТНЕ")
  ) {
    return "CUSTOMER";
  }
  return "BOTH";
}

function generateSKU(name: string): string {
  const hash = crypto.createHash("md5").update(name).digest("hex").slice(0, 8).toUpperCase();
  return `1C-${hash}`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const mode = formData.get("mode") as string | null;

  if (!file) {
    return NextResponse.json({ error: "Файл не завантажено" }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".dt")) {
    return NextResponse.json({ error: "Підтримується тільки формат .dt" }, { status: 400 });
  }

  // Create temp directory for this import
  const tmpDir = path.join("/tmp", `dt-import-${Date.now()}`);
  const dtFilePath = path.join(tmpDir, "upload.dt");

  try {
    await fs.mkdir(tmpDir, { recursive: true });

    // Write uploaded file to disk
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(dtFilePath, buffer);

    console.log(`[dt-import] File saved: ${dtFilePath} (${(buffer.length / 1024 / 1024).toFixed(0)} MB)`);

    // Run Python converter
    const outputDir = path.join(tmpDir, "output");
    const extracted = await runPythonConverter(dtFilePath, outputDir);

    if (extracted.products.length === 0 && extracted.counterparties.length === 0) {
      return NextResponse.json({
        error: "Не вдалося витягти дані з .dt файлу. Перевірте формат файлу.",
      }, { status: 400 });
    }

    // Preview mode
    if (mode === "preview") {
      return NextResponse.json({
        products: {
          count: extracted.products.length,
          items: extracted.products.slice(0, 50),
        },
        counterparties: {
          count: extracted.counterparties.length,
          items: extracted.counterparties.slice(0, 50),
        },
      });
    }

    // Import mode - save to database
    const result = await importToDatabase(extracted);
    return NextResponse.json(result);

  } catch (e: any) {
    console.error("[dt-import] Error:", e);
    return NextResponse.json({
      error: `Помилка обробки: ${e.message}`,
    }, { status: 500 });
  } finally {
    // Cleanup temp files
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

async function importToDatabase(extracted: DtImportResult) {
  const errors: string[] = [];
  let productsCreated = 0;
  let productsSkipped = 0;
  let counterpartiesCreated = 0;
  let counterpartiesSkipped = 0;

  // 1. Ensure default category exists
  let defaultCategory = await prisma.category.findFirst({
    where: { slug: "import-z-1s" },
  });
  if (!defaultCategory) {
    defaultCategory = await prisma.category.create({
      data: {
        name: "Імпорт з 1С",
        slug: "import-z-1s",
      },
    });
  }

  // 2. Import products
  for (const productName of extracted.products) {
    try {
      // Check for duplicate by name
      const existing = await prisma.product.findFirst({
        where: { name: productName },
      });
      if (existing) {
        productsSkipped++;
        continue;
      }

      // Generate unique slug
      let slug = generateSlug(productName);
      if (!slug) slug = `product-${Date.now()}`;

      // Ensure slug uniqueness
      const slugExists = await prisma.product.findFirst({
        where: { slug },
      });
      if (slugExists) {
        slug = `${slug}-${Date.now().toString(36)}`;
      }

      const sku = generateSKU(productName);

      // Check SKU uniqueness
      const skuExists = await prisma.product.findFirst({
        where: { sku },
      });

      await prisma.product.create({
        data: {
          name: productName,
          slug,
          sku: skuExists ? `${sku}-${Date.now().toString(36)}` : sku,
          description: "",
          price: 0,
          stock: 0,
          categoryId: defaultCategory.id,
          isActive: true,
        },
      });
      productsCreated++;
    } catch (e: any) {
      errors.push(`Товар "${productName.slice(0, 40)}": ${e.message}`);
    }
  }

  // 3. Import counterparties
  // Find the max existing 1C-XXX code
  const existingCodes = await prisma.counterparty.findMany({
    where: { code: { startsWith: "1C-" } },
    select: { code: true },
    orderBy: { code: "desc" },
    take: 1,
  });

  let codeCounter = 1;
  if (existingCodes.length > 0 && existingCodes[0].code) {
    const match = existingCodes[0].code.match(/1C-(\d+)/);
    if (match) codeCounter = parseInt(match[1], 10) + 1;
  }

  for (const cpName of extracted.counterparties) {
    try {
      // Check for duplicate by name
      const existing = await prisma.counterparty.findFirst({
        where: { name: cpName },
      });
      if (existing) {
        counterpartiesSkipped++;
        continue;
      }

      const code = `1C-${String(codeCounter).padStart(3, "0")}`;
      const type = determineCounterpartyType(cpName);

      await prisma.counterparty.create({
        data: {
          name: cpName,
          code,
          type,
          isActive: true,
        },
      });
      counterpartiesCreated++;
      codeCounter++;
    } catch (e: any) {
      errors.push(`Контрагент "${cpName.slice(0, 40)}": ${e.message}`);
    }
  }

  return {
    products: { created: productsCreated, skipped: productsSkipped, total: extracted.products.length },
    counterparties: { created: counterpartiesCreated, skipped: counterpartiesSkipped, total: extracted.counterparties.length },
    errors: errors.slice(0, 30),
  };
}
