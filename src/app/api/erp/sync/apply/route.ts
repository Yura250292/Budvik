import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseFileToProducts, applyProductSync } from "@/lib/sync/product-sync";
import { parseFileToCounterparties, applyCounterpartySync } from "@/lib/sync/counterparty-sync";
import { parseFileToSalesDocs, applySalesDocSync } from "@/lib/sync/sales-sync";
import { parseFileToPurchaseDocs, applyPurchaseDocSync } from "@/lib/sync/purchase-sync";
import { parseDebtCSV, applyDebtSync } from "@/lib/sync/debt-sync";
import { decodeFileContent } from "@/lib/sync/utils";

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

  const buffer = await file.arrayBuffer();
  const content = decodeFileContent(buffer);

  try {
    switch (type) {
      case "counterparties": {
        const parsed = parseFileToCounterparties(content, file.name);
        if (parsed.length === 0) return NextResponse.json({ error: "Не знайдено контрагентів у файлі" }, { status: 400 });
        return NextResponse.json(await applyCounterpartySync(parsed, file.name));
      }

      case "sales_documents": {
        const parsed = parseFileToSalesDocs(content, file.name);
        if (parsed.length === 0) return NextResponse.json({ error: "Не знайдено документів продажів у файлі" }, { status: 400 });
        return NextResponse.json(await applySalesDocSync(parsed, file.name));
      }

      case "purchase_orders": {
        const parsed = parseFileToPurchaseDocs(content, file.name);
        if (parsed.length === 0) return NextResponse.json({ error: "Не знайдено документів закупівель у файлі" }, { status: 400 });
        return NextResponse.json(await applyPurchaseDocSync(parsed, file.name));
      }

      case "debt": {
        const parsed = parseDebtCSV(content);
        if (parsed.length === 0) return NextResponse.json({ error: "Не знайдено даних дебіторки у файлі" }, { status: 400 });
        return NextResponse.json(await applyDebtSync(parsed, file.name));
      }

      default: {
        const parsed = parseFileToProducts(content, file.name);
        if (parsed.length === 0) return NextResponse.json({ error: "Не знайдено товарів у файлі" }, { status: 400 });
        return NextResponse.json(await applyProductSync(parsed, file.name));
      }
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Помилка синхронізації: ${e.message}` }, { status: 500 });
  }
}
