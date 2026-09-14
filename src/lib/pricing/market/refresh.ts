/**
 * Переперевірка ринкових цін — нічна робота воркера.
 *
 * Адреси вже відомі: їх знайшов обхід сайтів виробників
 * (scripts/pricing/seed-market-prices.mts) або агент-дослідник
 * (src/lib/pricing/agent/discover.ts). Тут лише читаємо ціну за адресою.
 * Вітрину це не змінює: ринок іде в пропозиції агента, а на вітрину — лише
 * після затвердження адміном.
 *
 * Частота — за актуальністю товару (relevance.ts): що продається, перевіряємо
 * кожні три дні, решту — раз на 7–12 днів. Черга теж починається з
 * актуальних: якщо ніч коротка, недоперевіреним лишиться мертвий залишок.
 *
 * Невдала перевірка не стирає рядок одразу: адмін має бачити, що сторінка
 * порожня чи зникла, — саме тому в пропозиції показуємо стан кожного джерела.
 * Після MAX_FAILS невдач поспіль рядок прибираємо.
 *
 * Ходимо стримано: один запит за раз на хост із паузою, різні хости — паралельно.
 */
import { prisma } from "@/lib/prisma";
import { RELEVANCE_CTE, REFRESH_DAYS_BY_TIER, tierCutoff } from "../relevance";
import { fetchPage, HttpError } from "./http";
import { marketExtractorFor } from "./sources";

/** Після стількох невдач поспіль сторінку забуваємо — наступний пошук знайде нову. */
const MAX_FAILS = 4;
const HOST_PAUSE_MS = 1200;

export type MarketRefreshResult = {
  checked: number;
  /** З них — сторінки товарів, що продавались за 30 днів. */
  checkedHot: number;
  updated: number;
  failed: number;
  removed: number;
};

type DueRow = { id: string; source: string; url: string; price: number; failCount: number; tier: number };

export async function refreshMarketPrices(
  opts: { limit?: number; budgetMs?: number; dry?: boolean } = {}
): Promise<MarketRefreshResult> {
  const limit = opts.limit ?? 250;
  const deadline = Date.now() + (opts.budgetMs ?? 10 * 60_000);
  const out: MarketRefreshResult = { checked: 0, checkedHot: 0, updated: 0, failed: 0, removed: 0 };

  const due = await prisma.$queryRaw<DueRow[]>`
    WITH ${RELEVANCE_CTE}
    SELECT m.id, m.source, m.url, m.price, m."failCount", COALESCE(rel.tier, 4)::int AS tier
    FROM "MarketPrice" m
    LEFT JOIN rel ON rel."productId" = m."productId"
    WHERE m."checkedAt" < ${tierCutoff(REFRESH_DAYS_BY_TIER)}
    ORDER BY COALESCE(rel.tier, 4), m."checkedAt"
    LIMIT ${limit}
  `;
  if (due.length === 0) return out;

  const bySource = new Map<string, DueRow[]>();
  for (const row of due) bySource.set(row.source, [...(bySource.get(row.source) ?? []), row]);

  const failOne = async (row: DueRow, status: string) => {
    out.failed++;
    if (opts.dry) return;
    if (row.failCount + 1 >= MAX_FAILS) {
      await prisma.marketPrice.delete({ where: { id: row.id } });
      out.removed++;
    } else {
      await prisma.marketPrice.update({
        where: { id: row.id },
        data: { failCount: row.failCount + 1, checkedAt: new Date(), lastStatus: status },
      });
    }
  };

  await Promise.all(
    [...bySource].map(async ([sourceId, rows]) => {
      const { extract, challenge } = marketExtractorFor(sourceId);
      for (const row of rows) {
        if (Date.now() > deadline) break;
        out.checked++;
        if (row.tier === 1) out.checkedHot++;
        try {
          const offer = extract(await fetchPage(row.url, { challenge }));
          if (!offer) {
            await failOne(row, "no_price");
          } else {
            const now = new Date();
            if (!opts.dry) {
              await prisma.marketPrice.update({
                where: { id: row.id },
                data: {
                  price: offer.price,
                  inStock: offer.inStock,
                  seenAt: now,
                  checkedAt: now,
                  failCount: 0,
                  lastStatus: offer.inStock === false ? "out_of_stock" : "ok",
                  ...(Math.abs(offer.price - row.price) > 0.5 ? { changedAt: now } : {}),
                },
              });
            }
            out.updated++;
          }
        } catch (e) {
          await failOne(row, e instanceof HttpError ? `http_${e.status}` : "error").catch(() => {});
        }
        await new Promise((r) => setTimeout(r, HOST_PAUSE_MS));
      }
    })
  );

  return out;
}
