/**
 * Переперевірка ринкових цін — нічна робота воркера.
 *
 * Адреси сторінок уже знайдені (scripts/pricing/seed-market-prices.mts), тож
 * тут лише читаємо ціну за відомою адресою: ~700 сторінок за ніч замість обходу
 * всього сайту виробника. Черга — за checkedAt: сторінка, що не відкрилась,
 * не застрягає на початку черги й не блокує решту.
 *
 * Ходимо стримано: один запит за раз на хост із паузою, різні хости — паралельно.
 */
import { prisma } from "@/lib/prisma";
import { repriceProducts } from "../engine";
import { fetchPage, HttpError } from "./http";
import { marketSourceById } from "./sources";

/** Як часто переперевіряти сторінку. */
export const MARKET_REFRESH_DAYS = 7;
/** Після стількох невдач поспіль сторінку забуваємо — наступний обхід знайде нову. */
const MAX_FAILS = 4;
const HOST_PAUSE_MS = 1200;

export type MarketRefreshResult = {
  checked: number;
  updated: number;
  failed: number;
  removed: number;
  /** Скільки цін вітрини змінилось після перерахунку. */
  priceChanged: number;
};

export async function refreshMarketPrices(
  opts: { limit?: number; budgetMs?: number; dry?: boolean } = {}
): Promise<MarketRefreshResult> {
  const limit = opts.limit ?? 250;
  const deadline = Date.now() + (opts.budgetMs ?? 10 * 60_000);
  const out: MarketRefreshResult = { checked: 0, updated: 0, failed: 0, removed: 0, priceChanged: 0 };

  const due = await prisma.marketPrice.findMany({
    where: { checkedAt: { lt: new Date(Date.now() - MARKET_REFRESH_DAYS * 86_400_000) } },
    orderBy: { checkedAt: "asc" },
    take: limit,
    select: { id: true, productId: true, source: true, url: true, price: true, failCount: true },
  });
  if (due.length === 0) return out;

  const bySource = new Map<string, typeof due>();
  for (const row of due) bySource.set(row.source, [...(bySource.get(row.source) ?? []), row]);

  const touched = new Set<string>();

  const failOne = async (row: (typeof due)[number], gone: boolean) => {
    out.failed++;
    if (opts.dry) return;
    if (gone || row.failCount + 1 >= MAX_FAILS) {
      await prisma.marketPrice.delete({ where: { id: row.id } });
      out.removed++;
      touched.add(row.productId);
    } else {
      await prisma.marketPrice.update({
        where: { id: row.id },
        data: { failCount: row.failCount + 1, checkedAt: new Date() },
      });
    }
  };

  await Promise.all(
    [...bySource].map(async ([sourceId, rows]) => {
      const source = marketSourceById(sourceId);
      for (const row of rows) {
        if (Date.now() > deadline) break;
        out.checked++;
        try {
          if (!source) {
            await failOne(row, true);
            continue;
          }
          const html = await fetchPage(row.url, { challenge: source.challenge });
          const offer = source.extract(html);
          if (!offer) {
            await failOne(row, false);
          } else {
            const now = new Date();
            const moved = Math.abs(offer.price - row.price) > 0.5;
            if (!opts.dry) {
              await prisma.marketPrice.update({
                where: { id: row.id },
                data: {
                  price: offer.price,
                  inStock: offer.inStock,
                  seenAt: now,
                  checkedAt: now,
                  failCount: 0,
                  ...(moved ? { changedAt: now } : {}),
                },
              });
            }
            out.updated++;
            if (moved) touched.add(row.productId);
          }
        } catch (e) {
          const gone = e instanceof HttpError && (e.status === 404 || e.status === 410);
          await failOne(row, gone).catch(() => {});
        }
        await new Promise((r) => setTimeout(r, HOST_PAUSE_MS));
      }
    })
  );

  if (!opts.dry && touched.size > 0) {
    out.priceChanged = (await repriceProducts({ productIds: [...touched] })).priceChanged;
  }
  return out;
}
