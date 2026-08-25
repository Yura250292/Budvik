/**
 * Характеристики Grösser з каталогу — в описи товарів.
 *
 * У каталозі таблиця характеристик — картинка, а не текст (файл зроблено з
 * Excel). Тому читаємо її зором: Claude повертає рядки «ключ: значення» і
 * кілька числових полів окремо.
 *
 * Куди пишемо: в кінець `description` секцією «Характеристики:» з пунктами
 * «• ключ: значення». Саме такий формат розбирає `splitDescription`
 * (src/lib/catalog/description-sections.ts) і показує карткою під фото —
 * нічого нового в UI не треба. Проза опису лишається недоторканою; повторний
 * запуск замінює лише свою секцію, тому скрипт безпечний до перезапуску.
 *
 * Числові поля (`powerWatts`, `rpm`, `discDiameterMm`, `chuckMm`, `weightKg`)
 * заповнюємо лише там, де модель повернула однозначне число: вони живлять
 * порівняння товарів і фільтри, і сміття в них шкідливіше за порожнечу. Для
 * діапазонів («0–1700 об/хв», «1,3–13 мм») беремо верхню межу — саме її
 * очікує побачити покупець у стовпчику «обертів».
 *
 * Напругу акумулятора у ватах НЕ вигадуємо: у 20-вольтового інструмента
 * потужності в каталозі просто немає, і 20 у `powerWatts` — брехня.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/grosser-catalog/specs-to-descriptions.mts            # 5 штук, показати
 *   npx tsx --env-file=.env scripts/grosser-catalog/specs-to-descriptions.mts --limit 50
 *   npx tsx --env-file=.env scripts/grosser-catalog/specs-to-descriptions.mts --apply
 *   --force   перечитати й перезаписати навіть тих, у кого секція вже є
 */
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : APPLY ? Infinity : 5;
const CONCURRENCY = 4;
const HEADING = "Характеристики:";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY не заданий");
const anthropic = new Anthropic({ apiKey });

const SpecsSchema = z.object({
  rows: z.array(z.object({ key: z.string(), value: z.string() })),
  powerWatts: z.number().nullable(),
  rpm: z.number().nullable(),
  discDiameterMm: z.number().nullable(),
  chuckMm: z.number().nullable(),
  weightKg: z.number().nullable(),
});
type Specs = z.infer<typeof SpecsSchema>;

const PROMPT = `На зображенні — таблиця характеристик товару з офіційного каталогу Grösser (українською).

Перепиши ВСІ рядки таблиці у поле rows: key — назва характеристики без одиниці виміру («Напруга акумулятора»), value — значення разом з одиницею («20 В»). Одиницю бери із заголовка рядка, якщо вона там («Ємність акумулятора, А-год» + «2.0» → key «Ємність акумулятора», value «2.0 А·год»). Порядок рядків збережи. Десятковий роздільник — кома. Нічого не додавай від себе і не перекладай.

Окремо заповни числові поля, і ТІЛЬКИ якщо відповідне значення справді є в таблиці:
- powerWatts — потужність у ватах. Напруга акумулятора (В) це НЕ потужність: якщо ватів у таблиці немає, став null.
- rpm — обороти на хвилину. Діапазон або дві швидкості («0-450/0-1700») → більше число.
- discDiameterMm — діаметр диска, різання або шини в міліметрах.
- chuckMm — діаметр патрона в міліметрах, для діапазону («1,3-13») → більше число.
- weightKg — вага в кілограмах.
Значення в інших одиницях переводь (см → мм). Якщо характеристики немає — null.`;

let inTokens = 0;
let outTokens = 0;

async function readSpecs(url: string): Promise<Specs | null> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer()).toString("base64");
  const out = await anthropic.messages.parse({
    model: "claude-opus-5",
    max_tokens: 4000,
    output_config: { format: zodOutputFormat(SpecsSchema), effort: "low" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  inTokens += out.usage.input_tokens;
  outTokens += out.usage.output_tokens;
  return out.parsed_output;
}

/** Опис без нашої секції — щоб повторний запуск не плодив «Характеристики:» одну під одною. */
function stripSection(description: string): string {
  const lines = description.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() !== HEADING.toLowerCase()) {
      out.push(lines[i]);
      continue;
    }
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (!/^\s*[•·‣▪–—-]\s+/.test(lines[j])) break;
    }
    i = j - 1;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Полагодити «Gr?sser» у прозі описів: попередній генератор описів загубив
 * умлаут, і в базі лишились товари з питальником посеред назви бренду.
 */
function fixMojibake(text: string): string {
  return text.replace(/Gr\?sser/g, "Grösser");
}

function compose(description: string, specs: Specs): string {
  const rows = specs.rows.filter((r) => r.key.trim() && r.value.trim());
  if (rows.length < 2) return fixMojibake(description); // одному рядку картка не потрібна
  const section = [HEADING, ...rows.map((r) => `• ${r.key.trim()}: ${r.value.trim()}`)].join("\n");
  const base = fixMojibake(stripSection(description));
  return base ? `${base}\n\n${section}` : section;
}

// ── товари з таблицею характеристик у каталозі ──────────────────────────────
const latest = (await (await fetch(`${process.env.R2_PUBLIC_URL}/catalogs/grosser/latest.json`)).json()) as { indexUrl: string };
const index = (await (await fetch(latest.indexUrl)).json()) as { rows: { article: string; model: string; specUrl: string | null }[] };
const specByArticle = new Map(index.rows.filter((r) => r.specUrl).map((r) => [r.article, r.specUrl!]));

const reportPath = fs.readdirSync("output/grosser-catalog").filter((f) => /^sync-.*-applied\.json$/.test(f)).sort().pop();
if (!reportPath) throw new Error("Немає звіту sync.mts --apply — спершу проставте фото");
const report = JSON.parse(fs.readFileSync(`output/grosser-catalog/${reportPath}`, "utf8")) as {
  set: { productId: string; article: string; model: string }[];
};

const products = await prisma.product.findMany({
  where: { id: { in: report.set.map((s) => s.productId) } },
  select: { id: true, sku: true, name: true, description: true, powerWatts: true, rpm: true, discDiameterMm: true, chuckMm: true, weightKg: true },
});
const byId = new Map(products.map((p) => [p.id, p]));

const queue = report.set
  .filter((s) => specByArticle.has(s.article))
  .map((s) => ({ ...s, product: byId.get(s.productId)! }))
  .filter((t) => t.product && (FORCE || !t.product.description.includes(HEADING)))
  .slice(0, LIMIT === Infinity ? undefined : LIMIT);

console.log(`Товарів з фото: ${report.set.length}; з них мають таблицю характеристик: ${report.set.filter((s) => specByArticle.has(s.article)).length}; до обробки зараз: ${queue.length}${APPLY ? " (із записом)" : " (сухий прогін)"}`);

type Result = { article: string; sku: string | null; specs: Specs; description: string; numbers: Record<string, number | null> };
const done: Result[] = [];
const failed: { article: string; error: string }[] = [];

const pending = [...queue];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const t = pending.shift();
      if (!t) return;
      try {
        const specs = await readSpecs(specByArticle.get(t.article)!);
        if (!specs) throw new Error("модель не повернула структуру");
        const description = compose(t.product.description, specs);
        // Числові поля — лише порожнім: виставлене руками або з 1С не чіпаємо.
        const numbers: Record<string, number | null> = {};
        for (const f of ["powerWatts", "rpm", "discDiameterMm", "chuckMm", "weightKg"] as const) {
          const v = specs[f];
          if (v != null && t.product[f] == null) numbers[f] = f === "powerWatts" || f === "rpm" || f === "discDiameterMm" ? Math.round(v) : v;
        }
        done.push({ article: t.article, sku: t.product.sku, specs, description, numbers });
        if (APPLY) {
          await prisma.product.update({ where: { id: t.product.id }, data: { description, ...numbers } });
        }
        if (done.length % 20 === 0) console.log(`  ${done.length}/${queue.length}`);
      } catch (e) {
        failed.push({ article: t.article, error: e instanceof Error ? e.message : String(e) });
      }
    }
  })
);

console.log(`\nРозпізнано: ${done.length}, помилок: ${failed.length}`);
for (const f of failed) console.log(`  ✗ ${f.article}: ${f.error}`);
const filled = done.reduce<Record<string, number>>((acc, d) => {
  for (const k of Object.keys(d.numbers)) acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {});
console.log(`Числові поля заповнено: ${JSON.stringify(filled)}`);
console.log(`Токенів: ${inTokens} вхідних, ${outTokens} вихідних (≈ $${((inTokens * 5 + outTokens * 25) / 1e6).toFixed(2)})`);

for (const d of done.slice(0, APPLY ? 2 : 5)) {
  console.log(`\n── ${d.article} / ${d.sku} ──\n${d.description}`);
  if (Object.keys(d.numbers).length) console.log(`  поля: ${JSON.stringify(d.numbers)}`);
}

fs.mkdirSync("output/grosser-catalog", { recursive: true });
const out = `output/grosser-catalog/specs-${new Date().toISOString().slice(0, 10)}${APPLY ? "-applied" : "-dry"}.json`;
fs.writeFileSync(out, JSON.stringify({ done, failed }, null, 1));
console.log(`\nЗвіт: ${out}`);
if (!APPLY) console.log("Сухий прогін. Щоб записати: --apply");
await prisma.$disconnect();
