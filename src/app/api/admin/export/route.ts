import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Export orders as CommerceML XML or CSV for 1C
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format") || "xml";
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: any = {};
  if (status) where.status = status;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to + "T23:59:59");
  }

  const orders = await prisma.order.findMany({
    where,
    include: {
      user: { select: { name: true, email: true, phone: true } },
      items: { include: { product: { select: { name: true, sku: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (format === "csv") {
    return exportCSV(orders);
  }
  return exportXML(orders);
}

function exportXML(orders: any[]) {
  const escapeXml = (s: string) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<КоммерческаяИнформация ВерсияСхемы="2.10" ДатаФормирования="${new Date().toISOString()}">\n`;
  xml += `  <Документы>\n`;

  for (const order of orders) {
    xml += `    <Документ>\n`;
    xml += `      <Ид>${escapeXml(order.id)}</Ид>\n`;
    xml += `      <Номер>${escapeXml(order.id)}</Номер>\n`;
    xml += `      <Дата>${order.createdAt.toISOString().split("T")[0]}</Дата>\n`;
    xml += `      <Время>${order.createdAt.toISOString().split("T")[1]?.slice(0, 8)}</Время>\n`;
    xml += `      <Статус>${escapeXml(order.status)}</Статус>\n`;
    xml += `      <Сумма>${order.totalAmount}</Сумма>\n`;
    xml += `      <Контрагенты>\n`;
    xml += `        <Контрагент>\n`;
    xml += `          <Наименование>${escapeXml(order.user.name)}</Наименование>\n`;
    xml += `          <Почта>${escapeXml(order.user.email)}</Почта>\n`;
    if (order.user.phone) {
      xml += `          <Телефон>${escapeXml(order.user.phone)}</Телефон>\n`;
    }
    xml += `        </Контрагент>\n`;
    xml += `      </Контрагенты>\n`;
    xml += `      <Товари>\n`;

    for (const item of order.items) {
      xml += `        <Товар>\n`;
      xml += `          <Ід>${escapeXml(item.product.sku || item.productId)}</Ід>\n`;
      xml += `          <Артикул>${escapeXml(item.product.sku || "")}</Артикул>\n`;
      xml += `          <Найменування>${escapeXml(item.product.name)}</Найменування>\n`;
      xml += `          <Кількість>${item.quantity}</Кількість>\n`;
      xml += `          <Ціна>${item.price}</Ціна>\n`;
      xml += `          <Сума>${item.quantity * item.price}</Сума>\n`;
      xml += `        </Товар>\n`;
    }

    xml += `      </Товари>\n`;
    xml += `    </Документ>\n`;
  }

  xml += `  </Документи>\n`;
  xml += `</КоммерческаяИнформация>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders_${new Date().toISOString().split("T")[0]}.xml"`,
    },
  });
}

function exportCSV(orders: any[]) {
  const sep = ";";
  let csv = [
    "Замовлення",
    "Дата",
    "Статус",
    "Клієнт",
    "Email",
    "Телефон",
    "Артикул",
    "Товар",
    "Кількість",
    "Ціна",
    "Сума",
    "Загальна сума",
  ].join(sep) + "\n";

  for (const order of orders) {
    for (const item of order.items) {
      csv += [
        order.id,
        order.createdAt.toISOString().split("T")[0],
        order.status,
        `"${order.user.name}"`,
        order.user.email,
        order.user.phone || "",
        item.product.sku || "",
        `"${item.product.name}"`,
        item.quantity,
        item.price,
        item.quantity * item.price,
        order.totalAmount,
      ].join(sep) + "\n";
    }
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders_${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}

// Export products for 1C
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { format = "xml" } = await req.json().catch(() => ({}));

  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: { category: true },
    orderBy: { name: "asc" },
  });

  if (format === "csv") {
    const sep = ";";
    let csv = ["Артикул", "Назва", "Категорія", "Ціна", "Залишок", "Опис"].join(sep) + "\n";
    for (const p of products) {
      csv += [
        p.sku || "",
        `"${p.name}"`,
        `"${p.category.name}"`,
        p.price,
        p.stock,
        `"${(p.description || "").replace(/"/g, '""')}"`,
      ].join(sep) + "\n";
    }

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="products_${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  }

  // XML CommerceML format
  const escapeXml = (s: string) =>
    String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<КоммерческаяІнформація ВерсіяСхеми="2.10" ДатаФормування="${new Date().toISOString()}">\n`;
  xml += `  <Каталог>\n`;
  xml += `    <Товари>\n`;

  for (const p of products) {
    xml += `      <Товар>\n`;
    xml += `        <Ід>${escapeXml(p.id)}</Ід>\n`;
    xml += `        <Артикул>${escapeXml(p.sku || "")}</Артикул>\n`;
    xml += `        <Найменування>${escapeXml(p.name)}</Найменування>\n`;
    xml += `        <Опис>${escapeXml(p.description || "")}</Опис>\n`;
    xml += `        <Категорія>${escapeXml(p.category.name)}</Категорія>\n`;
    xml += `        <Ціна>${p.price}</Ціна>\n`;
    xml += `        <Залишок>${p.stock}</Залишок>\n`;
    xml += `      </Товар>\n`;
  }

  xml += `    </Товари>\n`;
  xml += `  </Каталог>\n`;
  xml += `</КоммерческаяІнформація>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="products_${new Date().toISOString().split("T")[0]}.xml"`,
    },
  });
}
