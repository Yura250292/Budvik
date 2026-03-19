import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseFileToProducts, previewProductSync } from "@/lib/sync/product-sync";
import { parseFileToCounterparties, previewCounterpartySync } from "@/lib/sync/counterparty-sync";
import { parseFileToSalesDocs, previewSalesDocSync } from "@/lib/sync/sales-sync";
import { parseFileToPurchaseDocs, previewPurchaseDocSync } from "@/lib/sync/purchase-sync";
import { parseDebtCSV, previewDebtSync } from "@/lib/sync/debt-sync";
import { decodeAnyFile } from "@/lib/sync/utils";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const type = formData.get("type") as string;

  if (!file) {
    return NextResponse.json({ error: "Файл не завантажено" }, { status: 400 });
  }

  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith(".csv") && !fileName.endsWith(".txt") && !fileName.endsWith(".xml") && !fileName.endsWith(".xlsx") && !fileName.endsWith(".xls")) {
    return NextResponse.json({ error: "Підтримуються формати: CSV, TXT, XML, XLSX" }, { status: 400 });
  }

  // Auto-detect encoding (Windows-1251 vs UTF-8) + XLSX support
  const buffer = await file.arrayBuffer();
  const content = decodeAnyFile(buffer, file.name);

  try {
    switch (type) {
      case "counterparties": {
        const parsed = parseFileToCounterparties(content, file.name);
        if (parsed.length === 0) return NextResponse.json({ error: "Не знайдено контрагентів у файлі" }, { status: 400 });
        const preview = await previewCounterpartySync(parsed);
        return NextResponse.json({ type: "counterparties", ...preview });
      }

      case "sales_documents": {
        const parsed = parseFileToSalesDocs(content, file.name);
        if (parsed.length === 0) return NextResponse.json({ error: "Не знайдено документів продажів у файлі" }, { status: 400 });
        const preview = await previewSalesDocSync(parsed);
        return NextResponse.json({ type: "sales_documents", ...preview });
      }

      case "purchase_orders": {
        const parsed = parseFileToPurchaseDocs(content, file.name);
        if (parsed.length === 0) return NextResponse.json({ error: "Не знайдено документів закупівель у файлі" }, { status: 400 });
        const preview = await previewPurchaseDocSync(parsed);
        return NextResponse.json({ type: "purchase_orders", ...preview });
      }

      case "debt": {
        const parsed = parseDebtCSV(content);
        if (parsed.length === 0) return NextResponse.json({ error: "Не знайдено даних дебіторки у файлі" }, { status: 400 });
        const preview = await previewDebtSync(parsed);
        return NextResponse.json({ type: "debt", ...preview });
      }

      default: {
        // products
        const parsed = parseFileToProducts(content, file.name);
        if (parsed.length === 0) return NextResponse.json({ error: "Не знайдено товарів у файлі" }, { status: 400 });
        const preview = await previewProductSync(parsed);
        return NextResponse.json({ type: "products", ...preview });
      }
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Помилка парсингу: ${e.message}` }, { status: 400 });
  }
}
