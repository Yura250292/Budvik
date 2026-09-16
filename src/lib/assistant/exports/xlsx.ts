/**
 * Excel із набору даних — звичайний і «для 1С».
 *
 * exceljs, а не sheetjs, з тієї самої причини, що й у вивантаженні закупівель
 * (api/admin/procurement/export): безкоштовний sheetjs не вміє заливати
 * клітинки, а «червоне — терміново» і є суттю заявки.
 */

import ExcelJS from "exceljs";
import type { ExportDataset, ExportSheet } from "@/lib/assistant/exports/types";

const HEADER_FILL = "FF2F5496";
const TONE_FILL = { urgent: "FFFFC7CE", warn: "FFFFEB9C" } as const;

const NUM_FMT: Record<string, string> = {
  int: "#,##0",
  decimal: "#,##0.0",
  money: "#,##0.00",
  price: "#,##0.00",
  percent: "0.0",
};

/** Excel забороняє в назві аркуша : \ / ? * [ ] і довжину понад 31. */
const sheetName = (name: string) => name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Аркуш";

function addSheet(wb: ExcelJS.Workbook, sheet: ExportSheet, dataset: ExportDataset, first: boolean) {
  const ws = wb.addWorksheet(sheetName(sheet.name), { views: [{ state: "frozen", ySplit: first ? 5 : 1 }] });
  const width = sheet.columns.length;

  ws.columns = sheet.columns.map((c) => ({
    key: c.key,
    width: c.width ?? (c.kind === "text" || !c.kind ? 18 : 13),
    style: NUM_FMT[c.kind ?? ""] ? { numFmt: NUM_FMT[c.kind ?? ""] } : undefined,
  }));

  // Шапка звіту — лише на першому аркуші: там її шукають очима.
  if (first) {
    const title = ws.addRow([dataset.title]);
    title.font = { bold: true, size: 14 };
    ws.mergeCells(title.number, 1, title.number, Math.max(1, width));
    const sub = ws.addRow([dataset.subtitle]);
    sub.font = { color: { argb: "FF6B7280" } };
    ws.mergeCells(sub.number, 1, sub.number, Math.max(1, width));
    const sum = ws.addRow([dataset.summary.join("  ·  ")]);
    sum.font = { bold: true };
    ws.mergeCells(sum.number, 1, sum.number, Math.max(1, width));
    ws.addRow([]);
  }

  const header = ws.addRow(sheet.columns.map((c) => c.header));
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  header.height = 30;

  sheet.rows.forEach((row, i) => {
    const added = ws.addRow(sheet.columns.map((c) => row[c.key] ?? null));
    const tone = sheet.tones?.[i];
    if (tone) {
      added.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TONE_FILL[tone] } };
      });
    }
  });

  ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: Math.max(1, width) } };

  if (first && dataset.notes.length) {
    ws.addRow([]);
    for (const note of dataset.notes) {
      const r = ws.addRow([note]);
      r.font = { italic: true, color: { argb: "FF6B7280" } };
    }
  }
}

export async function buildXlsx(dataset: ExportDataset): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Budvik · помічник керівника";
  wb.created = new Date();
  dataset.sheets.forEach((sheet, i) => addSheet(wb, sheet, dataset, i === 0));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Файл для 1С: один плоский аркуш, шапка в першому рядку, без злитих
 * клітинок, заливок і підсумків — так його без правок читає обробка
 * «Загрузка данных из табличного документа», а людина в 1С лише зіставляє
 * колонки. Код 1С (Ref_Key) — перша колонка: за ним номенклатура
 * знаходиться однозначно, навіть коли артикул задублений.
 *
 * Сам сайт у 1С нічого не пише (docs/1c-read-only.md): цей файл — вхідні
 * дані для людини, яка створить документ руками.
 */
export async function buildXlsxFor1C(dataset: ExportDataset): Promise<Buffer> {
  const rows = dataset.oneC ?? [];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Заявка");
  ws.columns = [
    { header: "Код 1С", key: "guid", width: 38 },
    { header: "Артикул", key: "sku", width: 16 },
    { header: "Номенклатура", key: "name", width: 60 },
    { header: "Кількість", key: "qty", width: 11, style: { numFmt: "0" } },
    { header: "Ціна", key: "price", width: 12, style: { numFmt: "0.00" } },
  ];
  for (const r of rows) ws.addRow({ guid: r.guid ?? "", sku: r.sku ?? "", name: r.name, qty: r.qty, price: r.price ?? null });
  ws.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
