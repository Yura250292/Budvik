/**
 * Описи товарів для каталогу.
 *
 * Заміряно: 22 611 активних товарів без опису. Пишемо строго з назви —
 * вона містить тип, розмір і фасування. Вигадувати характеристики, яких
 * немає в даних, не можна: опис читає клієнт.
 *
 * Запуск:
 *   npx tsx scripts/enrich-descriptions.mts --limit 200 --dry
 *   npx tsx scripts/enrich-descriptions.mts --apply
 */
import { PrismaClient } from "@prisma/client";
import { enrichDescription, pickCandidates } from "../src/lib/catalog/enrich";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || (APPLY ? 1e9 : 40);
const BATCH = 40;
const CONCURRENCY = 4;

const key = process.env.DEEPSEEK_API_KEY;
if (!key) { console.error("DEEPSEEK_API_KEY не заданий"); process.exit(1); }

const prisma = new PrismaClient();
const t0 = Date.now();
let applied = 0, skipped = 0, errors = 0, seen = 0;

const all = await pickCandidates({ need: "description", limit: LIMIT });
console.log(`До обробки: ${all.length}${APPLY ? "" : "  (ПРОБНИЙ ПРОГІН, база не змінюється)"}\n`);

const batches: (typeof all)[] = [];
for (let i = 0; i < all.length; i += BATCH) batches.push(all.slice(i, i + BATCH));

for (let i = 0; i < batches.length; i += CONCURRENCY) {
  const slice = batches.slice(i, i + CONCURRENCY);
  const res = await Promise.all(slice.map(async (b) => {
    try { return await enrichDescription(b, key, { dryRun: !APPLY }); }
    catch (e) { return b.map(p => ({ productId: p.id, name: p.name, description: null, status: "error" as const })); }
  }));
  for (const group of res) for (const r of group) {
    seen++;
    if (r.status === "applied") applied++;
    else if (r.status === "skipped") skipped++;
    else errors++;
  }
  const done = Math.min((i + CONCURRENCY) * BATCH, all.length);
  const rate = seen / ((Date.now() - t0) / 1000);
  const eta = rate > 0 ? Math.round((all.length - seen) / rate / 60) : 0;
  console.log(`${done}/${all.length}  готово:${applied} пропущено:${skipped} помилок:${errors}  ~${eta} хв лишилось`);
}

console.log(`\nПідсумок: ${applied} описів${APPLY ? " записано" : " (пробний прогін)"}, ${skipped} пропущено, ${errors} помилок`);
console.log(`Час: ${((Date.now() - t0) / 60000).toFixed(1)} хв`);
await prisma.$disconnect();
