/**
 * Перелік товарів без фото і без опису — у Excel.
 *
 * Розділяємо не на «є/немає», а за станом, бо ці стани вимагають різних дій:
 * порожня картка чекає на фото, а картка з фото Епіцентру — на ЗАМІНУ
 * (там водяний знак магазину і часто взагалі чужий товар, див. перевірку
 * 18.08.2026). Рахувати друге за «є фото» означало б сховати проблему.
 *
 * Записи-клієнти («Іванов Іван (м.Львів)») приїхали з 1С у номенклатуру і
 * товарами не є — виносимо окремим листом, щоб не роздували дефіцит.
 *
 *   node scripts/report-missing-content.mjs
 */
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";

const prisma = new PrismaClient();
const SITE = "https://budvik27.com";

/** Опис коротший за це — фактично назва іншими словами, для картки замало. */
const THIN_DESC = 100;

const HEAD = [
  { header: "Артикул", key: "sku", width: 16 },
  { header: "Назва", key: "name", width: 58 },
  { header: "Бренд", key: "brand", width: 16 },
  { header: "Залишок", key: "stock", width: 10 },
  { header: "Ціна", key: "price", width: 12 },
  { header: "Стан фото", key: "photo", width: 26 },
  { header: "Опис, символів", key: "desc", width: 15 },
  { header: "Сторінка", key: "url", width: 46 },
];

function sheet(wb, title, rows, note) {
  const ws = wb.addWorksheet(title.slice(0, 31));
  if (note) {
    ws.addRow([note]);
    ws.getRow(1).font = { italic: true, color: { argb: "FF666666" } };
    ws.addRow([]);
  }
  const headRow = ws.addRow(HEAD.map((h) => h.header));
  headRow.font = { bold: true };
  headRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE082" } };
  HEAD.forEach((h, i) => (ws.getColumn(i + 1).width = h.width));
  ws.views = [{ state: "frozen", ySplit: headRow.number }];
  ws.autoFilter = {
    from: { row: headRow.number, column: 1 },
    to: { row: headRow.number, column: HEAD.length },
  };

  for (const r of rows) {
    const row = ws.addRow([
      r.sku || "—",
      r.name,
      r.brand || "—",
      r.stock,
      r.price,
      r.photo,
      r.descLen,
      `${SITE}/product/${r.slug}`,
    ]);
    if (r.stock > 0) row.getCell(4).font = { bold: true };
    if (r.photo.startsWith("Епіцентр")) {
      row.getCell(6).font = { color: { argb: "FFC62828" } };
    }
    row.getCell(8).font = { color: { argb: "FF1565C0" }, underline: true };
  }
  return ws;
}

async function main() {
  const products = await prisma.$queryRawUnsafe(`
    SELECT p.sku, p.name, p.slug, p.stock, p.price, p.image,
           length(trim(p.description)) AS desc_len,
           b.name AS brand
    FROM "Product" p
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    WHERE p."isActive"
    ORDER BY p.stock DESC, b.name NULLS LAST, p.name`);

  const all = products.map((p) => ({
    sku: p.sku,
    name: p.name,
    slug: p.slug,
    stock: Number(p.stock),
    price: Number(p.price),
    brand: p.brand,
    descLen: Number(p.desc_len),
    image: p.image,
    photo: !p.image
      ? "немає"
      : p.image.includes("cdn.27.ua")
        ? "Епіцентр — водяний знак"
        : "є",
    // Записи, що приїхали з 1С як контрагенти: «Прізвище Ім'я (м.Місто)».
    isClient: /\(м\./.test(p.name) || /^Замовлення /.test(p.name),
  }));

  const goods = all.filter((p) => !p.isClient);
  const clients = all.filter((p) => p.isClient);

  const noPhotoInStock = goods.filter((p) => p.photo === "немає" && p.stock > 0);
  const badPhoto = goods.filter((p) => p.photo.startsWith("Епіцентр"));
  const thinDesc = goods.filter((p) => p.descLen < THIN_DESC && p.stock > 0);
  const noPhotoNoStock = goods.filter((p) => p.photo === "немає" && p.stock <= 0);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Budvik27";
  wb.created = new Date();

  const sum = wb.addWorksheet("Зведення");
  sum.columns = [
    { header: "Розділ", key: "k", width: 46 },
    { header: "Позицій", key: "n", width: 12 },
    { header: "Що робити", key: "todo", width: 62 },
  ];
  sum.getRow(1).font = { bold: true };
  sum.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE082" } };
  [
    ["Без фото, В НАЯВНОСТІ", noPhotoInStock.length, "Головний пріоритет: фото-пакет постачальника, далі зйомка"],
    ["Фото з водяним знаком Епіцентру", badPhoto.length, "Замінити: чужий бренд і реклама магазину на картці"],
    ["Слабкий опис (<100 симв.), в наявності", thinDesc.length, "Дописати після фото — на продаж впливає менше"],
    ["Без фото, немає на складі", noPhotoNoStock.length, "Робити за фактом надходження"],
    ["Записи-клієнти з 1С (не товари)", clients.length, "Прибрати з каталогу — це контрагенти, а не номенклатура"],
    ["Усього активних карток", all.length, ""],
  ].forEach(([k, n, todo]) => sum.addRow({ k, n, todo }));
  sum.getColumn(2).alignment = { horizontal: "right" };

  sheet(wb, "Без фото — в наявності", noPhotoInStock, "Товари, які клієнт бачить у каталозі просто зараз, а фото немає.");
  sheet(wb, "Фото на заміну", badPhoto, "Фото з cdn.27.ua: водяний знак Епіцентру, у частини випадків товар чужого бренду.");
  sheet(wb, "Слабкий опис", thinDesc, `Опис коротший за ${THIN_DESC} символів — фактично переказ назви.`);
  sheet(wb, "Без фото — без залишку", noPhotoNoStock, "Не горить: товару немає на складі.");
  sheet(wb, "Не товари (клієнти з 1С)", clients, "Приїхали з 1С у номенклатуру. Фото їм не потрібні — потрібне прибирання.");

  const file = `output/товари-без-фото-та-опису-${new Date().toISOString().slice(0, 10)}.xlsx`;
  await wb.xlsx.writeFile(file);
  console.log(`Файл: ${file}`);
  console.table([
    { розділ: "без фото, в наявності", n: noPhotoInStock.length },
    { розділ: "фото на заміну", n: badPhoto.length },
    { розділ: "слабкий опис, в наявності", n: thinDesc.length },
    { розділ: "без фото, без залишку", n: noPhotoNoStock.length },
    { розділ: "не товари (клієнти)", n: clients.length },
  ]);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
