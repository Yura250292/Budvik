import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findReplacements, isOneCDraft } from "@/lib/erp/superseded";
import { requireRoles, STAFF_ROLES, CABINET_ROLES } from "@/lib/app/identity";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRoles(req, STAFF_ROLES);
  if (!auth.ok) return auth.response;
  const me = auth.me;

  const { id } = await params;
  const doc = await prisma.salesDocument.findUnique({
    where: { id },
    include: {
      counterparty: true,
      salesRep: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      // Порядок рядків задаємо ЯВНО: без orderBy Postgres віддає їх як лежить,
      // і той самий документ у замовленні йшов за назвою, а в реалізації за
      // артикулом. Торговий звіряє нашу картку з екраном 1С поруч, і мішанина
      // рядків читається як «дані не ті».
      //
      // Спершу номер рядка з 1С — тоді порядок точно той, що набрав оператор.
      // Документи, що приїхали до появи lineNo (і всі набрані на сайті), його
      // не мають: nulls: "last" відсуває їх у кінець, а сортує такі документи
      // назва товару — вона заодно групує по бренду, бо той стоїть першим
      // словом. Заповнюються номери самі, щойно обмін перезапише табличну
      // частину документа.
      items: {
        orderBy: [{ lineNo: { sort: "asc", nulls: "last" } }, { product: { name: "asc" } }],
        include: {
          product: { select: { id: true, name: true, sku: true, price: true, stock: true, image: true } },
        },
      },
      commissions: true,
      deliveryStop: {
        include: { deliveryRoute: { select: { id: true, number: true, date: true, driver: { select: { name: true } } } } },
      },
    },
  });

  if (!doc) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }

  // SALES can only see their own
  if (me.role === "SALES" && doc.salesRepId !== me.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isOneCDraft(doc)) return NextResponse.json(doc);

  // На картці чернетки показуємо не лише номер заміни, а й її суму: різниця
  // між ними — це і є недовіз, і рахувати його в голові торговий не має.
  const replacedBy = (await findReplacements([doc])).get(doc.id) ?? null;
  return NextResponse.json({ ...doc, replacedBy });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRoles(req, CABINET_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await prisma.salesDocument.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }
  if (existing.status !== "DRAFT") {
    return NextResponse.json({ error: "Можна редагувати тільки чернетку" }, { status: 400 });
  }
  // Чернетка з 1С — не наша. Наступний же прогін обміну перезапише табличну
  // частину цілком, тож правка тут не змінила б нічого, крім враження, що
  // замовлення виправлено. Правити його треба в 1С.
  if (existing.externalId) {
    return NextResponse.json(
      { error: "Замовлення з 1С — редагувати його треба в 1С" },
      { status: 400 }
    );
  }

  const body = await req.json();
  const { counterpartyId, salesRepId, items, notes } = body;

  const updateData: Record<string, unknown> = {};
  if (counterpartyId !== undefined) updateData.counterpartyId = counterpartyId || null;
  if (salesRepId !== undefined) updateData.salesRepId = salesRepId;
  if (notes !== undefined) updateData.notes = notes || null;

  if (items && Array.isArray(items)) {
    await prisma.salesDocumentItem.deleteMany({ where: { salesDocumentId: id } });
    await prisma.salesDocumentItem.createMany({
      data: items.map((item: { productId: string; quantity: number; sellingPrice: number; purchasePrice: number; discountPercent?: number }) => ({
        salesDocumentId: id,
        productId: item.productId,
        quantity: item.quantity,
        sellingPrice: item.sellingPrice,
        purchasePrice: item.purchasePrice,
        discountPercent: item.discountPercent || 0,
      })),
    });
    updateData.totalAmount = items.reduce(
      (sum: number, item: { quantity: number; sellingPrice: number }) =>
        sum + item.quantity * item.sellingPrice,
      0
    );
  }

  const doc = await prisma.salesDocument.update({
    where: { id },
    data: updateData,
    include: {
      counterparty: true,
      salesRep: { select: { id: true, name: true } },
      items: {
        include: { product: { select: { id: true, name: true, sku: true } } },
      },
    },
  });

  return NextResponse.json(doc);
}
