/**
 * Запити фото постачальникам — по файлу на постачальника.
 *
 * Загальний перелік (report-missing-content.mjs) годиться для нас, але не
 * для листа: постачальнику не треба бачити чужі бренди й наші залишки.
 * Тут — рівно те, що він може закрити: артикул, назва, бренд. Артикул
 * першою колонкою, бо саме за ним у них лежить медіа-архів.
 *
 * Групуємо за ВЛАСНИКОМ бренда, а не за брендом: SIGMA, APRO і СИЛА — це
 * одна ТМ Сігма, і трьома листами замість одного ми лише сповільнимо себе.
 *
 *   node scripts/photo-request-per-supplier.mjs
 */
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";

const prisma = new PrismaClient();

/** Хто кому належить. Порядок = черга листів. */
const SUPPLIERS = [
  { file: "ТМ-Сігма", title: "ТМ Сігма", brands: ["SIGMA", "APRO", "СИЛА"] },
  { file: "UNIFIX", title: "UNIFIX", brands: ["UNIFIX"] },
  { file: "TOTAL", title: "TOTAL", brands: ["TOTAL"] },
  { file: "Grösser", title: "Grösser", brands: ["Grösser"] },
  { file: "STREND-PRO", title: "STREND PRO", brands: ["STREND PRO"] },
];

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT p.sku, p.name, b.name AS brand, p.stock
    FROM "Product" p JOIN "Brand" b ON b.id = p."brandId"
    WHERE p."isActive" AND p.stock > 0 AND p.image IS NULL
    ORDER BY b.name, p.name`);

  console.log(`усього без фото в наявності: ${rows.length}`);
  let covered = 0;

  for (const s of SUPPLIERS) {
    // Бренди в базі задвоєні за регістром і діакритикою («Grösser» двічі),
    // тому порівнюємо нормалізовано, а не рівністю рядків.
    const norm = (x) => x.trim().toLowerCase();
    const want = s.brands.map(norm);
    const items = rows.filter((r) => want.includes(norm(r.brand)));
    if (items.length === 0) {
      console.log(`  ${s.title}: нічого не бракує`);
      continue;
    }
    covered += items.length;

    const wb = new ExcelJS.Workbook();
    wb.creator = "Budvik27";
    const ws = wb.addWorksheet("Потрібні фото");

    ws.addRow([`Budvik27 — запит фото товарів, ${s.title}`]).font = { bold: true, size: 13 };
    ws.addRow([`Позицій: ${items.length}. Усі є в нашому асортименті та в наявності на складі.`]);
    ws.addRow([]);

    const head = ws.addRow(["Артикул", "Назва товару", "Бренд"]);
    head.font = { bold: true };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE082" } };
    ws.columns = [
      { width: 18 },
      { width: 68 },
      { width: 16 },
    ];
    ws.views = [{ state: "frozen", ySplit: head.number }];
    ws.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number, column: 3 } };

    for (const it of items) ws.addRow([it.sku || "—", it.name, it.brand]);

    const file = `output/запит-фото-${s.file}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    await wb.xlsx.writeFile(file);
    console.log(`  ${s.title}: ${items.length} позицій → ${file}`);
  }

  console.log(`\nпокрито листами: ${covered} з ${rows.length} (${Math.round((covered / rows.length) * 100)}%)`);
  const rest = rows.length - covered;
  console.log(`лишається знімати самим: ${rest}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
