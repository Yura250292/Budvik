/**
 * Агент-дослідник: знаходить сторінки товару в інтернет-магазинах.
 *
 * Три кроки, і модель — лише в одному з них:
 *
 *   1. Пошуковий API (search.ts) за артикулом і брендом дає до десяти
 *      результатів; якщо придатних мало — ще запит за назвою.
 *   2. DeepSeek вибирає з результатів сторінки саме цього товару: відкидає
 *      категорії, іншу модифікацію, каркас замість комплекту. Без ключа
 *      DeepSeek або коли він не відповів — беремо результати, у назві чи
 *      адресі яких стоїть наш артикул.
 *   3. Рушій відкриває кожну сторінку сам, читає ціну з розмітки і приймає
 *      сторінку, лише якщо вона сама називає наш артикул (verify.ts).
 *
 * Модель ціну не бачить і не називає: під час ручної звірки 13.09.2026
 * пошукові підсумки плутали моделі (пила Grösser GCS 601 без акумулятора за
 * ціною комплекту, пальник POLAX 32-043 з 32-040).
 *
 * Перша версія 14.09.2026 була на Claude з пошуком усередині моделі: $0,12 за
 * знайдений товар і до $0,5 за відсутній. Власник назвав це дорого. Тепер
 * пошук — близько $0,001 за запит, DeepSeek — частки цента: на пробі STIHL
 * MS 180 він за 741 вхідний і 114 вихідних токенів вибрав рівно чотири
 * правильні сторінки з семи результатів.
 *
 * Шукаємо для товарів у наявності без свіжої ринкової ціни — спершу
 * актуальні (relevance.ts): що продавалось за 30 днів, потім за 90, потім
 * решта; у межах рівня — за кількістю продажів і переглядів. Товар, для
 * якого нічого не знайшлось, шукаємо знову через 30 днів, якщо він
 * продається, і через 90, якщо ні.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchPage, HttpError } from "../market/http";
import { hostOf, marketExtractorFor } from "../market/sources";
import { agentCostUsd } from "./cost";
import { MARKET_FRESH_DAYS } from "./constants";
import { LOOKUP_AGAIN_DAYS_BY_TIER, RELEVANCE_CTE, RELEVANCE_ORDER, tierCutoff } from "../relevance";
import { searchProvider, type SearchProvider, type SearchResult } from "./search";
import { articlePattern, pageNamesArticle, pageTitle, textNamesArticle } from "./verify";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-flash";
const MAX_PAGES = 5;
const MAX_CANDIDATES = 15;
const DAY_MS = 86_400_000;

/**
 * Сайти, які знаємо: для них перевірено читання ціни. Стоять першими серед
 * кандидатів; решта українських магазинів проходить ту саму перевірку.
 */
export const PREFERRED_DOMAINS: string[] = [
  "hotline.ua", "epicentrk.ua", "prom.ua", "avtotool.com.ua", "lamaster.ua", "maudau.com.ua",
  "apro.ua", "sigma.ua", "polax.ua", "dnipro-m.ua", "mastertool.ua", "gradient.ua",
  "revolt-tools.com.ua", "totaltools.com.ua", "unifix.ua", "motocentre.com.ua", "rezon.ua",
];

/** Звідси не беремо: rozetka віддає 403 серверним запитам, olx — вживане, решта — не магазини. */
const BLOCKED_DOMAINS = ["rozetka.com.ua", "olx.ua", "youtube.com", "facebook.com", "instagram.com", "t.me", "tiktok.com", "wikipedia.org"];

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

const SYSTEM = [
  "Ти відбираєш із результатів пошуку сторінки одного конкретного товару в інтернет-магазинах.",
  "Бери лише сторінку одного товару, де артикул або модель збігаються точно. Комплект і каркас без акумулятора, інша модифікація, набір, категорія, пошук, відгуки — не підходять.",
  "Сторінка товару на hotline.ua з цінами магазинів підходить.",
  'Відповідай лише json у форматі {"pages": [{"n": 2, "reason": "коротко"}]}, де n — номер результату. Якщо нічого не підходить — {"pages": []}.',
].join("\n");

type Candidate = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  wholesale: number;
  /** Рівень актуальності (relevance.ts): 1 — продавався за 30 днів. */
  tier: number;
  sales90: number;
};
type Accepted = { host: string; url: string; price: number; inStock: boolean | null; title: string | null };

export type DiscoveryResult = {
  skipped: "no_search_key" | null;
  provider: SearchProvider["name"] | null;
  looked: number;
  /** З них — товари, що продавались за 30 днів. */
  lookedHot: number;
  pagesFound: number;
  pagesAccepted: number;
  searches: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  errors: string[];
  /** Що саме знайдено по кожному товару — для журналу й перевірки руками. */
  details: {
    sku: string;
    tier: number;
    picked: string[];
    pickedBy: "deepseek" | "article";
    accepted: { host: string; url: string; price: number; inStock: boolean | null }[];
    notes: string[];
  }[];
};

function isShopUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.host.replace(/^www\./, "");
  if (BLOCKED_DOMAINS.some((d) => onDomain(host, d))) return false;
  if (!host.endsWith(".ua") && !PREFERRED_DOMAINS.some((d) => onDomain(host, d))) return false;
  // Пошук і фільтри майданчиків robots.txt забороняє — туди не ходимо.
  if (/(^|\/)(search|sr)(\/|$)/i.test(u.pathname)) return false;
  if (/[?&](q|search_term|text|query)=/i.test(u.search)) return false;
  return true;
}

function shortName(c: Candidate): string {
  const brand = (c.brand ?? "").toLowerCase();
  const words = c.name
    .replace(/[«»"()]/g, " ")
    .split(/\s+/)
    .filter((w) => w && w.toLowerCase() !== brand);
  return [c.brand, ...words.slice(0, 8)].filter(Boolean).join(" ");
}

async function searchCandidates(
  provider: SearchProvider,
  c: Candidate
): Promise<{ results: SearchResult[]; searches: number }> {
  const byUrl = new Map<string, SearchResult>();
  let searches = 0;
  const add = (rows: SearchResult[]) => {
    for (const r of rows) if (isShopUrl(r.url) && !byUrl.has(r.url)) byUrl.set(r.url, r);
  };

  add(await provider.search(`${c.sku} ${c.brand ?? ""}`.trim()));
  searches++;
  if (byUrl.size < 3) {
    add(await provider.search(shortName(c)));
    searches++;
  }

  const preferred = (r: SearchResult) => PREFERRED_DOMAINS.some((d) => onDomain(hostOf(r.url), d));
  const results = [...byUrl.values()].sort((a, b) => Number(preferred(b)) - Number(preferred(a))).slice(0, MAX_CANDIDATES);
  return { results, searches };
}

async function pickPages(
  c: Candidate,
  results: SearchResult[]
): Promise<{ urls: string[]; by: "deepseek" | "article"; inputTokens: number; outputTokens: number }> {
  const byArticle = () => ({
    urls: results.filter((r) => textNamesArticle(`${r.title} ${r.url}`, c.sku)).map((r) => r.url).slice(0, MAX_PAGES),
    by: "article" as const,
    inputTokens: 0,
    outputTokens: 0,
  });
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || results.length === 0) return byArticle();

  const user =
    `Товар. Бренд: ${c.brand ?? "невідомий"}. Артикул: ${c.sku}. Назва: ${c.name}\n\nРезультати:\n` +
    results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n");

  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        // Міркування тут не потрібні, а без явного вимкнення DeepSeek думає й відповідає довше.
        thinking: { type: "disabled" },
        temperature: 0,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return byArticle();
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const inputTokens = body.usage?.prompt_tokens ?? 0;
    const outputTokens = body.usage?.completion_tokens ?? 0;
    const content = body.choices?.[0]?.message?.content ?? "";
    // Документація DeepSeek попереджає: у режимі JSON відповідь зрідка буває порожньою.
    if (!content.trim()) return { ...byArticle(), inputTokens, outputTokens };
    const parsed = JSON.parse(content) as { pages?: { n?: unknown }[] };
    const urls = (parsed.pages ?? [])
      .map((p) => Number(p?.n))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= results.length)
      .map((n) => results[n - 1].url);
    return { urls: [...new Set(urls)].slice(0, MAX_PAGES), by: "deepseek", inputTokens, outputTokens };
  } catch {
    return byArticle();
  }
}

async function verifyPages(c: Candidate, urls: string[]): Promise<{ accepted: Accepted[]; notes: string[] }> {
  const byHost = new Map<string, Accepted>();
  const notes: string[] = [];
  for (const url of urls) {
    const host = hostOf(url);
    const { extract, challenge } = marketExtractorFor(host);
    try {
      const html = await fetchPage(url, { challenge, timeoutMs: 20_000 });
      if (!pageNamesArticle(html, url, c.sku)) {
        notes.push(`${host}: сторінка не називає артикул`);
        continue;
      }
      const offer = extract(html);
      if (!offer) {
        notes.push(`${host}: ціни на сторінці немає`);
        continue;
      }
      // На майданчику буває кілька продавців одного товару — лишаємо найдешевшого.
      const prev = byHost.get(host);
      if (!prev || offer.price < prev.price) {
        byHost.set(host, { host, url, price: offer.price, inStock: offer.inStock, title: pageTitle(html) });
      }
    } catch (e) {
      notes.push(`${host}: ${e instanceof HttpError ? `HTTP ${e.status}` : "не відкрилась"}`);
    }
  }
  return { accepted: [...byHost.values()], notes };
}

async function recordLookup(
  productId: string,
  data: Partial<Record<"searches" | "pagesFound" | "pagesAccepted" | "inputTokens" | "outputTokens", number>> & {
    note?: string | null;
  }
): Promise<void> {
  const row = {
    lookedAt: new Date(),
    searches: data.searches ?? 0,
    pagesFound: data.pagesFound ?? 0,
    pagesAccepted: data.pagesAccepted ?? 0,
    inputTokens: data.inputTokens ?? 0,
    outputTokens: data.outputTokens ?? 0,
    note: data.note ?? null,
  };
  await prisma.marketLookup.upsert({ where: { productId }, create: { productId, ...row }, update: row });
}

export async function discoverMarketPages(
  opts: { limit?: number; budgetMs?: number; dry?: boolean; productIds?: string[]; provider?: SearchProvider } = {}
): Promise<DiscoveryResult> {
  const provider = opts.provider ?? searchProvider();
  const out: DiscoveryResult = {
    skipped: null, provider: provider?.name ?? null, looked: 0, lookedHot: 0, pagesFound: 0, pagesAccepted: 0,
    searches: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, errors: [], details: [],
  };
  if (!provider) return { ...out, skipped: "no_search_key" };

  const limit = opts.limit ?? 10;
  const deadline = Date.now() + (opts.budgetMs ?? 5 * 60_000);
  const freshFrom = new Date(Date.now() - MARKET_FRESH_DAYS * DAY_MS);

  const filter = opts.productIds
    ? Prisma.sql`AND p.id = ANY(${opts.productIds}::text[])`
    : Prisma.sql`
        AND (l."productId" IS NULL OR l."lookedAt" < ${tierCutoff(LOOKUP_AGAIN_DAYS_BY_TIER)})
        AND NOT EXISTS (
          SELECT 1 FROM "MarketPrice" m
          WHERE m."productId" = p.id AND m."seenAt" >= ${freshFrom}
            AND COALESCE(m."lastStatus", 'ok') IN ('ok', 'out_of_stock')
        )`;

  const candidates = await prisma.$queryRaw<Candidate[]>`
    WITH ${RELEVANCE_CTE}
    SELECT p.id, p.sku, p.name, b.name AS brand, w.price AS wholesale,
           COALESCE(rel.tier, 4)::int AS tier, COALESCE(rel.sales90, 0)::int AS sales90
    FROM "Product" p
    JOIN "Price1C" w ON w."productId" = p.id AND w.kind = 'WHOLESALE'
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    LEFT JOIN "MarketLookup" l ON l."productId" = p.id
    LEFT JOIN rel ON rel."productId" = p.id
    WHERE p."isActive" AND p.stock > 0 AND p.sku IS NOT NULL AND p.sku NOT ILIKE '1C-%'
      ${filter}
    ORDER BY ${RELEVANCE_ORDER}, p.stock * w.price DESC
    LIMIT ${limit * 4}
  `;

  for (const c of candidates) {
    if (out.looked >= limit || Date.now() > deadline) break;
    if (!articlePattern(c.sku)) {
      if (!opts.dry) await recordLookup(c.id, { note: "артикул закороткий, щоб перевірити сторінку" });
      continue;
    }
    out.looked++;
    if (c.tier === 1) out.lookedHot++;

    let found: Awaited<ReturnType<typeof searchCandidates>>;
    try {
      found = await searchCandidates(provider, c);
    } catch (e) {
      // Пошуковий сервіс недоступний — пошук не зараховуємо, товар спробуємо наступної ночі.
      out.errors.push(`${c.sku}: ${(e as Error).message.slice(0, 120)}`);
      continue;
    }
    out.searches += found.searches;

    const pick = await pickPages(c, found.results);
    out.inputTokens += pick.inputTokens;
    out.outputTokens += pick.outputTokens;
    out.pagesFound += pick.urls.length;

    const { accepted, notes } = await verifyPages(c, pick.urls);
    out.pagesAccepted += accepted.length;
    out.details.push({
      sku: c.sku,
      tier: c.tier,
      picked: pick.urls,
      pickedBy: pick.by,
      accepted: accepted.map((a) => ({ host: a.host, url: a.url, price: a.price, inStock: a.inStock })),
      notes,
    });
    if (opts.dry) continue;

    const now = new Date();
    for (const a of accepted) {
      const status = a.inStock === false ? "out_of_stock" : "ok";
      await prisma.marketPrice.upsert({
        where: { productId_source: { productId: c.id, source: a.host } },
        create: {
          productId: c.id, source: a.host, url: a.url, price: a.price, inStock: a.inStock, title: a.title,
          lastStatus: status, foundBy: "agent", seenAt: now, checkedAt: now, changedAt: now,
        },
        update: {
          url: a.url, price: a.price, inStock: a.inStock, title: a.title,
          lastStatus: status, foundBy: "agent", seenAt: now, checkedAt: now, failCount: 0,
        },
      });
    }
    await recordLookup(c.id, {
      searches: found.searches,
      pagesFound: pick.urls.length,
      pagesAccepted: accepted.length,
      inputTokens: pick.inputTokens,
      outputTokens: pick.outputTokens,
      note: [`${provider.name}, відбір: ${pick.by === "deepseek" ? "DeepSeek" : "за артикулом"}`, ...notes].join("; ").slice(0, 1000),
    });
  }

  out.costUsd = agentCostUsd({
    searches: out.searches,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    usdPerQuery: provider.usdPerQuery,
  });
  return out;
}
