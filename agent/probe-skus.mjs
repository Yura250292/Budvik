/**
 * Діагностика: чи заповнені в 1С артикули номенклатури.
 *
 * Запускати В ПАПЦІ АГЕНТА на сервері 1С:
 *
 *   node probe-skus.mjs
 *
 * Нічого не змінює — лише читає довідник і рахує, у скількох товарів є
 * «Артикул», у скількох лише «Code», а в скількох порожньо. Доступ до
 * бази сайту не потрібен: URL і пароль беруться з config.json поруч.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.argv[2] ?? path.join(here, "config.json");

if (!fs.existsSync(configPath)) {
  console.error(`Не знайшов config.json: ${configPath}`);
  console.error(`Вкажи шлях явно:  node probe-skus.mjs C:\\шлях\\до\\config.json`);
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
const od = cfg.odata ?? {};
const baseUrl = String(od.baseUrl ?? "").replace(/\/$/, "");
if (!baseUrl) {
  console.error("У config.json немає odata.baseUrl");
  process.exit(1);
}

// Пароль у конфігу може бути через env:ЗМІННА — так само, як це робить агент.
function secret(v) {
  const s = String(v ?? "");
  return s.startsWith("env:") ? (process.env[s.slice(4)] ?? "") : s;
}

const auth =
  "Basic " +
  Buffer.from(`${od.username ?? ""}:${secret(od.password)}`).toString("base64");

const entity = cfg.entities?.products ?? "Catalog_Номенклатура";

// $select навмисно не використовуємо: назва поля артикула в різних
// конфігураціях відрізняється («Артикул», «Артикль»), і зайвий $select
// впав би з помилкою замість того, щоб показати, що там насправді.
async function page(skip, top) {
  const url = `${baseUrl}/${entity}?$format=json&$skip=${skip}&$top=${top}`;
  const res = await fetch(url, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`OData ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()).value ?? [];
}

/** Перше непорожнє значення серед можливих імен поля. */
function pick(row, ...names) {
  for (const n of names) {
    const v = row[n];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

console.log(`База: ${baseUrl}`);
console.log(`Довідник: ${entity}\n`);

let skip = 0;
let goods = 0, withArtikul = 0, onlyCode = 0, empty = 0;
const examplesFilled = [];
const examplesEmpty = [];

try {
  for (;;) {
    const rows = await page(skip, 1000);
    if (rows.length === 0) break;

    for (const r of rows) {
      if (r.IsFolder) continue;
      goods++;
      if (goods === 1) {
        // Один раз друкуємо всі поля довідника — щоб було видно, як
        // артикул реально називається в цій конфігурації.
        console.log(`\nПоля довідника: ${Object.keys(r).join(", ")}\n`);
      }
      const art = pick(r, "Артикул", "Артикль", "Artikul");
      const code = pick(r, "Code", "Код");
      const name = pick(r, "Description", "Наименование", "Найменування").slice(0, 55);

      if (art) {
        withArtikul++;
        if (examplesFilled.length < 10) examplesFilled.push(`  Артикул="${art}"  Code="${code}"  | ${name}`);
      } else if (code) {
        onlyCode++;
        if (examplesFilled.length < 10) examplesFilled.push(`  Артикул=—       Code="${code}"  | ${name}`);
      } else {
        empty++;
        if (examplesEmpty.length < 10) examplesEmpty.push(`  порожньо | ${name}`);
      }
    }

    skip += rows.length;
    process.stdout.write(`\rпрочитано: ${skip}`);
    if (rows.length < 1000) break;
  }
} catch (e) {
  console.error(`\n\nПомилка: ${e.message}`);
  process.exit(1);
}

const pct = (n) => (goods ? ((n / goods) * 100).toFixed(1) : "0") + "%";

console.log(`\n\n=== Номенклатура (без груп): ${goods} ===`);
console.log(`  мають Артикул:         ${withArtikul}  (${pct(withArtikul)})`);
console.log(`  Артикула нема, є Code: ${onlyCode}  (${pct(onlyCode)})`);
console.log(`  порожні обидва:        ${empty}  (${pct(empty)})`);

if (examplesFilled.length) {
  console.log(`\nПриклади заповнених:`);
  examplesFilled.forEach((e) => console.log(e));
}
if (examplesEmpty.length) {
  console.log(`\nПриклади порожніх:`);
  examplesEmpty.forEach((e) => console.log(e));
}

console.log(
  withArtikul + onlyCode > 0
    ? `\n✓ Артикули в 1С Є — після виправленої синхронізації вони підтягнуться на сайт.`
    : `\n✗ У 1С артикули порожні — доведеться вивантажувати з Impuls.`
);
