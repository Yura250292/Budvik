/**
 * Закупівлі з поправкою на сезон і без неї — діф. READ ONLY.
 *
 * Показати закупівельникові ДО того, як щось вмикати. Скрипт відповідає
 * на три питання, і жодне з них не риторичне:
 *
 *   1. Чи справді нічого не змінюється, коли профілю немає? Це головна
 *      обіцянка всієї механіки: немає профілю або довіра низька — усі
 *      індекси 1,0, і число збігається зі старим ДО ГРИВНІ. Поки бекфіл
 *      не пройшов, діф має бути порожній. Якщо він не порожній — щось у
 *      запобіжниках не тримає, і далі йти не можна.
 *
 *   2. Скільки позицій змінили рекомендацію і на скільки грошей.
 *
 *   3. Що з'явилось у списку «Готуватися до сезону» — тобто рівно те,
 *      чого сьогодні не видно взагалі.
 *
 *   npx tsx --env-file=.env scripts/check-low-stock-season.mts
 *   npx tsx --env-file=.env scripts/check-low-stock-season.mts --brand=<id>
 *
 * Нічого не пишеться ні в базу сайту, ні в 1С.
 */

import { prisma } from "@/lib/prisma";
import { buildLowStockReport, DEFAULT_PARAMS, type LowStockItem } from "@/lib/procurement/low-stock";

const args = process.argv.slice(2);
const brandId = args.find((a) => a.startsWith("--brand="))?.split("=")[1] ?? null;

const money = (n: number) => n.toLocaleString("uk-UA", { maximumFractionDigits: 0 });

function flatten(report: { sections: Array<{ groups: Array<{ items: LowStockItem[] }> }> }): Map<string, LowStockItem> {
  const map = new Map<string, LowStockItem>();
  for (const s of report.sections) for (const g of s.groups) for (const i of g.items) map.set(i.id, i);
  return map;
}

async function main() {
  const base = { brandId, ...DEFAULT_PARAMS };

  const withSeason = await buildLowStockReport({ ...base, season: true });
  const without = await buildLowStockReport({ ...base, season: false });
  if (!withSeason || !without) {
    console.log("Звіт не побудувався — перевірте brandId.");
    return;
  }

  const a = flatten(without);
  const b = flatten(withSeason);

  const changed: Array<{ item: LowStockItem; before: number }> = [];
  for (const [id, item] of b) {
    const old = a.get(id);
    if (old && old.suggested !== item.suggested) changed.push({ item, before: old.suggested });
  }

  console.log(`Позицій у звіті: ${b.size}`);
  console.log(`До замовлення: ${without.toOrder} → ${withSeason.toOrder}`);
  console.log(`Сума закупівлі: ${money(without.orderCost)} ₴ → ${money(withSeason.orderCost)} ₴`);
  console.log(`Змінили рекомендацію: ${changed.length}`);
  console.log(`«Готуватися до сезону»: ${withSeason.seasonWatch.length}`);

  if (changed.length === 0 && withSeason.seasonWatch.length === 0) {
    console.log("\n✅ Діф порожній — профілів ще немає, і сезон нічого не чіпає.");
    console.log("   Саме так і має бути до бекфілу: механіка вже стоїть, але мовчить.");
  }

  if (changed.length > 0) {
    console.log("\n=== Найбільші зміни ===");
    changed
      .sort((x, y) => Math.abs(y.item.suggested - y.before) - Math.abs(x.item.suggested - x.before))
      .slice(0, 20)
      .forEach(({ item, before }) => {
        const sign = item.suggested > before ? "↑" : "↓";
        console.log(
          `${sign} ${item.name.slice(0, 48).padEnd(50)} ${String(before).padStart(5)} → ${String(item.suggested).padStart(5)}` +
            `  ×${item.seasonFactor} (${item.seasonFrom ?? "—"})`
        );
      });
  }

  if (withSeason.seasonWatch.length > 0) {
    console.log("\n=== Готуватися до сезону (сьогодні цих позицій не видно взагалі) ===");
    for (const i of withSeason.seasonWatch.slice(0, 20)) {
      console.log(
        `${i.name.slice(0, 48).padEnd(50)} залишок ${String(i.stock).padStart(4)}` +
          `  замовити ${String(i.suggested).padStart(4)}  ×${i.seasonFactor} (${i.seasonFrom})`
      );
    }
  }

  console.log("\nREAD ONLY: nothing was written.");
}

main().finally(() => prisma.$disconnect());
