import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { scanAndMatch, ScanError } from "@/lib/ai/scan-invoice";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const action = formData.get("action") as string; // "scan" | "create"

  if (!file && action === "scan") {
    return NextResponse.json({ error: "Завантажте фото" }, { status: 400 });
  }

  // Step 1: Scan the image with AI
  if (action === "scan") {
    try {
      const bytes = await file!.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      const mimeType = file!.type || "image/jpeg";

      const { scanned, items, matchedCounterparty } = await scanAndMatch(base64, mimeType);

      return NextResponse.json({
        scanned: {
          ...scanned,
          items,
          matchedCounterparty,
        },
      });
    } catch (e: any) {
      if (e instanceof ScanError) {
        return NextResponse.json(
          e.raw ? { error: e.message, raw: e.raw } : { error: e.message },
          { status: e.status }
        );
      }
      return NextResponse.json({ error: e.message || "Помилка розпізнавання" }, { status: 500 });
    }
  }

  // Step 2: Create document from scanned data
  if (action === "create") {
    const body = JSON.parse(formData.get("data") as string);
    const { type, number: docNumber, date, counterpartyId, items, notes } = body;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "Немає товарів для створення документа" }, { status: 400 });
    }

    try {
      if (type === "purchase") {
        // Create purchase order
        const { getNextDocumentNumber } = await import("@/lib/erp/document-numbers");
        const number = docNumber || await getNextDocumentNumber("PO");

        let totalAmount = 0;
        const orderItems = items.map((item: any) => {
          const lineTotal = item.quantity * item.price;
          totalAmount += lineTotal;
          return {
            productId: item.productId,
            quantity: item.quantity,
            purchasePrice: item.price,
          };
        });

        const po = await prisma.purchaseOrder.create({
          data: {
            number,
            supplierId: counterpartyId || null,
            status: "DRAFT",
            totalAmount,
            notes: notes ? `[AI Scan] ${notes}` : "[AI Scan]",
            createdById: session.user.id,
            createdAt: date ? new Date(date) : undefined,
            items: { create: orderItems },
          },
        });

        return NextResponse.json({ ok: true, type: "purchase", id: po.id, number });
      } else {
        // Create sales document
        const { getNextDocumentNumber } = await import("@/lib/erp/document-numbers");
        const number = docNumber || await getNextDocumentNumber("SD");

        let totalAmount = 0;
        let profitAmount = 0;
        const docItems = [];

        for (const item of items) {
          const lineTotal = item.quantity * item.price;
          totalAmount += lineTotal;

          // Get purchase price for profit calculation
          let purchasePrice = 0;
          if (item.productId) {
            const sp = await prisma.supplierProduct.findFirst({
              where: { productId: item.productId },
              orderBy: { lastUpdated: "desc" },
            });
            purchasePrice = sp?.purchasePrice || 0;
          }
          profitAmount += item.quantity * (item.price - purchasePrice);

          docItems.push({
            productId: item.productId,
            quantity: item.quantity,
            sellingPrice: item.price,
            purchasePrice,
            discountPercent: 0,
          });
        }

        const sd = await prisma.salesDocument.create({
          data: {
            number,
            counterpartyId: counterpartyId || null,
            salesRepId: session.user.role === "SALES" ? session.user.id : null,
            status: "DRAFT",
            totalAmount,
            profitAmount,
            notes: notes ? `[AI Scan] ${notes}` : "[AI Scan]",
            createdById: session.user.id,
            createdAt: date ? new Date(date) : undefined,
            items: { create: docItems },
          },
        });

        return NextResponse.json({ ok: true, type: "sales", id: sd.id, number });
      }
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Помилка створення документа" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Невідома дія" }, { status: 400 });
}
