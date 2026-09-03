import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getNextDocumentNumber } from "@/lib/erp/document-numbers";
import { listPurchaseOrders, purchaseSuppliers } from "@/lib/erp/purchase-orders";
import { requireRoles, OFFICE_ROLES } from "@/lib/app/identity";

/**
 * Прихід доступний лише офісу (ADMIN/MANAGER): у накладних видно закупівельні
 * ціни, і закрито їх тим самим правилом, що й розділ «Закупівлі» (див.
 * middleware.ts). Раніше тут стояли три ролі, сторінка пускала дві інші, а
 * меню показувало пункт усім — три різні відповіді на одне питання.
 */
export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);

  // Довідник постачальників для фільтра — окремим запитом, щоб не тягнути
  // 3,7 тисячі контрагентів там, де надходження є лише від сотні.
  if (searchParams.get("facet") === "suppliers") {
    return NextResponse.json(await purchaseSuppliers());
  }

  const source = searchParams.get("source");
  const result = await listPurchaseOrders({
    from: searchParams.get("from"),
    to: searchParams.get("to"),
    supplierId: searchParams.get("supplierId"),
    stockLocationId: searchParams.get("stockLocationId"),
    status: searchParams.get("status"),
    source: source === "1c" || source === "site" ? source : null,
    q: searchParams.get("q"),
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const { supplierId, items, notes } = body;

  if (!supplierId) {
    return NextResponse.json({ error: "Оберіть постачальника" }, { status: 400 });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Додайте товари" }, { status: 400 });
  }

  const number = await getNextDocumentNumber("PO");
  const totalAmount = items.reduce(
    (sum: number, item: { quantity: number; purchasePrice: number }) =>
      sum + item.quantity * item.purchasePrice,
    0
  );

  const order = await prisma.purchaseOrder.create({
    data: {
      number,
      supplierId,
      totalAmount,
      notes: notes || null,
      createdById: auth.me.userId,
      items: {
        create: items.map((item: { productId: string; quantity: number; purchasePrice: number }) => ({
          productId: item.productId,
          quantity: item.quantity,
          purchasePrice: item.purchasePrice,
        })),
      },
    },
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: { product: { select: { id: true, name: true, sku: true } } },
      },
    },
  });

  return NextResponse.json(order, { status: 201 });
}
