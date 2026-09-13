/**
 * Тексти, групування й правила часу для стрічки торгового.
 *
 * Чисті функції без бази — саме їх ганяє scripts/check-rep-feed.mts без
 * підключення. Усе, що вирішує «слати чи ні» за станом бази (стеля на день,
 * курсор), живе в notify.ts.
 */

import { kyivDate, kyivHour } from "@/lib/date/kyiv";
import { REP_FEED_TYPES, type FeedEvent, type RepFeedType } from "./types";

/** Пуші лише в робочі години за Києвом: [від, до). Поза ними — лише рядок. */
export const PUSH_FROM_HOUR = 8;
export const PUSH_TO_HOUR = 19;

/**
 * Стеля пушів на торгового за день. Понад неї події все одно пишуться в
 * стрічку — просто без сповіщення. Дванадцять — це «до одного на годину»
 * робочого дня; більше вже вимикають каналом.
 */
export const DAILY_PUSH_CAP = 12;

/**
 * Аварійне гальмо: стільки подій за один тік — це не день торгових, а
 * бекфіл або збій обміну. Рядки пишемо, пушів не шлемо.
 */
export const MAX_EVENTS_PER_TICK = 200;

/**
 * Документ або оплата з датою 1С старшою за стільки днів — не новина.
 * Ріже нічний повний прогін, ковзне вікно обміну в три доби й бекфіли
 * рознесення оплат, які створюють рядки «зараз» для старих платежів.
 */
export const DOC_FLOOR_DAYS = 2;

/** Перекриття курсора: годинники Vercel і Railway різні, дублі гасить dedupKey. */
export const CURSOR_OVERLAP_MS = 60_000;

const DAY_MS = 24 * 60 * 60_000;

/** «8 400» — без копійок, з нерозривними пробілами між розрядами. */
export function uah(n: number): string {
  return Math.round(n).toLocaleString("uk-UA").replace(/\s/g, " ");
}

export function eventsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "подія";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "події";
  return "подій";
}

/** «Химич» замість «ФОП Химич Іван Петрович (Стрий)» — у пуші місця мало. */
export function shortName(name: string | null | undefined, max = 32): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "Клієнт";
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/**
 * Межа дати документів 1С: північ дня (сьогодні − days) за Києвом, узята
 * як UTC. Свідомо UTC, а не kyivDayStart: агент віддає стінний київський
 * час без зсуву, і сервер зберігає його як UTC (див. заголовок
 * src/lib/track/orders-today.ts). Друге перекладання зсунуло б день.
 */
export function docDayFloor(now: Date, days = DOC_FLOOR_DAYS): Date {
  const today = new Date(`${kyivDate(now)}T00:00:00.000Z`);
  return new Date(today.getTime() - days * DAY_MS);
}

export function inPushHours(now: Date): boolean {
  const h = kyivHour(now);
  return h >= PUSH_FROM_HOUR && h < PUSH_TO_HOUR;
}

export type DescribeInput =
  | { type: "REP_PAYMENT"; name: string | null | undefined; amount: number; balance: number | null }
  | { type: "REP_DOC_POSTED"; name: string | null | undefined; number: string; amount: number }
  | { type: "REP_DOC_PICKED"; name: string | null | undefined; number: string; amount: number; lines: number }
  | { type: "REP_RETURN"; name: string | null | undefined; number: string; amount: number }
  | { type: "REP_DOC_DELIVERED"; name: string | null | undefined; number: string; amount: number };

/**
 * Заголовок і тіло для одного типу події.
 *
 * Про борг після оплати. Оплата приїжджає з 1С за 5 хвилин, а сальдо
 * боргу — окремим каналом раз на годину. Тож у мить пуша
 * `receivableBalance` майже завжди ще не знає про цю оплату. Віднімаємо
 * її самі й пишемо «≈»: якщо сальдо вже оновилось — воно й так менше на
 * цю суму, і нуль лишиться нулем.
 */
export function describe(input: DescribeInput): { title: string; body: string } {
  const name = shortName(input.name);
  switch (input.type) {
    case REP_FEED_TYPES.PAYMENT: {
      const left =
        input.balance == null ? null : Math.max(0, Math.round(input.balance - input.amount));
      return {
        title: `${name} заплатив ${uah(input.amount)} ₴`,
        body: left == null ? "Оплата в касу" : left > 0 ? `Борг клієнта тепер ≈ ${uah(left)} ₴` : "Борг клієнта тепер ≈ 0 ₴",
      };
    }
    case REP_FEED_TYPES.DOC_POSTED:
      return { title: `Проведено №${input.number}`, body: `${name} · ${uah(input.amount)} ₴` };
    case REP_FEED_TYPES.DOC_PICKED:
      return {
        title: `Зібрано №${input.number}`,
        body: `${name} · ${uah(input.amount)} ₴ · ${input.lines} поз.`,
      };
    case REP_FEED_TYPES.RETURN:
      return {
        title: `Повернення від ${name}`,
        body: `№${input.number} · −${uah(Math.abs(input.amount))} ₴`,
      };
    case REP_FEED_TYPES.DOC_DELIVERED:
      return { title: `Доставлено №${input.number}`, body: `${name} · ${uah(input.amount)} ₴` };
  }
}

export type GroupedPush = { title: string; body: string; target: string };

/** Скільки заголовків перелічуємо у зведеному пуші, далі — «і ще N». */
const GROUP_HEAD = 3;

/**
 * Кілька подій одного торгового за один тік — один пуш.
 *
 * Одна подія йде як є. Кілька — «3 події у клієнтів» із першими
 * заголовками; ціль спільна, якщо всі про одне й те саме, інакше головна
 * кабінету, де стрічка й лежить.
 */
export function groupPush(events: Pick<FeedEvent, "title" | "body" | "target">[]): GroupedPush {
  if (events.length === 0) throw new Error("groupPush: порожній список");
  if (events.length === 1) {
    const [e] = events;
    return { title: e.title, body: e.body, target: e.target };
  }
  const n = events.length;
  const head = events.slice(0, GROUP_HEAD).map((e) => e.title);
  const rest = n - head.length;
  const body = rest > 0 ? `${head.join(" · ")} і ще ${rest}` : head.join(" · ");
  const targets = new Set(events.map((e) => e.target));
  return {
    title: `${n} ${eventsWord(n)} у клієнтів`,
    body,
    target: targets.size === 1 ? events[0].target : "/sales",
  };
}

/** Для журналу й скриптів: коротка назва типу українською. */
export const TYPE_LABELS: Record<RepFeedType, string> = {
  REP_PAYMENT: "оплата",
  REP_DOC_POSTED: "проведено",
  REP_DOC_PICKED: "зібрано",
  REP_RETURN: "повернення",
  REP_DOC_DELIVERED: "доставлено",
};
