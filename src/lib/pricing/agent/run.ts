/**
 * Розклад агента цін для воркера (worker/index.ts).
 *
 *   - щоночі 01:00–06:00 за Києвом: переперевірка відомих сторінок (раз на
 *     тиждень на сторінку) і пошук сторінок для кількох товарів без ринкової
 *     ціни — не більше PRICE_AGENT_PER_NIGHT (типово 10) за ніч;
 *   - щопонеділка з 08:00: пропозиції на тиждень і підсумок у Telegram.
 *
 * Ціну на вітрині тут не змінює ніщо: її ставить адмін, затверджуючи
 * пропозицію в /admin/pricing.
 */
import { prisma } from "@/lib/prisma";
import { kyivHour } from "@/lib/date/kyiv";
import { sendTelegramMessage } from "@/lib/telegram/notify";
import { refreshMarketPrices } from "../market/refresh";
import { discoverMarketPages } from "./discover";
import { buildProposals, isoWeek } from "./propose";

const NIGHT = { from: 1, to: 6 };
const PROPOSALS_HOUR = 8;
const WEEK_STATE_KEY = "pricing:proposalsWeek";
/** Товарів на один тік воркера (15 хв): кожен пошук — до хвилини роботи моделі. */
const DISCOVERY_PER_TICK = 3;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.budvik27.com";

/**
 * Скільки товарів шукати за ніч. Проба 14.09.2026: знайдений товар коштує
 * близько $0,12, відсутній у мережі — до $0,3. Десять за ніч — це приблизно
 * $10–17 на тиждень і 70 товарів.
 */
const perNight = () => {
  const raw = process.env.PRICE_AGENT_PER_NIGHT;
  const v = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : 10;
};

const kyivWeekday = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", weekday: "short" }).format(d);

let warnedNoKey = false;

export async function runNightlyMarketWork(now = new Date()): Promise<string | null> {
  const hour = kyivHour(now);
  if (hour < NIGHT.from || hour >= NIGHT.to) return null;

  const refresh = await refreshMarketPrices({ limit: 250, budgetMs: 8 * 60_000 });

  const doneTonight = await prisma.marketLookup.count({
    where: { lookedAt: { gte: new Date(now.getTime() - 12 * 3600_000) } },
  });
  const quota = Math.max(0, perNight() - doneTonight);
  const discovery =
    quota > 0 ? await discoverMarketPages({ limit: Math.min(DISCOVERY_PER_TICK, quota), budgetMs: 5 * 60_000 }) : null;

  if (discovery?.skipped === "no_api_key" && !warnedNoKey) {
    warnedNoKey = true;
    console.warn("агент цін: ANTHROPIC_API_KEY не налаштовано — пошук нових сторінок вимкнено");
  }

  const parts: string[] = [];
  if (refresh.checked > 0) {
    parts.push(`перевірено сторінок ${refresh.checked}, ціну прочитано ${refresh.updated}, невдач ${refresh.failed}, прибрано ${refresh.removed}`);
  }
  if (discovery && !discovery.skipped && discovery.looked > 0) {
    parts.push(
      `пошук: товарів ${discovery.looked}, сторінок знайдено ${discovery.pagesFound}, прийнято ${discovery.pagesAccepted}, пошуків ${discovery.searches}, ≈$${discovery.costUsd}` +
        (discovery.errors.length ? `, помилки: ${discovery.errors.slice(0, 3).join(" | ")}` : "")
    );
  }
  return parts.length ? parts.join("; ") : null;
}

export async function runWeeklyProposals(now = new Date(), opts: { force?: boolean } = {}): Promise<string | null> {
  if (!opts.force && (kyivWeekday(now) !== "Mon" || kyivHour(now) < PROPOSALS_HOUR)) return null;

  const week = isoWeek(now);
  if (!opts.force) {
    const state = await prisma.syncState.findUnique({ where: { key: WEEK_STATE_KEY } });
    if (state?.value === week) return null;
  }

  const r = await buildProposals({ now });
  await prisma.syncState.upsert({
    where: { key: WEEK_STATE_KEY },
    create: { key: WEEK_STATE_KEY, value: week },
    update: { value: week },
  });

  const summary = `пропозиції ${week}: нових ${r.created} (дешевше ${r.cheaper}, дорожче ${r.dearer}, на підлозі ${r.belowFloor}), без змін ${r.kept + r.unchanged}, чекають рішення ${r.pendingTotal}`;

  const chatId = process.env.DIGEST_CHAT_ID || process.env.SYNC_ALERT_CHAT_ID;
  if (chatId && r.created > 0) {
    await sendTelegramMessage(
      chatId,
      [
        `<b>Ціни: пропозиції агента, тиждень ${week}</b>`,
        `Нових: ${r.created} — дешевше ${r.cheaper}, дорожче ${r.dearer}.`,
        r.belowFloor ? `Ринок дешевший за нашу підлогу: ${r.belowFloor}.` : null,
        `Чекають рішення: ${r.pendingTotal}.`,
        `Затвердити: ${SITE_URL}/admin/pricing`,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  return summary;
}
