import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePurchaseDocumentsXML, parseSalesDocumentsXML, parsePurchaseDocumentsCSV, parseSalesDocumentsCSV } from "@/lib/import-1c";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const docType = formData.get("type") as string; // "purchase" | "sales"

  if (!file) {
    return NextResponse.json({ error: "Файл не завантажено" }, { status: 400 });
  }
  if (!["purchase", "sales"].includes(docType)) {
    return NextResponse.json({ error: "Вкажіть тип: purchase або sales" }, { status: 400 });
  }

  const text = await file.text();
  const fileName = file.name.toLowerCase();
  const isCSV = fileName.endsWith(".csv") || fileName.endsWith(".txt");

  const mode = formData.get("mode") as string;

  if (docType === "purchase") {
    return handlePurchaseImport(text, mode, session.user.id, isCSV);
  } else {
    return handleSalesImport(text, mode, session.user.id, isCSV);
  }
}

async function handlePurchaseImport(text: string, mode: string | null, userId: string, isCSV: boolean = false) {
  let parsed;
  try {
    parsed = isCSV ? parsePurchaseDocumentsCSV(text) : parsePurchaseDocumentsXML(text);
  } catch {
    return NextResponse.json({ error: "Помилка парсингу файлу" }, { status: 400 });
  }

  if (parsed.length === 0) {
    return NextResponse.json({ error: "Не знайдено документів у файлі" }, { status: 400 });
  }

  if (mode === "preview") {
    return NextResponse.json({ count: parsed.length, items: parsed.slice(0, 20) });
  }

  let imported = 0;
  let skipped = 0;
  let errors: string[] = [];

  for (const doc of parsed) {
    try {
      // Check if already imported (by number)
      const existing = await prisma.purchaseOrder.findFirst({ where: { number: doc.number } });
      if (existing) { skipped++; continue; }

      // Find supplier by code or by name (CSV uses name in supplierCode field)
      let supplier = doc.supplierCode
        ? await prisma.counterparty.findUnique({ where: { code: doc.supplierCode } })
        : null;
      if (!supplier && doc.supplierCode) {
        supplier = await prisma.counterparty.findFirst({
          where: { name: { contains: doc.supplierCode, mode: "insensitive" } },
        });
      }

      if (!supplier) {
        errors.push(`${doc.number}: постачальник "${doc.supplierCode}" не знайдений`);
        continue;
      }

      // Match products by SKU
      const items = [];
      let totalAmount = 0;
      let hasError = false;

      for (const item of doc.items) {
        let product = await prisma.product.findFirst({ where: { sku: item.sku } });
        if (!product) {
          // Fallback: search by name if SKU not found
          product = await prisma.product.findFirst({ where: { name: item.sku } });
        }
        if (!product) {
          errors.push(`${doc.number}: товар "${item.sku}" не знайдений`);
          hasError = true;
          break;
        }
        items.push({
          productId: product.id,
          quantity: item.quantity,
          purchasePrice: item.purchasePrice,
        });
        totalAmount += item.quantity * item.purchasePrice;
      }

      if (hasError) continue;

      // Create as CONFIRMED (historical import — no stock changes)
      await prisma.purchaseOrder.create({
        data: {
          number: doc.number,
          supplierId: supplier.id,
          status: "CONFIRMED",
          totalAmount,
          notes: doc.notes ? `[Імпорт 1С] ${doc.notes}` : "[Імпорт 1С]",
          confirmedAt: doc.date ? new Date(doc.date) : new Date(),
          createdById: userId,
          createdAt: doc.date ? new Date(doc.date) : undefined,
          items: { create: items },
        },
      });

      // Update supplier product prices
      for (const item of items) {
        await prisma.supplierProduct.upsert({
          where: { supplierId_productId: { supplierId: supplier.id, productId: item.productId } },
          update: { purchasePrice: item.purchasePrice, lastUpdated: new Date() },
          create: { supplierId: supplier.id, productId: item.productId, purchasePrice: item.purchasePrice },
        });
      }

      imported++;
    } catch (e: any) {
      errors.push(`${doc.number}: ${e.message}`);
    }
  }

  return NextResponse.json({ imported, skipped, errors: errors.slice(0, 30), total: parsed.length });
}

async function handleSalesImport(text: string, mode: string | null, userId: string, isCSV: boolean = false) {
  let parsed;
  try {
    parsed = isCSV ? parseSalesDocumentsCSV(text) : parseSalesDocumentsXML(text);
  } catch {
    return NextResponse.json({ error: "Помилка парсингу файлу" }, { status: 400 });
  }

  if (parsed.length === 0) {
    return NextResponse.json({ error: "Не знайдено документів у файлі" }, { status: 400 });
  }

  if (mode === "preview") {
    return NextResponse.json({ count: parsed.length, items: parsed.slice(0, 20) });
  }

  let imported = 0;
  let skipped = 0;
  let errors: string[] = [];

  for (const doc of parsed) {
    try {
      const existing = await prisma.salesDocument.findFirst({ where: { number: doc.number } });
      if (existing) { skipped++; continue; }

      let customer = doc.customerCode
        ? await prisma.counterparty.findUnique({ where: { code: doc.customerCode } })
        : null;
      if (!customer && doc.customerCode) {
        customer = await prisma.counterparty.findFirst({
          where: { name: { contains: doc.customerCode, mode: "insensitive" } },
        });
      }

      const items = [];
      let totalAmount = 0;
      let profitAmount = 0;
      let hasError = false;

      for (const item of doc.items) {
        let product = await prisma.product.findFirst({ where: { sku: item.sku } });
        if (!product) {
          product = await prisma.product.findFirst({ where: { name: item.sku } });
        }
        if (!product) {
          errors.push(`${doc.number}: товар "${item.sku}" не знайдений`);
          hasError = true;
          break;
        }

        const purchasePrice = item.purchasePrice || 0;
        const lineTotal = item.quantity * item.sellingPrice;
        const lineProfit = item.quantity * (item.sellingPrice - purchasePrice);

        items.push({
          productId: product.id,
          quantity: item.quantity,
          sellingPrice: item.sellingPrice,
          purchasePrice,
          discountPercent: 0,
        });
        totalAmount += lineTotal;
        profitAmount += lineProfit;
      }

      if (hasError) continue;

      // Create as CONFIRMED (historical import — no stock changes, no commissions)
      await prisma.salesDocument.create({
        data: {
          number: doc.number,
          counterpartyId: customer?.id || null,
          status: "CONFIRMED",
          totalAmount,
          profitAmount,
          notes: doc.notes ? `[Імпорт 1С] ${doc.notes}` : "[Імпорт 1С]",
          confirmedAt: doc.date ? new Date(doc.date) : new Date(),
          createdById: userId,
          createdAt: doc.date ? new Date(doc.date) : undefined,
          items: { create: items },
        },
      });

      imported++;
    } catch (e: any) {
      errors.push(`${doc.number}: ${e.message}`);
    }
  }

  return NextResponse.json({ imported, skipped, errors: errors.slice(0, 30), total: parsed.length });
}
