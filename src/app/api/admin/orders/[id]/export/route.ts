import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import {
  DELIVERY_METHOD_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/utils";

/**
 * Лист комплектації замовлення у .xlsx.
 *
 * Складу потрібен паперовий (або хоча б файловий) документ, з яким можна йти
 * між стелажами: артикул, назва, бренд, скільки взяти і скільки лишиться.
 *
 * «Ще на складі» — саме залишок ПІСЛЯ цього замовлення: товар списується при
 * оформленні. Тому червоним підсвічені не «нестача» (її не буває — API не дає
 * замовити більше, ніж є), а нуль в обліку: 1С перезаписує залишок кожні
 * 5 хвилин, і нуль означає, що полицю варто перевірити очима.
 *
 * exceljs, а не наявний sheetjs: безкоштовний sheetjs не заливає клітинки
 * кольором, а тут підсвітка і є суттю. Формується на сервері, щоб не тягнути
 * бібліотеку в клієнтський бандл.
 */

const STAFF = ["ADMIN", "MANAGER", "SALES"];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !STAFF.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: {
            select: {
              sku: true,
              name: true,
              stock: true,
              packQty: true,
              brand: { select: { name: true } },
            },
          },
        },
      },
      user: { select: { name: true, email: true, phone: true } },
    },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Замовлення ${order.orderNumber}`, {
    views: [{ state: "frozen", ySplit: 6 }],
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 },
  });

  ws.columns = [
    { header: "№", key: "n", width: 5 },
    { header: "Артикул", key: "sku", width: 16 },
    { header: "Назва", key: "name", width: 58 },
    { header: "Бренд", key: "brand", width: 16 },
    { header: "Взяти", key: "qty", width: 9 },
    { header: "Ще на складі", key: "stock", width: 13 },
    { header: "Ціна, грн", key: "price", width: 13, style: { numFmt: "#,##0.00" } },
    { header: "Сума, грн", key: "sum", width: 14, style: { numFmt: "#,##0.00" } },
  ];

  const where =
    order.deliveryMethod === "PICKUP"
      ? DELIVERY_METHOD_LABELS.PICKUP
      : `${DELIVERY_METHOD_LABELS.DELIVERY}: ${[order.city, order.address].filter(Boolean).join(", ") || "—"}`;

  // Шапка документа: усе, що потрібно, щоб зателефонувати й привезти,
  // без повернення в браузер.
  const head: string[] = [
    `Замовлення № ${order.orderNumber} — ${ORDER_STATUS_LABELS[order.status]}` +
      (order.userId ? "" : "  (гість)"),
    `${order.contactName ?? order.user?.name ?? "—"}   тел. ${order.phone ?? order.user?.phone ?? "—"}`,
    where,
    `${PAYMENT_METHOD_LABELS[order.paymentMethod]}   ·   оформлено ${order.createdAt.toLocaleString("uk-UA")}`,
  ];
  if (order.comment) head.push(`Коментар покупця: ${order.comment}`);

  head.forEach((text, i) => {
    ws.insertRow(i + 1, [text]);
    ws.mergeCells(`A${i + 1}:H${i + 1}`);
    ws.getRow(i + 1).font = { bold: i === 0, size: i === 0 ? 14 : 11 };
    ws.getRow(i + 1).alignment = { vertical: "middle" };
  });
  // Порожній рядок-відбивка, щоб шапка не злипалась із таблицею
  ws.insertRow(head.length + 1, []);

  const headerRow = ws.getRow(head.length + 2);
  headerRow.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
  });

  order.items.forEach((item, i) => {
    const short = item.product.stock <= 0;
    const row = ws.addRow({
      n: i + 1,
      sku: item.product.sku ?? "",
      name: item.product.name,
      brand: item.product.brand?.name ?? "",
      qty: item.quantity,
      stock: item.product.stock,
      price: item.price,
      sum: item.price * item.quantity,
    });
    if (short) {
      // Червоне = облік показує нуль, рядок для перевірки полиці
      row.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
      });
      row.getCell("stock").font = { bold: true, color: { argb: "FF9C0006" } };
    }
  });

  const totalRow = ws.addRow({
    name: "РАЗОМ",
    qty: order.items.reduce((s, i) => s + i.quantity, 0),
    sum: order.totalAmount,
  });
  totalRow.font = { bold: true };
  totalRow.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  });

  if (order.boltsUsed > 0) {
    ws.addRow({ name: `Знижка Болтами: −${order.boltsUsed}` });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        `attachment; filename="order-${order.orderNumber}.xlsx"; ` +
        `filename*=UTF-8''${encodeURIComponent(`Замовлення_${order.orderNumber}`)}.xlsx`,
    },
  });
}
