/**
 * Добір фото з безкоштовних джерел, із перевіркою «чи це точно він».
 *
 * Google Search grounding коштує $35 за 1000 запитів — на 23 097 товарів це
 * ~35 тис. грн. Тут платимо тільки за звірку зором (Haiku, ~$0.002 за товар),
 * а самі фото шукаємо звичайним HTTP: архів budvik.com і пошук Епіцентру.
 *
 * Кожне знайдене фото показуємо моделі разом із назвою товару, і вона каже,
 * чи це той самий товар. Не збіглося — не чіпаємо: чуже фото перед клієнтом
 * гірше за порожнє місце.
 *
 * Запуск:
 *   npx tsx scripts/enrich-images-free.mts --limit 30 --dry     проба
 *   npx tsx scripts/enrich-images-free.mts --limit 500 --apply  партія
 *   npx tsx scripts/enrich-images-free.mts --in-stock --apply   те, що на складі
 */
import { PrismaClient } from "@prisma/client";
import { pickCandidates, type EnrichCandidate } from "../src/lib/catalog/enrich";
import {
  buildOldSiteIndex,
  matchOldSite,
  searchEpicentr,
  realSku,
  type OldSiteIndex,
  type FreeHit,
} from "../src/lib/catalog/free-sources";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const IN_STOCK = args.includes("--in-stock");
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || 50;
const CONCURRENCY = 4;

const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!anthropicKey) {
  console.error("ANTHROPIC_API_KEY не заданий — без нього немає чим перевіряти фото");
  process.exit(1);
}

const prisma = new PrismaClient();

async function fetchImage(url: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BudvikBot/1.0)" },
    });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!mime.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2048 || buf.length > 4_500_000) return null;
    return { base64: buf.toString("base64"), mime };
  } catch {
    return null;
  }
}

async function verify(
  p: EnrichCandidate,
  img: { base64: string; mime: string }
): Promise<{ ok: boolean; reason: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: img.mime, data: img.base64 } },
            {
              type: "text",
              text: `Товар з нашого каталогу:
Назва: ${p.name}
${realSku(p.sku) ? `Артикул: ${realSku(p.sku)}` : ""}
${p.brand ? `Бренд: ${p.brand}` : ""}

Чи на цьому фото саме цей товар?

Відхиляй, якщо: інший тип інструмента; чужий бренд на видному місці; це логотип, банер, колаж, скріншот сайту чи фото магазину; інша модель того ж бренда; на фото людина або приміщення замість товару.
Приймай, якщо це фото саме такого товару (студійне або на білому фоні — нормально), навіть якщо ракурс чи комплектація трохи інші.

Відповідь ТІЛЬКИ JSON: {"match": true|false, "reason": "коротко українською"}`,
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(40000),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  let text: string = data.content?.[0]?.text || "";
  text = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(text);
    return { ok: parsed.match === true, reason: String(parsed.reason || "") };
  } catch {
    return { ok: false, reason: "нерозбірлива відповідь перевірки" };
  }
}

type Outcome = "applied" | "rejected" | "not_found" | "error";

async function processOne(p: EnrichCandidate, idx: OldSiteIndex): Promise<{ outcome: Outcome; note: string }> {
  try {
    const candidates: FreeHit[] = [];

    // Спершу архів свого сайту: безкоштовний, без лімітів частоти, і збіг
    // там завжди точний — зіставлення йде за назвою товару.
    const fromArchive = matchOldSite(p.name, idx);
    if (fromArchive) candidates.push(fromArchive);

    // Далі Епіцентр: за артикулом (точніше), потім за назвою з брендом.
    const sku = realSku(p.sku);
    const full = `${p.brand ? p.brand + " " : ""}${p.name}`;
    if (sku) candidates.push(...(await searchEpicentr(sku, 2)));
    if (candidates.length < 3) candidates.push(...(await searchEpicentr(full, 3)));

    if (candidates.length === 0) return { outcome: "not_found", note: "" };

    // Перебираємо кандидатів, поки перевірка не підтвердить збіг. Видача
    // магазину змішує потрібний товар зі «схожими», тож зупинятись на
    // першій картинці означало б відкидати правильні фото.
    let lastReason = "";
    for (const hit of candidates.slice(0, 4)) {
      const img = await fetchImage(hit.url);
      if (!img) {
        lastReason = "картинка не завантажилась";
        continue;
      }

      const v = await verify(p, img);
      if (v.ok) {
        if (APPLY) {
          await prisma.product.update({ where: { id: p.id }, data: { image: hit.url } });
        }
        return { outcome: "applied", note: `${hit.source}: ${v.reason}` };
      }
      lastReason = v.reason;
    }

    return { outcome: "rejected", note: lastReason };
  } catch (e) {
    return { outcome: "error", note: e instanceof Error ? e.message : "error" };
  }
}

const t0 = Date.now();
console.log("Будую індекс архіву budvik.com…");
const idx = await buildOldSiteIndex();
console.log(`  ${idx.size} фото в архіві\n`);

const candidates = await pickCandidates({ need: "image", limit: LIMIT, onlyInStock: IN_STOCK });
console.log(`До обробки: ${candidates.length}${APPLY ? "" : "  (ПРОБНИЙ ПРОГІН, база не змінюється)"}\n`);

const stats: Record<Outcome, number> = { applied: 0, rejected: 0, not_found: 0, error: 0 };
const examples: string[] = [];

for (let i = 0; i < candidates.length; i += CONCURRENCY) {
  const slice = candidates.slice(i, i + CONCURRENCY);
  const results = await Promise.all(slice.map((p) => processOne(p, idx)));

  results.forEach((r, k) => {
    stats[r.outcome]++;
    if (examples.length < 25) {
      const mark = { applied: "✓", rejected: "✗", not_found: "·", error: "!" }[r.outcome];
      examples.push(`${mark} ${slice[k].name.slice(0, 52)}${r.note ? ` — ${r.note.slice(0, 45)}` : ""}`);
    }
  });

  const done = Math.min(i + CONCURRENCY, candidates.length);
  const rate = done / ((Date.now() - t0) / 1000);
  const eta = rate > 0 ? Math.round((candidates.length - done) / rate / 60) : 0;
  process.stdout.write(
    `\r${done}/${candidates.length}  прикріплено:${stats.applied} відхилено:${stats.rejected} не знайдено:${stats.not_found} помилок:${stats.error}  ~${eta} хв   `
  );
}

console.log("\n\nПриклади:");
examples.forEach((e) => console.log("  " + e));

const done = stats.applied + stats.rejected + stats.not_found + stats.error;
console.log(`\nПідсумок з ${done}:`);
console.log(`  прикріплено:  ${stats.applied}${APPLY ? "" : " (пробний прогін — не записано)"}`);
console.log(`  відхилено:    ${stats.rejected}  (знайшли фото, але це не той товар)`);
console.log(`  не знайдено:  ${stats.not_found}`);
console.log(`  помилок:      ${stats.error}`);
console.log(`Час: ${((Date.now() - t0) / 60000).toFixed(1)} хв`);

await prisma.$disconnect();
