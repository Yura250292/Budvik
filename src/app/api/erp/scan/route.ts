import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface ScannedItem {
  name: string;
  sku?: string;
  quantity: number;
  price: number;
  unit?: string;
}

interface ScannedDocument {
  type: "purchase" | "sales";
  number?: string;
  date?: string;
  counterpartyName?: string;
  counterpartyCode?: string;
  items: ScannedItem[];
  totalAmount?: number;
  notes?: string;
}

const SYSTEM_PROMPT = `Ти — експерт з розпізнавання документів. Тобі дають фото видаткової накладної, прихідної накладної, рахунку або іншого торгового документа.

Твоє завдання — витягти ВСЮ інформацію з документа та повернути її в JSON форматі.

Правила:
1. Визнач тип документа: "purchase" (прихідна/закупівля) або "sales" (видаткова/продаж)
2. Знайди номер документа, дату
3. Знайди назву контрагента (постачальник або покупець) та його код (ЄДРПОУ) якщо є
4. Для КОЖНОГО товару в таблиці витягни: назву, артикул/код (якщо є), кількість, ціну за одиницю, одиницю виміру
5. Знайди загальну суму документа
6. Якщо є додаткові примітки — включи їх

ВАЖЛИВО:
- Ціна — це ціна ЗА ОДИНИЦЮ, а не за рядок
- Кількість — числове значення
- Якщо щось не вдається прочитати — пропусти, не вигадуй
- Поверни ТІЛЬКИ валідний JSON, без markdown обгортки

Формат відповіді:
{
  "type": "purchase" | "sales",
  "number": "номер документа",
  "date": "дата у форматі YYYY-MM-DD",
  "counterpartyName": "назва контрагента",
  "counterpartyCode": "ЄДРПОУ або код",
  "items": [
    {
      "name": "назва товару",
      "sku": "артикул якщо є",
      "quantity": 10,
      "price": 150.50,
      "unit": "шт"
    }
  ],
  "totalAmount": 1505.00,
  "notes": "додаткові примітки"
}`;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!GEMINI_API_KEY) {
    return NextResponse.json({ error: "AI сервіс не налаштований" }, { status: 500 });
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

      const url = `${GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      const geminiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType, data: base64 } },
                { text: "Розпізнай цей документ (накладну/рахунок). Витягни всю інформацію." },
              ],
            },
          ],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
          },
        }),
      });

      if (!geminiRes.ok) {
        const err = await geminiRes.text();
        if (geminiRes.status === 429) {
          return NextResponse.json({ error: "AI сервіс перевантажений. Спробуйте через хвилину." }, { status: 429 });
        }
        return NextResponse.json({ error: `AI помилка: ${geminiRes.status}` }, { status: 500 });
      }

      const geminiData = await geminiRes.json();
      const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // Parse JSON from response (handle markdown wrapping)
      let jsonStr = rawText.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }

      let scanned: ScannedDocument;
      try {
        scanned = JSON.parse(jsonStr);
      } catch {
        return NextResponse.json({ error: "AI не зміг розпізнати документ. Спробуйте краще фото.", raw: rawText }, { status: 422 });
      }

      // Try to match items to existing products
      const matchedItems = [];
      for (const item of scanned.items || []) {
        let product = null;

        // Try SKU match first
        if (item.sku) {
          product = await prisma.product.findFirst({
            where: { sku: item.sku },
            select: { id: true, name: true, sku: true, price: true },
          });
        }

        // Try name match
        if (!product && item.name) {
          product = await prisma.product.findFirst({
            where: { name: { contains: item.name, mode: "insensitive" } },
            select: { id: true, name: true, sku: true, price: true },
          });
        }

        // Fuzzy: try first significant words
        if (!product && item.name) {
          const words = item.name.split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
          for (const word of words) {
            product = await prisma.product.findFirst({
              where: { name: { contains: word, mode: "insensitive" } },
              select: { id: true, name: true, sku: true, price: true },
            });
            if (product) break;
          }
        }

        matchedItems.push({
          ...item,
          matched: product ? { id: product.id, name: product.name, sku: product.sku, currentPrice: product.price } : null,
        });
      }

      // Try to match counterparty
      let matchedCounterparty = null;
      if (scanned.counterpartyCode) {
        matchedCounterparty = await prisma.counterparty.findUnique({
          where: { code: scanned.counterpartyCode },
          select: { id: true, name: true, code: true, type: true },
        });
      }
      if (!matchedCounterparty && scanned.counterpartyName) {
        matchedCounterparty = await prisma.counterparty.findFirst({
          where: { name: { contains: scanned.counterpartyName, mode: "insensitive" } },
          select: { id: true, name: true, code: true, type: true },
        });
      }

      return NextResponse.json({
        scanned: {
          ...scanned,
          items: matchedItems,
          matchedCounterparty,
        },
      });
    } catch (e: any) {
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
