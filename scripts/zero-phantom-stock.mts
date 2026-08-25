/**
 * Разове обнулення «фантомного» залишку: товари, які показують наявність на
 * сайті, але жодного разу не траплялися в регістрі залишків 1С.
 *
 * Постійне лікування живе в обміні (reconcileStock → zeroOrphans) і спрацює
 * на найближчому нічному повному прогоні. Цей скрипт потрібен, щоб вітрина
 * перестала обіцяти неіснуючий товар уже сьогодні, а не завтра вранці.
 *
 * Перед записом складає бекап (id, артикул, назва, старий залишок) у JSON
 * поруч зі скриптом — відкотити можна тим самим файлом.
 *
 * Підстава: проба 1С від 25.08.2026 (agent/ps/gen-probe-stock-orphans.py)
 * показала по п'яти зразках прихід і розхід на справжніх складах при
 * нульовому кінцевому залишку — тобто товар розпроданий, а не транзитний.
 *
 *   npx tsx -r dotenv/config scripts/zero-phantom-stock.mts dotenv_config_path=.env
 *   npx tsx -r dotenv/config scripts/zero-phantom-stock.mts --apply dotenv_config_path=.env
 */

import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

type Row = { id: string; sku: string | null; name: string; stock: number; price: number };

async function main() {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT p.id, p.sku, p.name, p.stock, p.price
    FROM "Product" p
    WHERE p."isActive"
      AND p.stock > 0
      AND p."externalId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "LocationStock" ls
        JOIN "StockLocation" sl ON sl.id = ls."stockLocationId"
        WHERE ls."productId" = p.id AND sl."isService" = false
      )
    ORDER BY p.stock DESC
  `;

  const units = rows.reduce((s, r) => s + r.stock, 0);
  const money = rows.reduce((s, r) => s + r.stock * (r.price ?? 0), 0);
  console.log(`Кандидатів: ${rows.length} позицій, ${units} шт, ${Math.round(money)} ₴ за прайсом`);
  for (const r of rows.slice(0, 5)) {
    console.log(`  ${(r.sku ?? "—").padEnd(14)} ${String(r.stock).padStart(5)} шт  ${r.name.slice(0, 60)}`);
  }

  if (!apply) {
    console.log("\nПроба без запису. Щоб застосувати — додайте --apply");
    return;
  }

  const backup = `scripts/backup-phantom-stock-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(backup, JSON.stringify(rows, null, 2), "utf8");
  console.log(`Бекап: ${backup}`);

  const CHUNK = 500;
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ids = rows.slice(i, i + CHUNK).map((r) => r.id);
    const res = await prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { stock: 0, syncedAt: new Date(), syncSource: "1C" },
    });
    done += res.count;
  }
  console.log(`Обнулено: ${done}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
