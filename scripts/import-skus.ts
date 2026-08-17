/**
 * Імпорт артикулів із CSV (вивантаження з Impuls або з 1С) для товарів,
 * що лежать на сайті із заглушкою «1C-XXXXXXXX».
 *
 *   npx tsx scripts/import-skus.ts file.csv           — покаже, що зміниться
 *   npx tsx scripts/import-skus.ts file.csv --apply   — запише
 *
 * CSV: перший рядок — заголовки. Потрібні колонки з артикулом і назвою;
 * розпізнаються «артикул/sku/код/code» і «назва/наименование/name/товар».
 * Роздільник визначається автоматично (кома, крапка з комою або таб).
 *
 * Зіставлення — за точною назвою (без регістру й зайвих пробілів). Назви з
 * 1С і Impuls зазвичай збігаються символ у символ, бо джерело одне. Що не
 * зіставилось — виводиться списком, щоб було видно, скільки лишилось.
 */
import { prisma } from "@/lib/prisma";
import { isRealSku } from "@/lib/catalog/sku-search";
import fs from "fs";

const FILE = process.argv[2];
const APPLY = process.argv.includes("--apply");

if (!FILE || FILE.startsWith("--")) {
  console.error("Вкажи файл: npx tsx scripts/import-skus.ts file.csv [--apply]");
  process.exit(1);
}

/** Розбір CSV із підтримкою лапок і довільного роздільника. */
function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { cur.push(field); field = ""; }
    else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

function pickColumn(headers: string[], variants: string[]): number {
  return headers.findIndex((h) => {
    const n = h.toLowerCase().trim();
    return variants.some((v) => n === v || n.includes(v));
  });
}

async function main() {
  const raw = fs.readFileSync(FILE, "utf8");
  const firstLine = raw.slice(0, raw.indexOf("\n"));
  const sep = [";", "\t", ","].find((s) => firstLine.includes(s)) ?? ",";
  const rows = parseCsv(raw, sep);
  if (rows.length < 2) { console.error("Порожній файл."); process.exit(1); }

  const headers = rows[0];
  const skuIdx = pickColumn(headers, ["артикул", "sku", "код", "code"]);
  const nameIdx = pickColumn(headers, ["назва", "наименование", "name", "товар", "номенклатура"]);
  if (skuIdx < 0 || nameIdx < 0) {
    console.error(`Не знайшов колонок. Заголовки: ${headers.join(" | ")}`);
    process.exit(1);
  }
  console.log(`Роздільник "${sep}", артикул — «${headers[skuIdx]}», назва — «${headers[nameIdx]}»`);

  // Назва → артикул із файлу.
  const fromFile = new Map<string, string>();
  for (const r of rows.slice(1)) {
    const sku = r[skuIdx]?.trim();
    const name = r[nameIdx]?.trim().toLowerCase();
    if (sku && name && isRealSku(sku)) fromFile.set(name, sku);
  }
  console.log(`У файлі придатних рядків: ${fromFile.size}`);

  const need = await prisma.product.findMany({
    where: { sku: { startsWith: "1C-" } },
    select: { id: true, name: true, sku: true, stock: true },
  });
  console.log(`Товарів без справжнього артикула: ${need.length}`);

  // Артикули, вже зайняті іншими товарами: sku унікальний, дубль впаде.
  const taken = new Set(
    (await prisma.product.findMany({
      where: { sku: { in: [...fromFile.values()] } },
      select: { sku: true },
    })).map((p) => p.sku!)
  );

  const plan: { id: string; name: string; sku: string; stock: number }[] = [];
  const conflicts: string[] = [];
  for (const p of need) {
    const sku = fromFile.get(p.name.trim().toLowerCase());
    if (!sku) continue;
    if (taken.has(sku)) { conflicts.push(`${sku} ← ${p.name.slice(0, 55)}`); continue; }
    plan.push({ id: p.id, name: p.name, sku, stock: p.stock });
    taken.add(sku);
  }

  const withStock = plan.filter((p) => p.stock > 0).length;
  console.log(`\nЗіставилось: ${plan.length} (з них із залишком: ${withStock})`);
  console.log(`Лишиться без артикула: ${need.length - plan.length}`);
  if (conflicts.length) {
    console.log(`\nКонфлікти — артикул уже в іншого товару (${conflicts.length}):`);
    conflicts.slice(0, 10).forEach((c) => console.log("  " + c));
  }
  console.log("\nПриклади:");
  plan.slice(0, 15).forEach((p) => console.log(`  ${p.sku} ← ${p.name.slice(0, 60)}`));

  if (!APPLY) { console.log("\nПробний запуск. Додай --apply, щоб записати."); return; }

  let done = 0;
  for (const p of plan) {
    try {
      await prisma.product.update({ where: { id: p.id }, data: { sku: p.sku } });
      done++;
    } catch (e: any) {
      console.log(`  ✗ ${p.sku}: ${e.message.slice(0, 80)}`);
    }
    if (done % 200 === 0) console.log(`  записано ${done}/${plan.length}`);
  }
  console.log(`Готово: оновлено ${done} товарів.`);
}

main().finally(() => prisma.$disconnect());
