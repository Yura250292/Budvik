/**
 * Тексти, групування й правила часу для стрічки торгового.
 *
 * Чисті функції без бази — саме їх ганяє scripts/check-rep-feed.mts без
 * підключення. Усе, що вирішує «слати чи ні» за станом бази (стеля на день,
 * курсор, вимкнені категорії), живе в notify.ts.
 */

import { kyivDate, kyivDayStart, kyivHour } from "@/lib/date/kyiv";
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

export type ArrivalItemText = { name: string; clients: string[] };

/** Скільки товарів перелічуємо в тілі пуша про прихід. */
const ARRIVAL_HEAD = 3;

/**
 * «Приїхало: 7 позицій для ваших клієнтів» / «SOMA FIX Піна-клей PROFIT 750
 * (37 кл.) · … і ще 4». Товари вже впорядковані за тим, скільки клієнтів
 * торгового їх беруть.
 *
 * Кількість, а не імена: перший прогін з іменами в дужках давав
 * «(Городецька Св. ма…, ФОП Городецький І…)» — у пуші це не читається.
 * Хто саме бере — на сторінці приходу.
 */
export function describeArrival(items: ArrivalItemText[]): { title: string; body: string } {
  const n = items.length;
  const head = items.slice(0, ARRIVAL_HEAD).map((i) => {
    const k = i.clients.length;
    return k > 0 ? `${shortName(i.name, 30)} (${k} кл.)` : shortName(i.name, 30);
  });
  const rest = n - head.length;
  return {
    title: `Приїхало: ${n} ${plural(n, "позиція", "позиції", "позицій")} для ваших клієнтів`,
    body: rest > 0 ? `${head.join(" · ")} і ще ${rest}` : head.join(" · "),
  };
}

/** День тижня київського дня «YYYY-MM-DD»: 0 — неділя. */
function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Попередній робочий день (пн–пт) перед `day`. */
export function previousWorkday(day: string): string {
  let d = addDays(day, -1);
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDays(d, -1);
  return d;
}

/** Година, о якій іде пуш про прихід, і межа вікна. */
export const ARRIVAL_HOUR = 10;

/** Година ранкового пуша про подорожчання і межа його вікна. */
export const PRICE_HOUR = 9;

/** Година п'ятничного підсумку тижня. */
export const WEEK_HOUR = 16;

export function isKyivFriday(now: Date): boolean {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", weekday: "short" }).format(now) === "Fri";
}

/** Понеділок тижня київського дня «YYYY-MM-DD». */
export function weekStart(day: string): string {
  const wd = weekdayOf(day);
  return addDays(day, -(wd === 0 ? 6 : wd - 1));
}

/** Нижче цього минулий тиждень не база для відсотка: «+29988%» від 37 ₴ — шум. */
export const WEEK_PCT_MIN_BASE = 5000;
/** Більша зміна — майже завжди разова велика накладна чи повернення, а не тренд. */
export const WEEK_PCT_MAX_ABS = 300;

/**
 * «Ваш тиждень: 312 400 ₴ продажів» / «+12% до минулого · накладних 41 ·
 * клієнтів 23 · зібрано 280 100 ₴ · місце 3 з 9».
 *
 * Відсоток — лише від відчутної бази й у розумних межах. Від'ємний оборот
 * (повернення більші за продажі) називаємо прямо, зі справжнім мінусом, і
 * без відсотка: «−502%» нічого не пояснює.
 */
export function describeWeek(input: {
  revenue: number;
  prevRevenue: number;
  docs: number;
  collected: number;
  clients: number;
  place: number | null;
  of: number;
}): { title: string; body: string } {
  const parts: string[] = [];
  if (input.revenue > 0 && input.prevRevenue >= WEEK_PCT_MIN_BASE) {
    const pct = Math.round(((input.revenue - input.prevRevenue) / input.prevRevenue) * 100);
    if (Math.abs(pct) <= WEEK_PCT_MAX_ABS) parts.push(`${pct >= 0 ? "+" : "−"}${Math.abs(pct)}% до минулого`);
  }
  if (input.docs > 0) parts.push(`накладних ${input.docs}`);
  if (input.clients > 0) parts.push(`клієнтів ${input.clients}`);
  if (input.collected > 0) parts.push(`зібрано ${uah(input.collected)} ₴`);
  if (input.place && input.of > 1) parts.push(`місце ${input.place} з ${input.of}`);
  const title =
    input.revenue < 0
      ? `Ваш тиждень: −${uah(Math.abs(input.revenue))} ₴ чистого обороту з поверненнями`
      : `Ваш тиждень: ${uah(input.revenue)} ₴ продажів`;
  return { title, body: parts.join(" · ") };
}

/**
 * Скільки годин після призначеної ранкове зведення ще може прийти.
 *
 * Зведення йде лише тому, хто сьогодні працює (відкрив зміну або має трек).
 * Хто почав день на годину-дві пізніше, з вікном в одну годину не отримав би
 * нічого. Раз на день гарантує ключ дедуплікації по дню, а не година.
 */
export const DIGEST_GRACE_HOURS = 3;

export function inDigestWindow(now: Date, hour: number): boolean {
  const h = kyivHour(now);
  return h >= hour && h < hour + DIGEST_GRACE_HOURS;
}

/**
 * Вікно подорожчання: від PRICE_HOUR попереднього робочого дня до PRICE_HOUR
 * сьогодні. На відміну від приходу, межі — справжній час (UTC): changedAt
 * ставить сам сайт, а не 1С.
 */
export function priceWindow(day: string): { from: Date; to: Date } {
  const h = PRICE_HOUR * 60 * 60_000;
  return {
    from: new Date(kyivDayStart(previousWorkday(day)).getTime() + h),
    to: new Date(kyivDayStart(day).getTime() + h),
  };
}

/**
 * База порівняння й відсоток. Опт — коли він є з обох боків, інакше
 * роздріб. null — порівнювати нема з чим (стара ціна нуль).
 */
export function priceBasis(r: {
  oldPrice: number;
  newPrice: number;
  oldWholesale: number | null;
  newWholesale: number | null;
}): { basis: "wholesale" | "retail"; oldValue: number; newValue: number; pct: number } | null {
  const wholesale = (r.oldWholesale ?? 0) > 0 && (r.newWholesale ?? 0) > 0;
  const oldValue = wholesale ? (r.oldWholesale as number) : r.oldPrice;
  const newValue = wholesale ? (r.newWholesale as number) : r.newPrice;
  if (!(oldValue > 0)) return null;
  return {
    basis: wholesale ? "wholesale" : "retail",
    oldValue,
    newValue,
    pct: Math.round(((newValue - oldValue) / oldValue) * 1000) / 10,
  };
}

/** «Подорожчало: 5 позицій для ваших клієнтів» / «Піна SOMA FIX +8% · …». */
export function describePriceUp(items: { name: string; pct: number }[]): { title: string; body: string } {
  const n = items.length;
  const head = items.slice(0, 3).map((i) => `${shortName(i.name, 30)} +${Math.round(i.pct)}%`);
  const rest = n - head.length;
  return {
    title: `Подорожчало: ${n} ${plural(n, "позиція", "позиції", "позицій")} для ваших клієнтів`,
    body: rest > 0 ? `${head.join(" · ")} і ще ${rest}` : head.join(" · "),
  };
}

/**
 * Вікно приходу для дня: від ARRIVAL_HOUR попереднього робочого дня до
 * ARRIVAL_HOUR цього. У понеділок воно охоплює п'ятницю після десятої й
 * вихідні, тож нічого не губиться і нічого не приходить двічі.
 *
 * Межі — у «стінному» київському часі, записаному як UTC: так лежать дати
 * документів 1С (див. docDayFloor).
 */
export function arrivalWindow(day: string): { from: Date; to: Date } {
  const hh = String(ARRIVAL_HOUR).padStart(2, "0");
  return {
    from: new Date(`${previousWorkday(day)}T${hh}:00:00.000Z`),
    to: new Date(`${day}T${hh}:00:00.000Z`),
  };
}

/** «Приїхало під ваш запит: Піна SOMA FIX» / «Вільно 24 шт · Арт. 12345». */
export function describeWatch(input: { name: string; sku: string | null; free: number }): { title: string; body: string } {
  return {
    title: `Приїхало під ваш запит: ${shortName(input.name, 40)}`,
    body: `Вільно ${input.free} шт${input.sku ? ` · Арт. ${input.sku}` : ""}`,
  };
}

/** «сьогодні», «завтра», «ср, 16.09». `day` і `today` — київські дні. */
export function routeDayLabel(day: string, today: string): string {
  if (day === today) return "сьогодні";
  if (day === addDays(today, 1)) return "завтра";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("uk-UA", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

/** «Поїде завтра: Химич» / «Накладна №6553 · 12 400 ₴ · лист №1865 · водій Пайда Василь». */
export function describeRoute(input: {
  name: string | null | undefined;
  number: string;
  amount: number;
  day: string;
  today: string;
  driver: string | null;
  sheetNumber: string;
}): { title: string; body: string } {
  return {
    title: `Поїде ${routeDayLabel(input.day, input.today)}: ${shortName(input.name, 30)}`,
    body: `Накладна №${input.number} · ${uah(input.amount)} ₴ · лист №${input.sheetNumber}${
      input.driver ? ` · водій ${input.driver}` : ""
    }`,
  };
}

export type GroupedPush = { title: string; body: string; target: string };

/** Скільки заголовків перелічуємо у зведеному пуші, далі — «і ще N». */
const GROUP_HEAD = 3;

/**
 * Кілька подій одного торгового за один тік — один пуш.
 *
 * Одна подія йде як є. Кілька — «3 події у клієнтів» із першими
 * заголовками; ціль спільна, якщо всі про одне й те саме, інакше сторінка
 * стрічки /sales/feed, де вони всі й лежать.
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
    target: targets.size === 1 ? events[0].target : "/sales/feed",
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
  REP_ARRIVAL: "прихід",
  REP_ROUTE: "у маршруті",
  REP_WATCH: "під запит",
  REP_PRICE_UP: "подорожчання",
  REP_REQUEST_DONE: "заявка",
  REP_WEEK: "тиждень",
  REP_TASK: "задача",
  REP_TASK_DONE: "виконано",
  REP_MEETING: "нарада",
};
