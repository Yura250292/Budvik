/**
 * Піднімає роздрібну ціну там, де вона не вища за закупівельну.
 *
 * Перевірка вітрини 08.09.2026: 973 показних товари (15% каталогу) коштували
 * на сайті менше або стільки ж, скільки закупівля. APRO Гвинт-шуруп M10×100 —
 * 7,09 ₴ при опті 7,36 ₴; APRO Рулетка 5 м — 188,28 при 195,50. Це не помилка
 * показу: товар кладеться в кошик і замовляється саме за цією ціною.
 *
 * Чому так вийшло: обмін брав ціну «6.МАГАЗИНИ» з 1С як є. Там, де роздріб не
 * переглядали роками, а опт за той час зріс, роздріб опинився нижче.
 *
 * Що робить скрипт: рахує роздріб тим самим правилом, яким сайт уже рахує
 * ціну для брендів без «6.МАГАЗИНИ» — опт × коефіцієнт бренду
 * (Brand.retailMarkup, типово 1,3; див. src/lib/pricing/retail-markup.ts) —
 * і ставить `priceDerived = true`, щоб справжній роздріб із 1С витіснив
 * розрахунковий, щойно з'явиться.
 *
 * Ціна тільки зростає: жоден товар не дешевшає. Щоб проблема не поверталась,
 * та сама перевірка вбудована в обмін (src/lib/sync-ingest/apply-prices.ts).
 *
 * У 1С не пишемо нічого — виправлення на боці сайту (CLAUDE.md).
 *
 *   npx tsx --env-file=.env scripts/fix-retail-below-cost.mts          # проба
 *   npx tsx --env-file=.env scripts/fix-retail-below-cost.mts --apply  # застосувати
 *
 * Відкат: backup-retail-below-cost-<дата>.json поруч зі скриптом.
 */

import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveRetailPrice, effectiveMarkup } from "../src/lib/pricing/retail-markup";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
/**
 * Межа підвищення. Без неї скрипт «виправляє» і випадки, де брехливий не
 * роздріб, а опт: POLAX Ключ трубний 3/4" коштує 41 ₴ при «опті» 330 ₴, і
 * розрахунок підняв би його до 429 ₴ — у десять разів. Такий стрибок означає
 * помилку в обліку, а не занижену ціну, і його має дивитись людина.
 *
 *   --max-factor=1.5   підняти лише те, що дорожчає не більш ніж у 1,5 раза
 */
const MAX_FACTOR = (() => {
  const arg = process.argv.find((a) => a.startsWith("--max-factor="));
  const v = arg ? Number(arg.split("=")[1]) : NaN;
  return Number.isFinite(v) && v > 1 ? v : Infinity;
})();
const HERE = dirname(fileURLToPath(import.meta.url));

async function main() {
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      price: { gt: 0 },
      wholesalePrice: { gt: 0 },
    },
    select: {
      id: true, sku: true, name: true, slug: true, price: true, wholesalePrice: true,
      stock: true, priceDerived: true,
      brand: { select: { name: true, retailMarkup: true } },
    },
  });

  const bad = products.filter((p) => p.price <= (p.wholesalePrice ?? 0));
  const shown = bad.filter((p) => p.stock > 0);

  const plan = bad.map((p) => {
    const next = deriveRetailPrice(p.wholesalePrice!, p.brand?.retailMarkup);
    return {
      id: p.id, sku: p.sku, name: p.name, slug: p.slug,
      brand: p.brand?.name ?? "(без бренда)",
      markup: effectiveMarkup(p.brand?.retailMarkup),
      stock: p.stock,
      from: p.price, wholesale: p.wholesalePrice!, to: next,
      delta: next - p.price,
    };
  }).filter((x) => x.to > x.from);

  const withinLimit = plan.filter((x) => x.to / x.from <= MAX_FACTOR);

  console.log(`Активних товарів із опт-ціною: ${products.length}`);
  console.log(`З них роздріб ≤ опт: ${bad.length} (у наявності: ${shown.length})`);
  console.log(`Можемо підняти: ${plan.length}\n`);

  const byBrand = new Map<string, { n: number; markup: number }>();
  for (const x of plan) {
    const b = byBrand.get(x.brand) ?? { n: 0, markup: x.markup };
    b.n++; byBrand.set(x.brand, b);
  }
  console.log("По брендах:");
  for (const [b, v] of [...byBrand.entries()].sort((a, b2) => b2[1].n - a[1].n).slice(0, 12)) {
    console.log(`   ${String(v.n).padStart(4)}  ${b} (коефіцієнт ${v.markup})`);
  }

  const buckets = { "до +30%": 0, "+30…100%": 0, "у 2–3 рази": 0, "більш ніж утричі": 0 };
  for (const x of plan) {
    const f = x.to / x.from;
    if (f <= 1.3) buckets["до +30%"]++;
    else if (f <= 2) buckets["+30…100%"]++;
    else if (f <= 3) buckets["у 2–3 рази"]++;
    else buckets["більш ніж утричі"]++;
  }
  console.log("\nНаскільки зростає ціна:");
  for (const [k, v] of Object.entries(buckets)) console.log(`   ${k.padEnd(18)} ${v}`);
  console.log(
    "\nСтрибок у два рази й більше майже завжди означає, що бреше ОПТ, а не роздріб —\n" +
    "такі позиції варто звірити в 1С руками. Обмежити: --max-factor=1.5"
  );

  const avgUp = plan.reduce((s, x) => s + (x.to / x.from - 1), 0) / (plan.length || 1);
  console.log(`\nСереднє підвищення: ${(avgUp * 100).toFixed(1)}%`);
  if (MAX_FACTOR !== Infinity) console.log(`Під межу --max-factor=${MAX_FACTOR} потрапляє: ${withinLimit.length}`);
  console.log("Приклади:");
  for (const x of plan.slice(0, 10)) {
    console.log(`   ${x.from.toFixed(2)} → ${x.to.toFixed(2)} ₴ (опт ${x.wholesale.toFixed(2)})  ${x.name.slice(0, 52)}`);
  }

  if (!APPLY) {
    console.log("\nПроба. Щоб застосувати — той самий виклик із --apply");
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const backup = join(HERE, `backup-retail-below-cost-${stamp}.json`);
  writeFileSync(backup, JSON.stringify(withinLimit, null, 2));
  console.log(`\nРезервна копія: ${backup}`);

  let done = 0;
  for (const x of withinLimit) {
    await prisma.product.update({
      where: { id: x.id },
      data: { price: x.to, priceDerived: true },
    });
    done++;
    if (done % 100 === 0) process.stderr.write(`\r${done}/${withinLimit.length}`);
  }
  console.log(`\nОновлено цін: ${done}. Жодна ціна не зменшилась.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
