import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { buildLowStockReport, DEFAULT_PARAMS, type LowStockReport } from "@/lib/procurement/low-stock";
import { parseVelocityDays } from "@/lib/analytics/velocity-window";

/**
 * Вивантаження у .xlsx — у двох режимах.
 *
 * GET  — увесь звіт, згрупований за ієрархією номенклатури (огляд складу).
 * POST — заявка постачальнику: лише відібрані в кошик позиції з кількостями.
 *
 * Саме exceljs, а не наявний у проєкті sheetjs (xlsx): безкоштовний sheetjs
 * не вміє заливати клітинки кольором, а підсвітка «червоне — нема,
 * жовте — мало» тут і є суттю файлу. Формується на сервері, щоб не тягнути
 * бібліотеку в клієнтський бандл.
 */

const SEVERITY_FILL = ["FFFFC7CE", "FFFFE0B2", "FFFFEB9C", ""] as const;
const SEVERITY_TEXT = ["FF9C0006", "FFB45309", "FF9C6500", "FF6B7280"] as const;
const SEVERITY_LABEL = [
  "ТЕРМІНОВО — продається, скінчилось",
  "Мало — вистачить менш ніж на місяць",
  "Нижче норми",
  "ok",
] as const;

function fileHeaders(name: string) {
  // Назва бренду може бути кирилицею — у filename* вона має бути закодована.
  const safe = encodeURIComponent(name.replace(/\s+/g, "_"));
  return {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="procurement.xlsx"; filename*=UTF-8''${safe}.xlsx`,
  };
}

/** Повний звіт: розділ → група → товари. */
async function fullReportBook(report: LowStockReport) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Залишки", { views: [{ state: "frozen", ySplit: 2 }] });
  ws.columns = [
    { header: "Артикул", key: "sku", width: 14 },
    { header: "Назва", key: "name", width: 60 },
    { header: "Бренд", key: "brand", width: 16 },
    { header: "Ціна, грн", key: "price", width: 12, style: { numFmt: "#,##0.00" } },
    { header: "Залишок", key: "stock", width: 10 },
    { header: "Продажі/міс", key: "perMonth", width: 12 },
    { header: "Вистачить, днів", key: "daysLeft", width: 15 },
    // Остання дата приходу: відрізняє «скінчилось» від «більше не возимо».
    { header: "Останній прихід", key: "lastReceipt", width: 15 },
    { header: "Замовити", key: "suggested", width: 11 },
    { header: "Статус", key: "status", width: 34 },
  ];

  const title = report.brand?.name ?? "Усі бренди";
  ws.insertRow(1, [
    `${title}: що замовити, ${new Date().toLocaleDateString("uk-UA")} — обіг за ${report.velocityDays} днів, позицій ${report.total}, ` +
      `замовити ${report.toOrder} (з них терміново ${report.urgent}), сума ~${report.orderCost.toLocaleString("uk-UA")} грн`,
  ]);
  ws.mergeCells("A1:J1");
  ws.getRow(1).font = { bold: true, size: 13 };
  ws.getRow(2).eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF444444" } };
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
  });

  for (const section of report.sections) {
    const secRow = ws.addRow([`${section.name}  —  позицій: ${section.total}, замовити: ${section.toOrder}`]);
    ws.mergeCells(`A${secRow.number}:J${secRow.number}`);
    secRow.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    secRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
    secRow.height = 20;

    for (const group of section.groups) {
      const gRow = ws.addRow([`    ${group.name}  —  ${group.total} поз., замовити: ${group.toOrder}`]);
      ws.mergeCells(`A${gRow.number}:J${gRow.number}`);
      gRow.font = { bold: true };
      gRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2F3" } };
      gRow.outlineLevel = 1;

      for (const item of group.items) {
        const row = ws.addRow({
          sku: item.sku ?? "",
          name: item.name,
          brand: item.brandName,
          price: item.price,
          stock: item.stock,
          perMonth: item.perMonth || "—",
          daysLeft: item.daysLeft ?? "—",
          lastReceipt: item.lastReceiptAt
            ? new Date(item.lastReceiptAt).toLocaleDateString("uk-UA")
            : "—",
          suggested: item.suggested || "",
          status: SEVERITY_LABEL[item.severity],
        });
        row.outlineLevel = 2;
        const fill = SEVERITY_FILL[item.severity];
        if (fill) {
          row.eachCell((c) => {
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
          });
        }
        row.getCell("status").font = {
          bold: item.severity < 3,
          color: { argb: SEVERITY_TEXT[item.severity] },
        };
      }
    }
  }
  // Підсумок над рядками: заголовок розділу стоїть перед своїми товарами,
  // інакше Excel малює кнопку «+» не в тій строчці.
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  return wb;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const num = (key: keyof typeof DEFAULT_PARAMS) => {
    const raw = Number(searchParams.get(key));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PARAMS[key];
  };
  const report = await buildLowStockReport({
    brandId: searchParams.get("brandId") || null,
    expensivePrice: num("expensivePrice"),
    expensiveMin: num("expensiveMin"),
    cheapMin: num("cheapMin"),
    includeDead: searchParams.get("includeDead") === "1",
    search: searchParams.get("search") ?? undefined,
    velocityDays: parseVelocityDays(searchParams.get("days")),
  });
  if (!report) return NextResponse.json({ error: "Бренд не знайдено" }, { status: 404 });

  const wb = await fullReportBook(report);
  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: fileHeaders(`${report.brand?.name ?? "Склад"}_замовлення`),
  });
}

/** Заявка постачальнику: тільки відібрані позиції з кількостями. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { items?: Array<{ id: string; qty: number }> } | null;
  const wanted = (body?.items ?? []).filter((i) => i && typeof i.id === "string" && Number(i.qty) > 0).slice(0, 5000);
  if (wanted.length === 0) {
    return NextResponse.json({ error: "Кошик порожній" }, { status: 400 });
  }

  // Назви й ціни беремо з бази, а не з тіла запиту: клієнт присилає лише
  // id і кількість, тож підмінити ціну в заявці неможливо.
  const products = await prisma.product.findMany({
    where: { id: { in: wanted.map((i) => i.id) } },
    select: { id: true, sku: true, name: true, price: true, stock: true, brand: { select: { name: true } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const rows = wanted
    .map((w) => ({ p: byId.get(w.id), qty: Math.round(Number(w.qty)) }))
    .filter((r): r is { p: NonNullable<ReturnType<typeof byId.get>>; qty: number } => Boolean(r.p));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Заявка", { views: [{ state: "frozen", ySplit: 2 }] });
  ws.columns = [
    { header: "№", key: "n", width: 5 },
    { header: "Артикул", key: "sku", width: 16 },
    { header: "Назва", key: "name", width: 64 },
    { header: "Бренд", key: "brand", width: 18 },
    { header: "Кількість", key: "qty", width: 11 },
    { header: "Ціна, грн", key: "price", width: 13, style: { numFmt: "#,##0.00" } },
    { header: "Сума, грн", key: "sum", width: 14, style: { numFmt: "#,##0.00" } },
  ];

  const brands = [...new Set(rows.map((r) => r.p.brand?.name).filter(Boolean))];
  const brandLabel = brands.length === 1 ? brands[0]! : `${brands.length} брендів`;
  const total = rows.reduce((s, r) => s + r.qty * r.p.price, 0);

  ws.insertRow(1, [
    `Заявка на закупівлю — ${brandLabel}, ${new Date().toLocaleDateString("uk-UA")} — ` +
      `позицій: ${rows.length}, сума: ${Math.round(total).toLocaleString("uk-UA")} грн`,
  ]);
  ws.mergeCells("A1:G1");
  ws.getRow(1).font = { bold: true, size: 13 };
  ws.getRow(2).eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
  });

  rows.forEach((r, i) => {
    ws.addRow({
      n: i + 1,
      sku: r.p.sku ?? "",
      name: r.p.name,
      brand: r.p.brand?.name ?? "",
      qty: r.qty,
      price: r.p.price,
      sum: r.qty * r.p.price,
    });
  });

  const totalRow = ws.addRow({ name: "РАЗОМ", qty: rows.reduce((s, r) => s + r.qty, 0), sum: total });
  totalRow.font = { bold: true };
  totalRow.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, { headers: fileHeaders(`Заявка_${brandLabel}`) });
}
