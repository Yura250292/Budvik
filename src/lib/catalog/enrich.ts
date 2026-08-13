import { prisma } from "@/lib/prisma";

/**
 * Добір фото й описів для номенклатури.
 *
 * Заміряно на бойовій базі: з 48 961 активного товару 23 097 без фото і
 * 22 611 без опису. 1С зображень не віддає взагалі, тож єдине джерело —
 * інтернет-магазини.
 *
 * Головна вимога: прикріплювати фото ТІЛЬКИ якщо це точно той самий товар.
 * Наявний /api/erp/images/auto-search цього не гарантував — він перевіряв
 * лише те, що URL віддає картинку (HEAD-запит на content-type), тож фото
 * сусідньої моделі того ж бренда проходило як валідне. Тут додано другий
 * крок: зображення показуємо моделі, і вона порівнює його з назвою товару.
 * Не збіглося — не чіпаємо, краще порожньо, ніж чужа картинка перед клієнтом.
 */

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export interface EnrichCandidate {
  id: string;
  name: string;
  sku: string | null;
  brand: string | null;
  category: string | null;
}

export interface ImageVerdict {
  productId: string;
  name: string;
  imageUrl: string | null;
  source: string;
  /** Чому відхилено — потрапляє у звіт, щоб було видно, що саме не збіглось. */
  reason?: string;
  status: "applied" | "rejected" | "not_found" | "error";
}

/** Артикул із 1С без справжнього коду — для пошуку марний. */
function realSku(sku: string | null): string {
  return sku && !sku.startsWith("1C-") ? sku : "";
}

/**
 * Крок 1: знайти кандидата в українських магазинах через Gemini з
 * grounding у Google Search.
 */
async function findImageCandidate(
  p: EnrichCandidate,
  apiKey: string
): Promise<{ url: string; source: string } | null> {
  const sku = realSku(p.sku);
  const query = [p.name, sku, p.brand].filter(Boolean).join(" ");

  const prompt = `Знайди фото товару "${query}".

Потрібне ПРЯМЕ посилання на зображення (URL, що веде на .jpg/.jpeg/.png/.webp).
Шукай в українських магазинах: Rozetka, Епіцентр, Prom.ua, 130.com.ua, Tools.ua.

Відповідь ТІЛЬКИ JSON, без markdown:
{"imageUrl":"https://...jpg","source":"магазин","confidence":"high"|"medium"|"low"}

Якщо не знайшов саме цей товар: {"imageUrl":null,"source":"","confidence":"none"}
НЕ вигадуй URL — тільки реальні посилання з пошуку.`;

  const res = await fetch(`${GEMINI_URL}/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}`);

  const data = await res.json();
  let text: string = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  text = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

  try {
    const parsed = JSON.parse(text);
    // low confidence не беремо: на цьому рівні модель вгадує категорію,
    // а не конкретну модель товару.
    if (parsed.imageUrl && parsed.confidence !== "none" && parsed.confidence !== "low") {
      return { url: parsed.imageUrl, source: parsed.source || "AI Search" };
    }
  } catch {
    // не розпарсилось — вважаємо, що не знайшли
  }
  return null;
}

/** Завантажуємо картинку — і щоб перевірити, і щоб було що показати моделі. */
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
    // Плейсхолдери «немає фото» важать десятки байтів; великі файли
    // Anthropic не прийме, та й у каталозі вони ні до чого.
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2048 || buf.length > 4_500_000) return null;

    return { base64: buf.toString("base64"), mime };
  } catch {
    return null;
  }
}

/**
 * Крок 2: звірити картинку з назвою товару зором.
 *
 * Це і є «якщо це точно він». Модель бачить зображення і назву, і має
 * відповісти, чи на фото саме цей товар. Сумнівається — відхиляємо.
 */
async function verifyImageMatches(
  p: EnrichCandidate,
  img: { base64: string; mime: string },
  apiKey: string
): Promise<{ ok: boolean; reason: string }> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
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

Відхиляй, якщо: інший тип інструмента; інший бренд на видному місці; це логотип, банер, колаж, скріншот сайту або фото магазину; фото іншої моделі того ж бренда; на фото людина або приміщення замість товару.
Приймай, якщо це фото саме такого товару (студійне або на прозорому фоні — нормально), навіть якщо ракурс чи комплектація трохи інші.

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
    // Не змогли прочитати відповідь — вважаємо, що не підтверджено.
    return { ok: false, reason: "нерозбірлива відповідь перевірки" };
  }
}

/** Знайти фото і прикріпити його, лише якщо перевірка підтвердила збіг. */
export async function enrichImage(
  p: EnrichCandidate,
  keys: { gemini: string; anthropic: string },
  opts: { dryRun?: boolean } = {}
): Promise<ImageVerdict> {
  try {
    const found = await findImageCandidate(p, keys.gemini);
    if (!found) {
      return { productId: p.id, name: p.name, imageUrl: null, source: "", status: "not_found" };
    }

    const img = await fetchImage(found.url);
    if (!img) {
      return {
        productId: p.id,
        name: p.name,
        imageUrl: null,
        source: found.source,
        reason: "картинка не завантажилась або замала",
        status: "rejected",
      };
    }

    const verdict = await verifyImageMatches(p, img, keys.anthropic);
    if (!verdict.ok) {
      return {
        productId: p.id,
        name: p.name,
        imageUrl: found.url,
        source: found.source,
        reason: verdict.reason,
        status: "rejected",
      };
    }

    if (!opts.dryRun) {
      await prisma.product.update({ where: { id: p.id }, data: { image: found.url } });
    }

    return {
      productId: p.id,
      name: p.name,
      imageUrl: found.url,
      source: found.source,
      reason: verdict.reason,
      status: "applied",
    };
  } catch (e) {
    return {
      productId: p.id,
      name: p.name,
      imageUrl: null,
      source: e instanceof Error ? e.message : "error",
      status: "error",
    };
  }
}

export interface DescResult {
  productId: string;
  name: string;
  description: string | null;
  status: "applied" | "skipped" | "error";
}

/**
 * Опис товару з його ж назви.
 *
 * Пишемо по назві, а не «за мотивами інтернету»: назва в 1С містить тип,
 * розмір і фасування — цього досить для чесних двох речень. Вигадувати
 * характеристики, яких немає в даних, тут не можна: опис читає клієнт, і
 * вигадана потужність гірша за відсутній опис.
 */
export async function enrichDescription(
  batch: EnrichCandidate[],
  apiKey: string,
  opts: { dryRun?: boolean } = {}
): Promise<DescResult[]> {
  const list = batch
    .map((p, i) => `${i + 1}. ${p.name}${p.brand ? ` [бренд: ${p.brand}]` : ""}`)
    .join("\n");

  const prompt = `Ти пишеш описи товарів для каталогу магазину інструментів.

Для кожного товару напиши 1–2 речення українською: що це, для чого, ключова характеристика з назви (розмір, обсяг, фасування).

Правила:
- Спирайся ТІЛЬКИ на назву. Не вигадуй потужність, гарантію, країну, матеріал, якщо їх немає в назві.
- Без маркетингових вигуків («найкращий», «неперевершений»).
- Без повторення назви слово в слово.
- 120–300 символів.

Товари:
${list}

Відповідь ТІЛЬКИ JSON-масив, без markdown:
[{"n":1,"d":"опис"},{"n":2,"d":"опис"}]`;

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 4000,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);

  const data = await res.json();
  let text: string = data.choices?.[0]?.message?.content || "";
  text = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

  let parsed: { n: number; d: string }[];
  try {
    parsed = JSON.parse(text);
  } catch {
    return batch.map((p) => ({ productId: p.id, name: p.name, description: null, status: "error" as const }));
  }

  const results: DescResult[] = [];
  const updates: { id: string; description: string }[] = [];

  for (const item of parsed) {
    const p = batch[item.n - 1];
    if (!p) continue;
    const d = (item.d || "").trim();
    // Занадто короткий опис не кращий за порожній — краще лишити місце
    // наступному прогону, ніж записати «Свердло.» і вважати справу зробленою.
    if (d.length < 40) {
      results.push({ productId: p.id, name: p.name, description: null, status: "skipped" });
      continue;
    }
    updates.push({ id: p.id, description: d });
    results.push({ productId: p.id, name: p.name, description: d, status: "applied" });
  }

  if (updates.length > 0 && !opts.dryRun) {
    await prisma.$transaction(
      updates.map((u) => prisma.product.update({ where: { id: u.id }, data: { description: u.description } }))
    );
  }

  return results;
}

/**
 * Кого обробляти першим.
 *
 * Порядок не випадковий: спершу те, що торговий реально показує клієнту —
 * товар у наявності, з ціною, з великого бренда. Обробити всі 23 тисячі
 * одним прогоном однаково не вийде, тож черга має починатися з корисного.
 */
export async function pickCandidates(opts: {
  need: "image" | "description";
  limit: number;
  brandSlug?: string;
  onlyInStock?: boolean;
}): Promise<EnrichCandidate[]> {
  const where: Record<string, unknown> = { isActive: true };

  if (opts.need === "image") where.OR = [{ image: null }, { image: "" }];
  else where.description = "";

  if (opts.onlyInStock) where.stock = { gt: 0 };
  if (opts.brandSlug) where.brand = { slug: opts.brandSlug };

  const rows = await prisma.product.findMany({
    where,
    select: {
      id: true,
      name: true,
      sku: true,
      brand: { select: { name: true } },
      category: { select: { name: true } },
    },
    orderBy: [{ stock: "desc" }, { price: "desc" }],
    take: opts.limit,
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sku: r.sku,
    brand: r.brand?.name ?? null,
    category: r.category?.name ?? null,
  }));
}
