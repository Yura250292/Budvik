/**
 * Запит оригіналів фото у Grösser — xlsx + текст листа.
 *
 * Фото з PDF-каталогу дрібні (половина вужча за 400 px), тож після
 * sync.mts просимо оригінали. Постачальнику даємо його ж артикули (G0362)
 * першою колонкою — за ними в нього лежить медіа-архів, — і три аркуші:
 *   1. що продаємо і вже поставили фото з PDF (тут і потрібні оригінали);
 *   2. позиції каталогу, яких у нас ще немає (фото стануть у пригоді, щойно
 *      з'являться в 1С);
 *   3. наші активні товари Grösser, яких у каталозі немає — спитати, чи
 *      зняті з виробництва, і попросити фото.
 *
 * Джерела — індекс каталогу в R2 і звіт останнього sync.mts --apply.
 *
 *   npx tsx --env-file=.env scripts/grosser-catalog/request-originals.mts [output/grosser-catalog/sync-<дата>-applied.json]
 */
import fs from "node:fs";
import ExcelJS from "exceljs";

const reportPath = process.argv[2] ?? fs.readdirSync("output/grosser-catalog").filter((f) => /^sync-.*-applied\.json$/.test(f)).sort().map((f) => `output/grosser-catalog/${f}`).pop();
if (!reportPath) throw new Error("Немає звіту sync.mts --apply в output/grosser-catalog/");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
  catalogDate: string;
  set: { sku: string | null; name: string; article: string; model: string }[];
  future: { article: string; model: string; kind: string }[];
  orphans: { sku: string | null; name: string; stock: number }[];
};
const latest = (await (await fetch(`${process.env.R2_PUBLIC_URL}/catalogs/grosser/latest.json`)).json()) as { indexUrl: string };
const index = (await (await fetch(latest.indexUrl)).json()) as { rows: { article: string; kind: string; photoPx?: [number, number] }[] };
const byArticle = new Map(index.rows.map((r) => [r.article, r]));

const wb = new ExcelJS.Workbook();
function sheet(title: string, subtitle: string, columns: { header: string; key: string; width: number }[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(title);
  ws.addRow([`Budvik27 — запит фото Grösser, ${subtitle}`]).font = { bold: true, size: 13 };
  ws.addRow([]);
  const head = ws.addRow(columns.map((c) => c.header));
  head.font = { bold: true };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE082" } };
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));
  for (const r of rows) ws.addRow(columns.map((c) => r[c.key] ?? ""));
  ws.views = [{ state: "frozen", ySplit: 3 }];
  return ws;
}

const small = (a: string) => { const px = byArticle.get(a)?.photoPx; return px ? px[0] < 400 : false; };
const sold = [...report.set].sort((a, b) => a.article.localeCompare(b.article));
sheet("1. Продаємо — треба оригінали", `позицій, які ми продаємо: ${sold.length}`, [
  { header: "Артикул Grösser", key: "article", width: 16 },
  { header: "Модель", key: "model", width: 28 },
  { header: "Тип", key: "kind", width: 34 },
  { header: "Фото в PDF, px", key: "px", width: 16 },
  { header: "Дрібне (<400 px)", key: "small", width: 16 },
  { header: "Наш код", key: "sku", width: 22 },
], sold.map((s) => ({ article: s.article, model: s.model, kind: byArticle.get(s.article)?.kind ?? "", px: (byArticle.get(s.article)?.photoPx ?? []).join("×"), small: small(s.article) ? "так" : "", sku: s.sku ?? "" })));

const future = [...report.future].sort((a, b) => a.article.localeCompare(b.article));
sheet("2. Ще не продаємо", `позицій каталогу, яких у нас поки немає: ${future.length}`, [
  { header: "Артикул Grösser", key: "article", width: 16 },
  { header: "Модель", key: "model", width: 28 },
  { header: "Тип", key: "kind", width: 40 },
], future);

const orphans = [...report.orphans].sort((a, b) => (a.sku ?? "").localeCompare(b.sku ?? ""));
sheet("3. Немає в каталозі", `наших позицій, яких немає в каталозі ${report.catalogDate}: ${orphans.length}`, [
  { header: "Наш код", key: "sku", width: 22 },
  { header: "Назва в нас", key: "name", width: 70 },
  { header: "Залишок", key: "stock", width: 10 },
], orphans.map((o) => ({ sku: o.sku ?? "", name: o.name, stock: o.stock })));

fs.mkdirSync("output", { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const xlsx = `output/запит-оригінали-фото-Grösser-${date}.xlsx`;
await wb.xlsx.writeFile(xlsx);

const smallCount = sold.filter((s) => small(s.article)).length;
const letter = `Тема: Оригінали фото товарів Grösser для сайту budvik27.com

Добрий день!

Дякуємо за каталог Grösser від ${report.catalogDate}. Ми виставили на сайт позиції вашого асортименту (${sold.length} шт.) і поставили фото з каталогу, але для інтернет-магазину вони замалі: у ${smallCount} з них ширина менша за 400 px, а картка товару потребує щонайменше 800×800.

Просимо надіслати оригінали фото (JPG/PNG, від 800 px по більшій стороні, за можливості на білому фоні) для позицій з аркуша 1 доданого файлу. Найзручніше — папкою або архівом, де файли названі вашими артикулами (G0362.jpg), тоді ми підвантажимо все автоматично.

Також у файлі:
- аркуш 2 — позиції каталогу, яких ми поки не продаємо (${future.length} шт.); фото до них теж стануть у пригоді, щойно вони з'являться в нас;
- аркуш 3 — позиції, які ми продаємо, але в каталозі їх не знайшли (${orphans.length} шт.). Підкажіть, будь ласка, чи вони зняті з виробництва, і чи є на них фото.

Якщо є свіжіший каталог або прайс із фото — надішліть, ми оновимо картки.

З повагою,
Budvik27
`;
const txt = `output/лист-Grösser-оригінали-фото-${date}.txt`;
fs.writeFileSync(txt, letter);
console.log(`Файл: ${xlsx}\nЛист: ${txt}\nАркуш 1: ${sold.length} (дрібних ${smallCount}), аркуш 2: ${future.length}, аркуш 3: ${orphans.length}`);
