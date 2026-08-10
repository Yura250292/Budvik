/**
 * Розпізнавання брендів у назвах товарів через модель.
 *
 * Навіщо: ручні патерни (scripts/seed-brands.ts) покрили 18 068 із 41 940
 * товарів і більше не зростуть — у решти назва починається з типу товару
 * («Свердло», «Ключ»), а бренд стоїть усередині, в кінці або відсутній.
 * Модель читає назву цілком і бачить «Bosch» у «Свердло по металу HSS
 * Bosch 5мм», чого пошук за початком рядка не вміє.
 *
 * Разова задача: результат пишеться в Product.brandId, а нові товари далі
 * підхоплюються синхронізацією за matchPatterns уже відомих брендів.
 *
 * Головна пастка — вигадування. Модель охоче напише «Stanley» для
 * «Терка нержавіюча з дерев'яною ручкою», бо це звучить правдоподібно.
 * Тому в промпті жорстке «не знаєш — null», а результат перевіряється:
 * назва бренду мусить дослівно міститися в назві товару, інакше відкидаємо.
 *
 * Запуск:
 *   npx tsx scripts/detect-brands-ai.ts --limit 100     — проба на сотні
 *   npx tsx scripts/detect-brands-ai.ts                 — усі, без запису
 *   npx tsx scripts/detect-brands-ai.ts --apply         — усі, із записом
 */

import Anthropic from "@anthropic-ai/sdk";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const anthropic = new Anthropic();

const MODEL = "claude-sonnet-5";
const CHUNK = 60;

type Detected = { index: number; brand: string | null };

const SYSTEM_PROMPT = `Ти визначаєш ВИРОБНИКА (бренд) у назвах товарів будівельного магазину.

На вхід — пронумерований список назв. Для кожної поверни бренд або null.

ПРАВИЛА:
1. Бренд має бути ДОСЛІВНО присутній у назві. Не здогадуйся за типом товару.
2. Якщо бренду в назві немає — null. Це нормально і найчастіший випадок:
   "Терка нержавіюча з дерев'яною ручкою" -> null
   "Свердло по металу 5мм" -> null
3. Тип товару, матеріал, розмір, колір — НЕ бренд:
   "Ключ ріжковий", "Нержавійка", "125мм", "синій" -> це не бренди.
4. Абревіатури й моделі теж не бренди: "HSS", "SDS-plus", "Cr-V", "P80".
5. Пиши бренд рівно так, як він у назві (регістр зберігай).

Приклади:
  "SIGMA Коронка біметалева Ø18мм" -> "SIGMA"
  "Свердло по металу HSS Bosch 5мм" -> "Bosch"
  "Диск відрізний по металу 125х1.0" -> null
  "Рукавиці робочі х/б" -> null
  "Шуруповерт акумуляторний Makita DF331D" -> "Makita"

Відповідай ВИКЛЮЧНО JSON-масивом, без пояснень:
[{"index":1,"brand":"SIGMA"},{"index":2,"brand":null}]`;

function slugify(name: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh",
    з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
    о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ö: "o", ü: "u", ä: "a",
  };
  return name
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function detectChunk(names: string[]): Promise<Map<number, string>> {
  const numbered = names.map((n, i) => `${i + 1}. ${n}`).join("\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: numbered }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Модель іноді обгортає JSON у ```json ... ```
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return new Map();

  let parsed: Detected[];
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return new Map();
  }

  const result = new Map<number, string>();
  for (const item of parsed) {
    if (!item.brand || typeof item.brand !== "string") continue;
    const idx = item.index - 1;
    if (idx < 0 || idx >= names.length) continue;

    const brand = item.brand.trim();
    if (brand.length < 2) continue;

    // Перевірка проти вигадування: бренд мусить дослівно бути в назві.
    // Без неї модель приписує правдоподібні, але вигадані назви — і такий
    // товар потрапив би в чужу статистику, а помітити це майже неможливо.
    if (!names[idx].toLowerCase().includes(brand.toLowerCase())) continue;

    result.set(idx, brand);
  }
  return result;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : undefined;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Потрібен ANTHROPIC_API_KEY у середовищі.");
    process.exit(1);
  }

  const products = await prisma.product.findMany({
    where: { brandId: null },
    select: { id: true, name: true },
    ...(limit ? { take: limit } : {}),
  });

  console.log(`Товарів без бренду: ${products.length}`);
  console.log(`Пачками по ${CHUNK}, запитів: ${Math.ceil(products.length / CHUNK)}`);
  console.log("");

  const found = new Map<string, string[]>(); // бренд -> product ids
  let processed = 0;

  for (let i = 0; i < products.length; i += CHUNK) {
    const chunk = products.slice(i, i + CHUNK);
    let detected: Map<number, string>;
    try {
      detected = await detectChunk(chunk.map((p) => p.name));
    } catch (e) {
      console.error(`\n  пачка ${i / CHUNK + 1} впала: ${(e as Error).message}`);
      continue;
    }

    for (const [idx, brand] of detected) {
      const list = found.get(brand);
      if (list) list.push(chunk[idx].id);
      else found.set(brand, [chunk[idx].id]);
    }

    processed += chunk.length;
    process.stdout.write(`\r  оброблено ${processed}/${products.length}`);
  }

  console.log("\n");
  console.log("── Знайдені бренди ──");
  const sorted = [...found.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [brand, ids] of sorted) {
    console.log(`  ${brand.padEnd(20)} ${ids.length}`);
  }
  const totalMatched = [...found.values()].reduce((s, v) => s + v.length, 0);
  console.log("");
  console.log(`  розпізнано:    ${totalMatched}`);
  console.log(`  без бренду:    ${products.length - totalMatched}`);
  console.log("");

  if (!apply) {
    console.log("Це був перегляд. Щоб записати, додайте --apply");
    return;
  }

  // Бренди з одним-двома товарами майже завжди сміття: випадкове слово,
  // що збіглося. Заводити їх у довідник означає засмітити його сотнями
  // одноразових записів.
  const MIN_PRODUCTS = 3;
  const worthKeeping = sorted.filter(([, ids]) => ids.length >= MIN_PRODUCTS);
  console.log(`Заводжу бренди з ${MIN_PRODUCTS}+ товарами: ${worthKeeping.length}`);

  for (const [brandName, ids] of worthKeeping) {
    const brand = await prisma.brand.upsert({
      where: { name: brandName },
      create: {
        name: brandName,
        slug: slugify(brandName) || `brand-${Date.now()}`,
        matchPatterns: [brandName.toLowerCase()],
      },
      update: {},
      select: { id: true },
    });

    for (let i = 0; i < ids.length; i += 5000) {
      await prisma.product.updateMany({
        where: { id: { in: ids.slice(i, i + 5000) } },
        data: { brandId: brand.id },
      });
    }
    console.log(`  ${brandName}: ${ids.length}`);
  }
  console.log("\nГотово.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
