import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import ExcelJS from "exceljs";
import { buildLowStockReport, DEFAULT_PARAMS } from "@/lib/procurement/low-stock";

/**
 * Вивантаження звіту закупівель у .xlsx.
 *
 * Саме exceljs, а не наявний у проєкті sheetjs (xlsx): безкоштовний sheetjs
 * не вміє заливати клітинки кольором, а підсвітка «червоне — нема,
 * жовте — мало» тут і є суттю файлу. Формується на сервері, щоб не тягнути
 * бібліотеку в клієнтський бандл.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const brandId = searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId обовʼязковий" }, { status: 400 });

  const num = (key: keyof typeof DEFAULT_PARAMS) => {
    const raw = Number(searchParams.get(key));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PARAMS[key];
  };
  const report = await buildLowStockReport({
    brandId,
    expensivePrice: num("expensivePrice"),
    expensiveMin: num("expensiveMin"),
    cheapMin: num("cheapMin"),
  });
  if (!report) return NextResponse.json({ error: "Бренд не знайдено" }, { status: 404 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Залишки", { views: [{ state: "frozen", ySplit: 2 }] });
  ws.columns = [
    { header: "Артикул", key: "sku", width: 14 },
    { header: "Назва", key: "name", width: 72 },
    { header: "Ціна, грн", key: "price", width: 12, style: { numFmt: "#,##0.00" } },
    { header: "Залишок, шт", key: "stock", width: 12 },
    { header: "Тип", key: "type", width: 12 },
    { header: "Мін. норма", key: "threshold", width: 11 },
    { header: "Статус", key: "status", width: 22 },
  ];

  const today = new Date().toLocaleDateString("uk-UA");
  ws.insertRow(1, [
    `${report.brand.name}: залишки за ієрархією номенклатури, ${today} — ${report.total} товарів, замовити: ${report.toOrder}`,
  ]);
  ws.mergeCells("A1:G1");
  ws.getRow(1).font = { bold: true, size: 13 };
  ws.getRow(2).eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF444444" } };
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
  });

  for (const section of report.sections) {
    const secRow = ws.addRow([`${section.name}  —  товарів: ${section.total}, замовити: ${section.toOrder}`]);
    ws.mergeCells(`A${secRow.number}:G${secRow.number}`);
    secRow.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    secRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
    secRow.height = 20;

    for (const group of section.groups) {
      const gRow = ws.addRow([`    ${group.name}  —  ${group.total} шт, замовити: ${group.toOrder}`]);
      ws.mergeCells(`A${gRow.number}:G${gRow.number}`);
      gRow.font = { bold: true };
      gRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2F3" } };
      gRow.outlineLevel = 1;

      for (const item of group.items) {
        const status = item.severity === 0 ? "ЗАМОВИТИ — нема!" : item.severity === 1 ? "ЗАМОВИТИ — мало" : "ok";
        const row = ws.addRow({
          sku: item.sku ?? "",
          name: item.name,
          price: item.price,
          stock: item.stock,
          type: item.expensive ? "Дорогий" : "Кількісний",
          threshold: item.threshold,
          status,
        });
        row.outlineLevel = 2;
        if (item.severity < 2) {
          const color = item.severity === 0 ? "FFFFC7CE" : "FFFFEB9C";
          row.eachCell((c) => {
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
          });
          row.getCell("status").font = { bold: true, color: { argb: item.severity === 0 ? "FF9C0006" : "FF9C6500" } };
        }
      }
    }
  }
  // Підсумок над рядками: заголовок розділу стоїть перед своїми товарами,
  // інакше Excel малює кнопку «+» не в тій строчці.
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

  const buffer = await wb.xlsx.writeBuffer();
  // Імʼя бренду може бути кирилицею — у filename* воно має бути закодоване.
  const safeName = encodeURIComponent(report.brand.name.replace(/\s+/g, "_"));
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="procurement.xlsx"; filename*=UTF-8''${safeName}_%D0%B7%D0%B0%D0%BC%D0%BE%D0%B2%D0%BB%D0%B5%D0%BD%D0%BD%D1%8F.xlsx`,
    },
  });
}
