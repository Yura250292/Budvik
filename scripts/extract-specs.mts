/**
 * Наповнення атрибутів товару, за якими фільтрує вітрина.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/extract-specs.mts           — звіт покриття
 *   npx tsx --env-file=.env scripts/extract-specs.mts --apply   — записати
 *   npx tsx --env-file=.env scripts/extract-specs.mts --apply --force
 *
 * Правила видобування живуть у src/lib/catalog/attributes.ts, реєстр фасетів —
 * у src/lib/catalog/facets.ts. Тут лише збирання джерел і запис, бо обмін із
 * 1С характеристик не віддає: те, що не витягнуто звідси, у базі не зʼявиться.
 *
 * Джерела за спаданням довіри:
 *   1) характеристики з сайтів виробників (output/vendor-…, свіжа дата, index.json)
 *   2) характеристики з опису товару — булітні й однорядкові
 *   3) назва з 1С — єдине, що покриває весь каталог
 *
 * Для чисел порядок саме такий: структурована пара «Діаметр диска: 125 мм»
 * точніша за вгадування числа серед інших чисел назви. Для живлення —
 * навпаки: «Болгарка акумуляторна» в назві це факт з етикетки, а в описі
 * «акумулятор» трапляється в реченні «акумулятор у комплект не входить».
 *
 * Ідемпотентний: заповнене значення без --force не чіпає, тож повторний
 * прогін після нових каталогів дописує лише порожнє.
 */

import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  attrsFromName,
  attrsFromSpecPairs,
  splitInlineSpecs,
  mergeAttrs,
  type RawAttrs,
} from "../src/lib/catalog/attributes";
import { splitDescription } from "../src/lib/catalog/description-sections";
import { TYPE_LABELS } from "../src/lib/catalog/classify";
import { facetsForType } from "../src/lib/catalog/facets";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

const FIELDS = ["powerSource", "discDiameterMm", "voltageV", "powerWatts"] as const;
type Field = (typeof FIELDS)[number];

/**
 * Які поля взагалі можна писати цій групі товару.
 *
 * Реєстр фасетів вирішує не лише що показувати, а й що зберігати. Без цієї
 * межі регекси розповзаються по всьому каталогу: «Плоскогубці 180 мм» ставали
 * диском Ø180, «Валик 100 мм» — Ø100, а свердла отримували живлення. Числа в
 * назвах є майже скрізь, і без питання «а чи має ця характеристика сенс для
 * цієї полиці» будь-яке з них виглядає як відповідь.
 */
function allowedFields(typeKey: string | null): Set<Field> {
  return new Set(facetsForType(typeKey).map((d) => d.column as Field));
}

/** Характеристики з сайтів виробників: (бренд, артикул) → пари ключ-значення. */
function loadVendorSpecs(): Map<string, { key: string; value: string }[]> {
  const out = new Map<string, { key: string; value: string }[]>();
  const root = "output";
  if (!existsSync(root)) return out;

  for (const dir of readdirSync(root).filter((d) => d.startsWith("vendor-"))) {
    const dates = readdirSync(join(root, dir)).sort();
    if (!dates.length) continue;
    const file = join(root, dir, dates[dates.length - 1], "index.json");
    if (!existsSync(file)) continue;

    const data = JSON.parse(readFileSync(file, "utf8"));
    for (const row of data.rows ?? []) {
      const specs = row.specs;
      if (!specs || !row.article) continue;
      const pairs = Object.entries(specs).map(([key, value]) => ({ key, value: String(value) }));
      if (pairs.length) out.set(String(row.article).trim().toLowerCase(), pairs);
    }
  }
  return out;
}

async function main() {
  const vendorSpecs = loadVendorSpecs();
  console.log(`характеристик із сайтів виробників: ${vendorSpecs.size} артикулів\n`);

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true, sku: true, name: true, description: true, typeKey: true,
      stock: true, price: true,
      powerSource: true, discDiameterMm: true, voltageV: true, powerWatts: true,
    },
  });

  /** Однакові набори змін пишемо одним updateMany. */
  const buckets = new Map<string, string[]>();
  const backup: Record<string, Record<string, unknown>> = {};
  /** Покриття по групах — те, що побачить покупець у панелі фільтрів. */
  const coverage = new Map<string, { total: number; got: Record<Field, number> }>();
  const examples: string[] = [];
  let changed = 0;

  for (const p of products) {
    const shoppable = p.stock > 0 && p.price > 0;

    const allowed = allowedFields(p.typeKey);
    if (allowed.size === 0) continue;

    const fromName = attrsFromName(p.name, p.typeKey);
    const fromVendor = p.sku ? vendorSpecs.get(p.sku.trim().toLowerCase()) : undefined;
    const vendorAttrs = fromVendor ? attrsFromSpecPairs(fromVendor) : {};
    const descPairs = [...splitDescription(p.description).specs, ...splitInlineSpecs(p.description)];
    const descAttrs = descPairs.length ? attrsFromSpecPairs(descPairs) : {};

    const merged: RawAttrs = {
      // Живлення: назва найнадійніша.
      powerSource: mergeAttrs(fromName, vendorAttrs, descAttrs).powerSource,
      // Числа: структурована пара точніша за регекс по назві.
      ...(({ powerSource, ...rest }) => rest)(mergeAttrs(vendorAttrs, descAttrs, fromName)),
    };

    if (shoppable && p.typeKey) {
      let c = coverage.get(p.typeKey);
      if (!c) {
        c = { total: 0, got: { powerSource: 0, discDiameterMm: 0, voltageV: 0, powerWatts: 0 } };
        coverage.set(p.typeKey, c);
      }
      c.total++;
      for (const f of FIELDS) if (allowed.has(f) && merged[f] !== undefined) c.got[f]++;
    }

    const updates: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    for (const f of FIELDS) {
      if (!allowed.has(f)) continue;
      const next = merged[f];
      if (next === undefined) continue;
      // Заповнене руками чи попереднім прогоном не чіпаємо: скрипт добирає
      // порожнє, а не переписує каталог щоразу заново.
      if (!FORCE && p[f] !== null) continue;
      if (p[f] === next) continue;
      updates[f] = next;
      before[f] = p[f];
    }
    if (!Object.keys(updates).length) continue;

    changed++;
    backup[p.id] = before;
    const key = JSON.stringify(updates);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(p.id);

    if (shoppable && examples.length < 20) {
      examples.push(`${p.name}  →  ${Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
  }

  console.log(`активних товарів: ${products.length}`);
  console.log(`отримають значення: ${changed} у ${buckets.size} наборах\n`);

  console.log("покриття по групах (лише те, що в наявності; групи від 5 позицій):");
  const rows = [...coverage.entries()]
    .filter(([, c]) => c.total >= 5 && FIELDS.some((f) => c.got[f] > 0))
    .sort((a, b) => b[1].total - a[1].total);
  for (const [type, c] of rows.slice(0, 30)) {
    const parts = FIELDS.filter((f) => c.got[f] > 0).map((f) => `${f} ${c.got[f]}/${c.total}`);
    console.log(`  ${(TYPE_LABELS[type] ?? type).padEnd(32)} ${parts.join(", ")}`);
  }

  console.log("\nприклади:");
  for (const e of examples) console.log(`  ${e}`);

  if (!APPLY) {
    console.log("\nПроба. Щоб записати: --apply");
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const backupFile = `output/attr-extract-backup-${stamp}.json`;
  writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`\nстарі значення збережено: ${backupFile}`);

  let done = 0;
  for (const [key, ids] of buckets) {
    const data = JSON.parse(key);
    for (let i = 0; i < ids.length; i += 1000) {
      await prisma.product.updateMany({ where: { id: { in: ids.slice(i, i + 1000) } }, data });
    }
    done += ids.length;
  }
  console.log(`записано: ${done}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
