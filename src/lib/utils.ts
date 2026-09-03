import { OrderStatus } from "@prisma/client";

export function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(" ");
}

/** Нерозривний пробіл: між тисячами й перед знаком гривні. */
const NBSP = "\u00A0";

/**
 * Ціна у гривнях. Свідомо без Intl.
 *
 * Було: Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH" }).
 * Знак валюти для uk-UA він бере з CLDR, а версія CLDR у Node на Vercel і в
 * браузері відвідувача — різна: Node 22 (CLDR 47) друкує «1 234 ₴», Chrome
 * 151 (CLDR 48) на тих самих даних — «1 234 грн». Для React це різний текст
 * на сервері й на клієнті: гідратація падає з #418 і Next перемальовує все
 * піддерево наново — на кожній картці головної й каталогу, на телефоні
 * покупця. Формат ціни — рішення магазину, а не CLDR, тож рахуємо самі й
 * отримуємо однаковий рядок скрізь: у SSR, у браузері, у застосунку.
 *
 * Поведінка збережена один-в-один: копійки показуємо лише коли вони є
 * (0,5 ₴ — не «0,50 ₴»), округлення до копійки від нуля.
 */
export function formatPrice(price: number): string {
  const value = Number.isFinite(price) ? price : 0;
  const cents = Math.round(Math.abs(value) * 100);

  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const frac = cents % 100;
  // 0 → без дробової частини, 50 → «,5», 7 → «,07»
  const tail = frac === 0 ? "" : `,${String(frac).padStart(2, "0").replace(/0$/, "")}`;

  return `${value < 0 && cents > 0 ? "-" : ""}${whole}${tail}${NBSP}\u20B4`;
}

/**
 * Українська множина: «1 позиція», «2 позиції», «5 позицій».
 *
 * Intl.PluralRules сюди не годиться: він каже, яка форма потрібна, але не
 * знає самих слів, тож форми все одно довелось би тримати поруч — а разом
 * із ними приїхала б залежність від версії CLDR у середовищі, на якій уже
 * одного разу розійшлися сервер і браузер (див. formatPrice).
 *
 * @param forms [одна, дві, п'ять]
 */
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  const tens = abs % 100;
  if (tens > 10 && tens < 20) return forms[2];
  const ones = abs % 10;
  if (ones === 1) return forms[0];
  if (ones >= 2 && ones <= 4) return forms[1];
  return forms[2];
}

/** «1 518 позицій» — з нерозривними пробілами між тисячами. */
export function formatCount(n: number, forms: [string, string, string]): string {
  const digits = String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${digits}${NBSP}${plural(n, forms)}`;
}

/** Найчастіша пара на вітрині — розділи каталогу. */
export const POSITIONS: [string, string, string] = ["позиція", "позиції", "позицій"];

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

/**
 * Тільки дата, без години: «28.08.2026».
 *
 * Для маршрутів і змін година — шум: маршрут живе добою, і час його
 * створення нікому нічого не каже. А от у вузькій колонці телефона він
 * переносив дату на другий рядок і ламав шапку картки.
 */
export function formatDayDate(date: Date | string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

/**
 * Дата документа, що приїхав з 1С, — рівно так, як її показує 1С.
 *
 * Агент віддає дату БЕЗ зсуву: «2026-08-26T14:29:38» — це стінний час
 * Києва, але сервер (він у UTC) читає такий рядок як UTC і кладе в базу
 * 14:29:38Z. На телефоні в Києві звичайний formatDate розвертає це назад у
 * місцевий час і додає три години: документ, який у 1С стоїть о 14:29,
 * показувався о 17:29. Торговий тримає поруч Impuls і наш екран — розбіжність
 * у три години читається як «дані не ті».
 *
 * Тому такі дати форматуємо в UTC: зсув, якого не було, ми й не додаємо, і
 * час на екрані збігається з 1С посимвольно.
 *
 * Це саме показ, а не виправлення: у базі документи 1С і далі лежать зі
 * зміщеним моментом, тож фільтр київської доби відносить вечірні документи
 * до наступного дня. Виправляти це треба на прийомі, разом з міграцією всієї
 * історії, — окремою роботою.
 */
export function formatDocDate(date: Date | string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

/**
 * Оплата — при отриманні, тож «Очікує оплати» більше не описує стан: нове
 * замовлення одразу йде в роботу, а PAID означає підтвердження менеджером.
 * Значення enum лишились ті самі — перейменування зачепило б драйверський
 * контур, фільтри адмінки і всі наявні рядки.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Нове",
  PAID: "Підтверджено",
  PACKAGING: "На упакуванні",
  IN_TRANSIT: "В дорозі",
  DELIVERED: "Доставлено",
  CANCELLED: "Скасовано",
};

export const DELIVERY_METHOD_LABELS: Record<"DELIVERY" | "PICKUP", string> = {
  DELIVERY: "Доставка",
  PICKUP: "Самовивіз",
};

export const PAYMENT_METHOD_LABELS: Record<"COD", string> = {
  COD: "Оплата при отриманні",
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  PENDING: "bg-[#FFF8E1] text-[#B8860B]",
  PAID: "bg-[#E3F2FD] text-[#1565C0]",
  PACKAGING: "bg-[#F3E8FF] text-[#7C3AED]",
  IN_TRANSIT: "bg-[#FFF3E0] text-[#E65100]",
  DELIVERED: "bg-[#E8F5E9] text-[#2E7D32]",
  CANCELLED: "bg-[#FFEAEA] text-[#C62828]",
};

export const BOLTS_CASHBACK_RATE = 0.05; // 5%
export const BOLTS_MAX_USAGE_RATE = 0.3; // 30% of order total

/**
 * Шлях для повернення після входу — тільки всередині сайту.
 *
 * Перевірка на «/» без другого «/» відсікає `//evil.com`: браузер читає
 * такий шлях як протокол-відносний URL і повів би людину на чужий домен.
 */
export function safeRelativePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return /^\/(?!\/)/.test(raw) ? raw : null;
}

/**
 * Те саме, але приймає ще й повну адресу свого ж сайту.
 *
 * Навіщо окремо від safeRelativePath. Коли людину відсіває middleware,
 * посилання на вхід складає не наш код, а next-auth, і callbackUrl там
 * завжди абсолютний: /sales/catalog перетворюється на
 * `/login?callbackUrl=https%3A%2F%2Fwww.budvik27.com%2Fsales%2Fcatalog`.
 * Для safeRelativePath це «не шлях», тож він віддавав null — і після входу
 * людина опинялась на головній своєї ролі, а не там, куди йшла. Найчастіше
 * це бачив торговий: пішов у каталог, увійшов, отямився на показниках.
 *
 * Чому не послабили safeRelativePath. Він лишається вузьким і придатним
 * там, де вікна немає (його двійник живе в api/device/session). Тут же
 * походження звіряємо з реальним походженням сторінки, а не з константою:
 * сайт відповідає і на apex, і на www, і зашитий домен відкидав би
 * половину випадків.
 *
 * Чужий домен, `//evil.com` і протокол javascript: не проходять: URL
 * розкриває їх у повну адресу, і origin не збігається.
 */
export function callbackPath(raw: string | null | undefined): string | null {
  const relative = safeRelativePath(raw);
  if (relative) return relative;
  if (!raw || typeof window === "undefined") return null;

  try {
    // Навмисно без бази: з нею будь-яке сміття добудувалося б до нашого ж
    // домену, і `?callbackUrl=abc` після входу вело б на 404 замість
    // домівки за роллю. Без бази відносне й неадреса кидають виняток —
    // тобто сюди доходить лише те, що справді є повною адресою.
    const url = new URL(raw);
    if (url.origin !== window.location.origin) return null;
    return safeRelativePath(`${url.pathname}${url.search}${url.hash}`);
  } catch {
    return null;
  }
}
