/**
 * Разовий розбір кратності з назв номенклатури в Product.packQty.
 *
 *   npx tsx scripts/backfill-pack-qty.ts          — покаже, що зміниться
 *   npx tsx scripts/backfill-pack-qty.ts --apply  — запише
 *
 * Скрипт ідемпотентний: запускати повторно після синхронізації з 1С безпечно.
 * Кратність, виставлену вручну в адмінці, не чіпає — див. --force.
 */
import { prisma } from "@/lib/prisma";
import { parsePackQty } from "@/lib/pack-qty";

const APPLY = process.argv.includes("--apply");
// За замовчуванням не перезаписуємо вже проставлену кратність: її могли
// виправити руками в адмінці, а назва з 1С лишилась кривою.
const FORCE = process.argv.includes("--force");

async function main() {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, packQty: true },
  });

  const changes: { id: string; name: string; from: number | null; to: number }[] = [];
  const byPack = new Map<number, number>();

  for (const p of products) {
    const pack = parsePackQty(p.name);
    if (!pack) continue;
    byPack.set(pack, (byPack.get(pack) ?? 0) + 1);
    if (p.packQty === pack) continue;
    if (p.packQty != null && !FORCE) continue;
    changes.push({ id: p.id, name: p.name, from: p.packQty, to: pack });
  }

  console.log(`Товарів усього: ${products.length}`);
  console.log(`Розпізнано кратність: ${[...byPack.values()].reduce((a, b) => a + b, 0)}`);
  console.log("Розподіл:");
  for (const [pack, cnt] of [...byPack].sort((a, b) => b[1] - a[1])) {
    console.log(`  по ${String(pack).padStart(4)} шт — ${cnt}`);
  }
  console.log(`\nДо запису: ${changes.length}`);
  for (const c of changes.slice(0, 20)) {
    console.log(`  ${c.from ?? "—"} → ${c.to}  ${c.name.slice(0, 90)}`);
  }

  if (!APPLY) {
    console.log("\nПробний запуск. Додай --apply, щоб записати.");
    return;
  }

  let done = 0;
  for (const c of changes) {
    await prisma.product.update({ where: { id: c.id }, data: { packQty: c.to } });
    if (++done % 100 === 0) console.log(`  записано ${done}/${changes.length}`);
  }
  console.log(`Готово: оновлено ${done} товарів.`);
}

main().finally(() => prisma.$disconnect());
