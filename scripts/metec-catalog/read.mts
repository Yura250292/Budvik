/**
 * Читання сторінок каталогу METEC зором.
 *
 * У цьому каталозі текстового шару немає взагалі — усе в кривих. Тому
 * артикул, назву, модель і таблицю характеристик знімаємо з розгортки
 * сторінки (`pages/pN.png`, зроблені parse.py) моделлю, а не парсером.
 *
 * Артикул на сторінці — той самий шестизначний номер, що й `sku` в 1С
 * (700112), і стоїть він у правому верхньому куті поряд із логотипом. Це
 * найцінніше, що дає зір: без нього фото нікуди не прив'язати.
 *
 * Результат дописується в `index.json` поруч зі знімками, щоб publish.mts
 * вивантажив усе одним індексом.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/metec-catalog/read.mts output/metec-catalog/2026
 *   --limit N   прочитати лише перші N сторінок (для проби)
 *   --force     перечитати й ті сторінки, що вже прочитані
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const FORCE = args.includes("--force");
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
if (!dir || !fs.existsSync(path.join(dir, "index.json"))) {
  console.error("Вкажіть теку з index.json (результат parse.py)");
  process.exit(1);
}
const CONCURRENCY = 4;

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY не заданий");
const anthropic = new Anthropic({ apiKey });

const PageSchema = z.object({
  article: z.string().nullable(),
  name: z.string(),
  model: z.string().nullable(),
  specs: z.array(z.object({ key: z.string(), value: z.string() })),
  features: z.array(z.string()),
});
type PageRead = z.infer<typeof PageSchema>;

const PROMPT = `Це сторінка офіційного каталогу побутової техніки METEC (українською). Одна сторінка — один товар.

Заповни:
- article: шестизначний номер артикулу у ПРАВОМУ ВЕРХНЬОМУ куті, поряд із логотипом metec (наприклад «700112»). Якщо його на сторінці немає — null. Не вигадуй і не бери число з таблиці.
- name: заголовок товару зліва вгорі, дослівно («Тепловентилятор спіральний FH-12»).
- model: код моделі із заголовка («FH-12», «EK-01GB»). Якщо коду немає — null.
- specs: УСІ рядки таблиці характеристик. key — назва характеристики («Напруга / Частота»), value — значення разом з одиницею («220-240 В / 50 Гц»). Порядок збережи. Значення «+» лишай як «є», «-» як «немає». Нічого не додавай від себе і не перекладай.
- features: короткі підписи переваг (з піктограм праворуч і рядків унизу), по одному на пункт, без повторів.

Десятковий роздільник — кома. Якщо сторінка не товарна (обкладинка, зміст) — name порожній рядок, решта null або порожні.`;

type Page = { page: number; photo: string; sheet: string; read?: PageRead };
const indexPath = path.join(dir, "index.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
  catalogYear: string;
  source: string;
  pages: Page[];
};

let inTokens = 0;
let outTokens = 0;

async function readPage(page: Page): Promise<PageRead | null> {
  const data = fs.readFileSync(path.join(dir!, "pages", page.sheet)).toString("base64");
  const out = await anthropic.messages.parse({
    model: "claude-opus-5",
    max_tokens: 4000,
    output_config: { format: zodOutputFormat(PageSchema), effort: "low" },
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

const queue = index.pages.filter((p) => FORCE || !p.read).slice(0, LIMIT);
console.log(`Сторінок до читання: ${queue.length} з ${index.pages.length}`);

let done = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const page = queue.shift();
      if (!page) return;
      try {
        page.read = (await readPage(page)) ?? undefined;
      } catch (err) {
        console.error(`  стор.${page.page}: ${(err as Error).message}`);
      }
      done++;
      console.log(`  ${done}/${queue.length + done} стор.${page.page}: ${page.read?.article ?? "—"} ${page.read?.name?.slice(0, 52) ?? ""}`);
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));
    }
  })
);

// Ціни на 27.08.2026: $5 за млн вхідних, $25 за млн вихідних.
const cost = (inTokens / 1e6) * 5 + (outTokens / 1e6) * 25;
console.log(`\nПрочитано: ${index.pages.filter((p) => p.read?.article).length} сторінок з артикулом`);
console.log(`Токени: ${inTokens} вх / ${outTokens} вих ≈ $${cost.toFixed(2)}`);
