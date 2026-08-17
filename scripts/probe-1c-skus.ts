/**
 * Діагностика: чи є в 1С артикули для товарів, які на сайті лежать із
 * заглушкою «1C-XXXXXXXX».
 *
 * Запускати НА СЕРВЕРІ 1С (там доступний OData), або з машини, яка бачить
 * публікацію 1С:
 *
 *   ODATA_URL="http://localhost/base/odata/standard.odata" \
 *   ODATA_USER="..." ODATA_PASS="..." \
 *   npx tsx scripts/probe-1c-skus.ts
 *
 * Нічого не змінює — лише читає й друкує звіт.
 */
import { prisma } from "@/lib/prisma";

const URL_BASE = process.env.ODATA_URL;
const USER = process.env.ODATA_USER ?? "";
const PASS = process.env.ODATA_PASS ?? "";

if (!URL_BASE) {
  console.error("Треба ODATA_URL (напр. http://localhost/base/odata/standard.odata)");
  process.exit(1);
}

const auth = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");

async function fetchPage(skip: number, top: number) {
  const url =
    `${URL_BASE}/Catalog_Номенклатура?$format=json` +
    `&$select=Ref_Key,Артикул,Code,Наименование,IsFolder,DeletionMark` +
    `&$skip=${skip}&$top=${top}`;
  const res = await fetch(url, { headers: { Authorization: auth, Accept: "application/json" } });
  if (!res.ok) throw new Error(`OData ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).value as any[];
}

async function main() {
  // Товари, яким на сайті бракує справжнього артикула.
  const need = await prisma.product.findMany({
    where: { sku: { startsWith: "1C-" }, externalId: { not: null } },
    select: { externalId: true, name: true, stock: true },
  });
  const needByRef = new Map(need.map((p) => [p.externalId!, p]));
  console.log(`Товарів без справжнього артикула (з externalId): ${needByRef.size}`);

  let skip = 0, seen = 0;
  let hasArtikul = 0, hasCode = 0, hasNeither = 0;
  const examples: string[] = [];

  for (;;) {
    const rows = await fetchPage(skip, 1000);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.IsFolder) continue;
      const target = needByRef.get(r.Ref_Key);
      if (!target) continue;
      seen++;
      const art = String(r["Артикул"] ?? "").trim();
      const code = String(r.Code ?? "").trim();
      if (art) hasArtikul++;
      else if (code) hasCode++;
      else hasNeither++;
      if (examples.length < 15) {
        examples.push(`  Артикул="${art}"  Code="${code}"  | ${target.name.slice(0, 55)}`);
      }
    }
    skip += rows.length;
    if (rows.length < 1000) break;
  }

  console.log(`\nЗнайдено в 1С із наших «безартикульних»: ${seen}`);
  console.log(`  мають Артикул:          ${hasArtikul}`);
  console.log(`  Артикула нема, є Code:  ${hasCode}`);
  console.log(`  порожні обидва:         ${hasNeither}`);
  console.log("\nПриклади:");
  examples.forEach((e) => console.log(e));

  console.log(
    hasArtikul + hasCode > 0
      ? `\n✓ Артикули в 1С Є. Після виправленої синхронізації вони підтягнуться на сайт.`
      : `\n✗ У 1С теж порожньо — артикули доведеться брати з Impuls.`
  );
}

main().finally(() => prisma.$disconnect());
