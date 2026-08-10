/**
 * Заповнення довідника брендів і прив'язка до нього товарів.
 *
 * Навіщо: модель Brand у схемі є (з matchPatterns і externalId), але таблиця
 * порожня, а brandId не проставлений у жодного з 41 940 товарів. Без цього
 * неможлива аналітика «хто скільки продав якого бренду» — головна мета
 * надбудови.
 *
 * Бренд визначається за назвою товару. Це не ідеально, але в 1С окремого
 * реквізиту бренду немає (перевірено пробою probe-brand.ps1), а назви тут
 * дисципліновані: бренд стоїть першим словом у 80% позицій.
 *
 * matchPatterns зберігаються в базі, тому наступний імпорт зможе переприв'язати
 * нові товари тим самим правилом, не запускаючи цей скрипт заново.
 *
 * Запуск:
 *   npx tsx scripts/seed-brands.ts            — показати, що зробив би
 *   npx tsx scripts/seed-brands.ts --apply    — записати
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Бренди й рядки для розпізнавання.
 *
 * Порядок має значення: перший збіг виграє, тому довші й конкретніші
 * патерни мають стояти перед коротшими. "DNIPRO-М" з кириличною М — не
 * помилка: у базі трапляються обидва написання.
 */
const BRANDS: Array<{ name: string; patterns: string[]; color?: string; priority?: number }> = [
  { name: "SIGMA", patterns: ["sigma"], color: "#E63946", priority: 1 },
  { name: "APRO", patterns: ["apro"], color: "#457B9D", priority: 2 },
  { name: "СИЛА", patterns: ["сила "], color: "#F4A261", priority: 3 },
  { name: "DNIPRO-M", patterns: ["dnipro-m", "dnipro-м", "дніпро-м"], color: "#2A9D8F", priority: 4 },
  { name: "STIHL", patterns: ["stihl"], color: "#E76F51", priority: 5 },
  { name: "UNIFIX", patterns: ["unifix"], color: "#264653", priority: 6 },
  { name: "STREND PRO", patterns: ["strend"], color: "#8AB17D", priority: 7 },
  { name: "Grösser", patterns: ["grösser", "grosser", "гроссер"], color: "#6D597A", priority: 8 },
  { name: "REVOLT", patterns: ["revolt"], color: "#B56576", priority: 9 },
  { name: "EINHELL", patterns: ["einhell"], color: "#E56B6F", priority: 10 },
  { name: "ПРОТОН", patterns: ["протон"], color: "#355070", priority: 11 },
  { name: "DWT", patterns: ["dwt "], color: "#EAAC8B", priority: 12 },
  { name: "CROWN", patterns: ["crown"], color: "#7209B7", priority: 13 },
  { name: "GTM", patterns: ["gtm "], color: "#4361EE", priority: 14 },
  { name: "POLAX", patterns: ["polax"], color: "#4CC9F0", priority: 15 },
  { name: "GRAD", patterns: ["grad "], color: "#F72585", priority: 16 },
  { name: "ULTRA", patterns: ["ultra "], color: "#3A0CA3", priority: 17 },
  { name: "MAGTOOLS", patterns: ["magtools"], color: "#480CA8", priority: 18 },
  { name: "NAKAMURA", patterns: ["nakamura"], color: "#B5179E", priority: 19 },
  { name: "FORESTA", patterns: ["foresta"], color: "#560BAD", priority: 20 },
];

function slugify(name: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh",
    з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
    о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ö: "o",
  };
  return name
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  const apply = process.argv.includes("--apply");

  const products = await prisma.product.findMany({
    select: { id: true, name: true, brandId: true },
  });
  console.log(`Товарів: ${products.length}`);

  // Перший збіг виграє, тож порядок як у BRANDS.
  const matches = new Map<string, string[]>(); // brand name -> product ids
  let unmatched = 0;

  for (const p of products) {
    const lower = ` ${p.name.toLowerCase()} `;
    const brand = BRANDS.find((b) => b.patterns.some((pat) => lower.includes(pat)));
    if (!brand) {
      unmatched++;
      continue;
    }
    const list = matches.get(brand.name);
    if (list) list.push(p.id);
    else matches.set(brand.name, [p.id]);
  }

  console.log("");
  console.log("── Розподіл за брендами ──");
  const sorted = [...matches.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [name, ids] of sorted) {
    console.log(`  ${name.padEnd(12)} ${ids.length}`);
  }
  console.log(`  ${"(без бренду)".padEnd(12)} ${unmatched}`);
  console.log("");

  if (!apply) {
    console.log("Це був перегляд. Щоб записати, додайте --apply");
    return;
  }

  console.log("Створюю бренди...");
  const brandIdByName = new Map<string, string>();
  for (const b of BRANDS) {
    if (!matches.has(b.name)) continue; // бренд без товарів не заводимо
    const brand = await prisma.brand.upsert({
      where: { name: b.name },
      create: {
        name: b.name,
        slug: slugify(b.name),
        matchPatterns: b.patterns,
        color: b.color,
        priority: b.priority ?? 0,
      },
      update: { matchPatterns: b.patterns, color: b.color, priority: b.priority ?? 0 },
      select: { id: true },
    });
    brandIdByName.set(b.name, brand.id);
  }
  console.log(`  створено/оновлено: ${brandIdByName.size}`);

  console.log("Прив'язую товари...");
  let done = 0;
  for (const [name, ids] of matches) {
    const brandId = brandIdByName.get(name);
    if (!brandId) continue;
    // updateMany одним запитом на бренд: по товару окремо було б 40 тисяч
    // рейсів через проксі.
    for (let i = 0; i < ids.length; i += 5000) {
      await prisma.product.updateMany({
        where: { id: { in: ids.slice(i, i + 5000) } },
        data: { brandId },
      });
    }
    done += ids.length;
    process.stdout.write(`\r  ${done}`);
  }
  console.log("\nГотово.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
