/**
 * Тексти, групування й правила часу для стрічки торгового.
 *
 * Чисті функції без бази — саме їх ганяє scripts/check-rep-feed.mts без
 * підключення. Усе, що вирішує «слати чи ні» за станом бази (стеля на день,
 * курсор, вимкнені категорії), живе в notify.ts.
 */

import { kyivDate, kyivHour } from "@/lib/date/kyiv";
import { REP_FEED_TYPES, type FeedEvent, type RepFeedType } from "./types";

/** Пуші лише в робочі години за Києвом: [від, до). Поза ними — лише рядок. */
export const PUSH_FROM_HOUR = 8;
export const PUSH_TO_HOUR = 19;

/**
 * Стеля пушів на торгового за день. Понад неї події все одно пишуться в
 * стрічку — просто без сповіщення. Вісім — це менше ніж один на годину
 * робочого дня; власник просив «щоб не було спаму», і це той запобіжник,
 * який спрацьовує, навіть коли групування не впоралося.
 */
export const DAILY_PUSH_CAP = 8;

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

/** Українська множина: plural(3, "день", "дні", "днів") → "дні". */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function eventsWord(n: number): string {
  return plural(n, "подія", "події", "подій");
}

/** «сьогодні», «вчора», «3 дні тому», «40 днів тому». */
export function daysAgo(n: number): string {
  const d = Math.max(0, Math.round(n));
  if (d === 0) return "сьогодні";
  if (d === 1) return "вчора";
  return `${d} ${plural(d, "день", "дні", "днів")} тому`;
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

/** Межі київського дня для дат 1С (той самий принцип, що docDayFloor). */
export function docDayBounds(day: string): { from: Date; to: Date } {
  return {
    from: new Date(`${day}T00:00:00.000Z`),
    to: new Date(`${day}T23:59:59.999Z`),
  };
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
 * Заголовок і тіло для однієї події документа чи оплати.
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

export type VisitInput = {
  name: string | null | undefined;
  debt: number;
  overdue: number;
  /** Вік найстарішої непогашеної частини, днів. */
  oldestDays: number;
  /** Скільки днів минуло від останнього замовлення; null — не замовляв. */
  lastOrderDaysAgo: number | null;
  /** Назви товарів, які варто запропонувати, у порядку ваги. */
  recommend: string[];
};

/** Скільки назв товарів уміщаємо в картку візиту. */
const VISIT_RECO = 3;

/**
 * Картка перед візитом. Повертає null, коли сказати нічого: без боргу й
 * без порад пуш «Ви у Химича» — це шум, і людина навчиться його гасити.
 */
export function describeVisit(input: VisitInput): { title: string; body: string } | null {
  const recos = input.recommend.filter(Boolean).slice(0, VISIT_RECO);
  if (input.debt <= 0 && recos.length === 0) return null;

  const parts: string[] = [];
  if (input.debt > 0) {
    const overdue =
      input.overdue > 0
        ? ` (прострочено ${uah(input.overdue)}, ${Math.round(input.oldestDays)} дн)`
        : "";
    parts.push(`Борг ${uah(input.debt)} ₴${overdue}`);
  }
  if (input.lastOrderDaysAgo != null) {
    parts.push(`останнє замовлення ${daysAgo(input.lastOrderDaysAgo)}`);
  }
  if (recos.length > 0) {
    parts.push(`поповнити: ${recos.map((r) => shortName(r, 30)).join(", ")}`);
  }
  // Заголовок пуша вміщає ~45 знаків: повне ім'я з містом важливіше за обрізок.
  return { title: `Ви у ${shortName(input.name, 44)}`, body: parts.join(" · ") };
}

export type CallListItem = { name: string | null | undefined; action: string };

/** Скільки клієнтів перелічуємо в тілі пуша про дзвінки. */
const CALL_LIST_HEAD = 3;

export function describeCallList(items: CallListItem[]): { title: string; body: string } {
  const n = items.length;
  const head = items.slice(0, CALL_LIST_HEAD).map((i) => `${shortName(i.name, 24)} — ${i.action}`);
  const rest = n - head.length;
  return {
    title: `Кому подзвонити сьогодні: ${n}`,
    body: rest > 0 ? `${head.join(" · ")} і ще ${rest}` : head.join(" · "),
  };
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
  REP_VISIT: "візит",
  REP_CALL_LIST: "дзвінки",
};
