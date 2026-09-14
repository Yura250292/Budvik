/**
 * Агент-дослідник: знаходить сторінки товару в інтернет-магазинах.
 *
 * Модель тут лише ШУКАЄ адреси — ціну вона не називає і на ціну не впливає.
 * Під час ручної звірки 13.09.2026 пошукові підсумки плутали моделі: пилу
 * Grösser GCS 601 без акумулятора видали за ціною комплекту, пальник POLAX
 * 32-043 змішали з 32-040. Тому кожну адресу рушій відкриває сам, читає ціну з
 * розмітки сторінки і приймає сторінку, лише якщо вона сама називає наш
 * артикул (verify.ts).
 *
 * Шукаємо для товарів у наявності, для яких свіжої ринкової ціни ще немає, —
 * найбільший залишок у гривнях першим. Знайдені адреси далі переперевіряє
 * звичайний нічний обхід (market/refresh.ts) уже без моделі. Товар, для якого
 * нічого не знайшлось, не шукаємо знову LOOKUP_AGAIN_DAYS днів.
 *
 * Потрібен ANTHROPIC_API_KEY. Без нього крок пропускається, а пропозиції
 * будуються з уже відомих джерел.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchPage, HttpError } from "../market/http";
import { hostOf, marketExtractorFor } from "../market/sources";
import { LOOKUP_AGAIN_DAYS, MARKET_FRESH_DAYS } from "./constants";
import { articlePattern, pageNamesArticle, pageTitle } from "./verify";

const MODEL = "claude-opus-5";
/**
 * Пошуків на товар. На STIHL MS 180 модель знайшла чотири правильні сторінки
 * за три пошуки і один хід ($0,12). Товар, якого в мережі немає, з'їдав усі
 * дозволені пошуки — тому стеля низька.
 */
const MAX_SEARCHES = 3;
const MAX_TURNS = 4;
const MAX_PAGES = 5;
const DAY_MS = 86_400_000;
/** Для журналу витрат: пошук $10 за 1000, токени Claude Opus 5 — $5 / $25 за мільйон. */
const USD = { search: 10 / 1000, input: 5 / 1_000_000, output: 25 / 1_000_000 };

/**
 * Де шукати. Лише сайти, що віддають сторінку товару серверному запиту і
 * друкують на ній ціну; rozetka.com.ua відповідає 403, тож її тут немає.
 * Пошук на самих майданчиках robots.txt забороняє — сторінку знаходить
 * пошуковик, а ми відкриваємо лише сторінку товару.
 */
export const AGENT_DOMAINS: string[] = [
  "hotline.ua",
  "epicentrk.ua",
  "prom.ua",
  "avtotool.com.ua",
  "lamaster.ua",
  "maudau.com.ua",
  "apro.ua",
  "sigma.ua",
  "polax.ua",
  "dnipro-m.ua",
  "mastertool.ua",
  "gradient.ua",
  "revolt-tools.com.ua",
  "totaltools.com.ua",
  "unifix.ua",
  "motocentre.com.ua",
  "rezon.ua",
];

const SYSTEM = [
  "Ти шукаєш в українських інтернет-магазинах сторінки одного конкретного товару, щоб порівняти ціни.",
  "Тобі дають бренд, артикул і назву з облікової системи. Знайди до п'яти сторінок, де продається саме цей товар.",
  "Артикул або модель на сторінці мають збігатися точно. Комплект і каркас без акумулятора, набір і поштучний товар, інший розмір чи об'єм — різні товари.",
  "Підходить лише сторінка одного товару: картка в магазині або сторінка товару на hotline.ua з цінами магазинів. Категорії, пошук і відгуки не підходять.",
  "Ціну не називай і не оцінюй: її прочитає інша система.",
  "Коли закінчиш, виклич report_product_pages. Якщо нічого не знайшов, передай порожній список.",
].join("\n");

const REPORT_TOOL = {
  name: "report_product_pages",
  description:
    "Передати знайдені сторінки цього товару. Викликати один раз наприкінці пошуку; порожній список, якщо сторінок немає.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      pages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string", description: "Повна адреса сторінки товару" },
            evidence: { type: "string", description: "Де на сторінці видно артикул або модель" },
          },
          required: ["url", "evidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["pages"],
    additionalProperties: false,
  },
} satisfies Anthropic.Beta.BetaTool;

const WEB_SEARCH = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: MAX_SEARCHES,
  allowed_domains: AGENT_DOMAINS,
  // Країну не вказуємо: код UA пошук не підтримує і відповідає 400.
  user_location: { type: "approximate", timezone: "Europe/Kyiv" },
} satisfies Anthropic.Beta.BetaWebSearchTool20260209;

type Candidate = { id: string; sku: string; name: string; brand: string | null; wholesale: number };
type AgentUsage = { searches: number; inputTokens: number; outputTokens: number };
type Accepted = { host: string; url: string; price: number; inStock: boolean | null; title: string | null };

export type DiscoveryResult = {
  skipped: "no_api_key" | null;
  looked: number;
  pagesFound: number;
  pagesAccepted: number;
  refused: number;
  searches: number;
  costUsd: number;
  errors: string[];
  /** Що саме знайдено по кожному товару — для журналу воркера й перевірки руками. */
  details: {
    sku: string;
    urls: string[];
    accepted: { host: string; url: string; price: number; inStock: boolean | null }[];
    notes: string[];
    refused: boolean;
  }[];
};

function isFetchableProductUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.host.replace(/^www\./, "");
  if (!AGENT_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return false;
  // Пошук і фільтри майданчиків robots.txt забороняє — туди не ходимо.
  if (/(^|\/)(search|sr)(\/|$)/i.test(u.pathname)) return false;
  if (/[?&](q|search_term|text|query)=/i.test(u.search)) return false;
  return true;
}

function reportedUrls(input: unknown): string[] {
  const pages = (input as { pages?: { url?: unknown }[] } | null)?.pages;
  if (!Array.isArray(pages)) return [];
  const out = new Set<string>();
  for (const page of pages) {
    if (typeof page?.url === "string" && isFetchableProductUrl(page.url.trim())) out.add(page.url.trim());
    if (out.size >= MAX_PAGES) break;
  }
  return [...out];
}

async function askForPages(
  client: Anthropic,
  c: Candidate
): Promise<{ urls: string[]; usage: AgentUsage; refused: boolean }> {
  const usage: AgentUsage = { searches: 0, inputTokens: 0, outputTokens: 0 };
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Бренд: ${c.brand ?? "невідомий"}\nАртикул: ${c.sku}\nНазва в обліку: ${c.name}` },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      // Відмова класифікатора безпеки переходить на рекомендовану модель на
      // боці API, а не повертає порожню відповідь.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM,
      tools: [WEB_SEARCH, REPORT_TOOL],
      messages,
    });
    usage.inputTokens +=
      res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0);
    usage.outputTokens += res.usage.output_tokens;
    usage.searches += res.usage.server_tool_use?.web_search_requests ?? 0;

    if (res.stop_reason === "refusal") return { urls: [], usage, refused: true };

    const report = res.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === REPORT_TOOL.name
    );
    if (report) return { urls: reportedUrls(report.input), usage, refused: false };

    // Сервер зупинив довгий пошук — відправляємо ту саму відповідь, він продовжить.
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    // Хід закінчився без report_product_pages — вважаємо, що сторінок немає.
    // Не перепитуємо: повторний хід заново читає всі результати пошуку, і на
    // пробі це подвоювало ціну товару, якого в мережі й так немає.
    break;
  }
  return { urls: [], usage, refused: false };
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
  opts: { limit?: number; budgetMs?: number; dry?: boolean; productIds?: string[] } = {}
): Promise<DiscoveryResult> {
  const out: DiscoveryResult = {
    skipped: null,
    looked: 0,
    pagesFound: 0,
    pagesAccepted: 0,
    refused: 0,
    searches: 0,
    costUsd: 0,
    errors: [],
    details: [],
  };
  if (!process.env.ANTHROPIC_API_KEY) return { ...out, skipped: "no_api_key" };

  const limit = opts.limit ?? 12;
  const deadline = Date.now() + (opts.budgetMs ?? 10 * 60_000);
  const freshFrom = new Date(Date.now() - MARKET_FRESH_DAYS * DAY_MS);
  const againFrom = new Date(Date.now() - LOOKUP_AGAIN_DAYS * DAY_MS);

  const filter = opts.productIds
    ? Prisma.sql`AND p.id = ANY(${opts.productIds}::text[])`
    : Prisma.sql`
        AND (l."productId" IS NULL OR l."lookedAt" < ${againFrom})
        AND NOT EXISTS (
          SELECT 1 FROM "MarketPrice" m
          WHERE m."productId" = p.id AND m."seenAt" >= ${freshFrom}
            AND COALESCE(m."lastStatus", 'ok') IN ('ok', 'out_of_stock')
        )`;

  const candidates = await prisma.$queryRaw<Candidate[]>`
    SELECT p.id, p.sku, p.name, b.name AS brand, w.price AS wholesale
    FROM "Product" p
    JOIN "Price1C" w ON w."productId" = p.id AND w.kind = 'WHOLESALE'
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    LEFT JOIN "MarketLookup" l ON l."productId" = p.id
    WHERE p."isActive" AND p.stock > 0 AND p.sku IS NOT NULL AND p.sku NOT ILIKE '1C-%'
      ${filter}
    ORDER BY p.stock * w.price DESC
    LIMIT ${limit * 4}
  `;

  const client = new Anthropic({ timeout: 180_000, maxRetries: 2 });

  for (const c of candidates) {
    if (out.looked >= limit || Date.now() > deadline) break;
    if (!articlePattern(c.sku)) {
      if (!opts.dry) await recordLookup(c.id, { note: "артикул закороткий, щоб перевірити сторінку" });
      continue;
    }
    out.looked++;

    let asked: Awaited<ReturnType<typeof askForPages>>;
    try {
      asked = await askForPages(client, c);
    } catch (e) {
      out.errors.push(`${c.sku}: ${e instanceof Anthropic.APIError ? `API ${e.status}` : (e as Error).message}`);
      continue;
    }
    out.searches += asked.usage.searches;
    out.costUsd +=
      asked.usage.searches * USD.search + asked.usage.inputTokens * USD.input + asked.usage.outputTokens * USD.output;
    if (asked.refused) out.refused++;
    out.pagesFound += asked.urls.length;

    const { accepted, notes } = await verifyPages(c, asked.urls);
    out.pagesAccepted += accepted.length;
    out.details.push({
      sku: c.sku,
      urls: asked.urls,
      accepted: accepted.map((a) => ({ host: a.host, url: a.url, price: a.price, inStock: a.inStock })),
      notes,
      refused: asked.refused,
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
      searches: asked.usage.searches,
      pagesFound: asked.urls.length,
      pagesAccepted: accepted.length,
      inputTokens: asked.usage.inputTokens,
      outputTokens: asked.usage.outputTokens,
      note: [asked.refused ? "модель відмовилась" : null, ...notes].filter(Boolean).join("; ").slice(0, 1000) || null,
    });
  }

  out.costUsd = Math.round(out.costUsd * 100) / 100;
  return out;
}
