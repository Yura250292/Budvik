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
import { PrismaClient, Prisma } from "@prisma/client";

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
6. Бренд не починається з числа і не є номером позиції: "12 Atelie",
   "3 ІНШІ" -> null. Якщо сумніваєшся — null.

Приклади:
  "SIGMA Коронка біметалева Ø18мм" -> "SIGMA"
  "Свердло по металу HSS Bosch 5мм" -> "Bosch"
  "Диск відрізний по металу 125х1.0" -> null
  "Рукавиці робочі х/б" -> null
  "Шуруповерт акумуляторний Makita DF331D" -> "Makita"

Відповідай ВИКЛЮЧНО JSON-масивом, без пояснень:
[{"index":1,"brand":"SIGMA"},{"index":2,"brand":null}]`;

/**
 * Ключ для об'єднання варіантів написання одного бренду.
 *
 * Проба показала три способи роздвоїти статистику:
 *   «Syper Oil» і «SyperOil»   — пробіл;
 *   «СИЛА» і «CИЛА»            — латинська C замість кириличної С;
 *   «Sigma» і «SIGMA»          — регістр.
 * Усі троє в реальних назвах цієї бази трапляються.
 */
function brandKey(name: string): string {
  const stripped = name.toLowerCase().replace(/[\s\-_.]+/g, "");

  // Латиницю зводимо до кирилиці ЛИШЕ у змішаних написаннях на кшталт
  // «CИЛА» (латинська C + кирилиця). Чисто латинські бренди чіпати не можна:
  // «Bosch» після такої заміни став би кирилицею і зіллявся б із випадковим
  // сусідом.
  const hasCyrillic = /[а-яіїєґ]/.test(stripped);
  const hasLatin = /[a-z]/.test(stripped);
  if (!hasCyrillic || !hasLatin) return stripped;

  const lookalikes: Record<string, string> = {
    c: "с", e: "е", o: "о", p: "р", a: "а", x: "х", y: "у",
    k: "к", b: "в", h: "н", t: "т", m: "м", i: "і",
  };
  return stripped
    .split("")
    .map((ch) => lookalikes[ch] ?? ch)
    .join("");
}

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

  // нормалізований ключ -> { як показувати, які товари }
  const found = new Map<string, { display: string; ids: string[] }>();
  let processed = 0;

  // --from-cache пропускає запити до моделі й бере попередній результат.
  // Потрібно, коли розпізнавання відпрацювало, а запис у базу впав: платити
  // за ті самі 515 запитів удруге безглуздо.
  if (process.argv.includes("--from-cache")) {
    const { readFileSync } = await import("node:fs");
    const cached: Array<{ key: string; display: string; ids: string[] }> = JSON.parse(
      readFileSync("/tmp/budvik-brands-detected.json", "utf8")
    );
    for (const c of cached) found.set(c.key, { display: c.display, ids: c.ids });
    console.log(`Прочитано з кешу: ${cached.length} брендів`);
  } else {

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
      // Групуємо за нормалізованим ключем, а показуємо перше зустрінуте
      // написання: інакше «Syper Oil» і «SyperOil» стали б двома брендами.
      const key = brandKey(brand);
      const entry = found.get(key);
      if (entry) entry.ids.push(chunk[idx].id);
      else found.set(key, { display: brand, ids: [chunk[idx].id] });
    }

    processed += chunk.length;
    process.stdout.write(`\r  оброблено ${processed}/${products.length}`);
  }
  }

  // Результат розпізнавання — найдорожче в цьому скрипті (сотні запитів до
  // моделі). Зберігаємо на диск ДО запису в базу: якщо запис упаде, повторний
  // прогін піде з файлу замість того, щоб платити вдруге.
  const cachePath = "/tmp/budvik-brands-detected.json";
  try {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      cachePath,
      JSON.stringify([...found.entries()].map(([k, v]) => ({ key: k, ...v })), null, 2)
    );
    console.log(`\n(результат збережено: ${cachePath})`);
  } catch {
    // Кеш — зручність, а не вимога: не зміг записати, працюємо далі.
  }

  console.log("\n");
  console.log("── Знайдені бренди ──");
  const sorted = [...found.values()].sort((a, b) => b.ids.length - a.ids.length);
  for (const b of sorted) {
    console.log(`  ${b.display.padEnd(22)} ${b.ids.length}`);
  }
  const totalMatched = sorted.reduce((s, v) => s + v.ids.length, 0);
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
  const worthKeeping = sorted.filter((b) => b.ids.length >= MIN_PRODUCTS);
  console.log(`Заводжу бренди з ${MIN_PRODUCTS}+ товарами: ${worthKeeping.length}`);

  let written = 0;
  for (const { display: brandName, ids } of worthKeeping) {
    // upsert шукає за name, але впасти може на slug: «B+D» і «B D» дають
    // однаковий slug, хоча це різні назви. Тому спершу шукаємо наявний
    // бренд і за назвою, і за слугом, а при створенні тримаємо напоготові
    // запасний slug.
    const baseSlug = slugify(brandName) || `brand-${brandKey(brandName)}`;

    let brand = await prisma.brand.findFirst({
      where: { OR: [{ name: brandName }, { slug: baseSlug }] },
      select: { id: true, name: true },
    });

    if (!brand) {
      for (const attempt of [0, 1]) {
        const trySlug = attempt === 0 ? baseSlug : `${baseSlug}-${brandKey(brandName).slice(0, 6)}`;
        try {
          brand = await prisma.brand.create({
            data: {
              name: brandName,
              slug: trySlug,
              matchPatterns: [brandName.toLowerCase()],
            },
            select: { id: true, name: true },
          });
          break;
        } catch (e) {
          const conflict =
            e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
          if (!conflict || attempt === 1) {
            console.error(`  ! ${brandName}: ${(e as Error).message.split("\n").pop()}`);
            break;
          }
        }
      }
    }

    if (!brand) continue;

    for (let i = 0; i < ids.length; i += 5000) {
      await prisma.product.updateMany({
        where: { id: { in: ids.slice(i, i + 5000) } },
        data: { brandId: brand.id },
      });
    }
    written += ids.length;
    console.log(`  ${brandName}: ${ids.length}`);
  }
  console.log(`\nГотово. Прив'язано товарів: ${written}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
