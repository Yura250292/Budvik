"use client";

/**
 * Клієнтський збір вебаналітики.
 *
 * Три правила, з яких випливає весь код нижче:
 *
 * 1. Жодних кук. Каталог і картки товару живуть на ISR, а читання cookies
 *    у серверному компоненті мовчки вимикає кеш для всієї сторінки — на
 *    цьому вже одного разу згорів рахунок Vercel. Тому ідентифікатори
 *    відвідувача тримаємо в localStorage, і на сервер вони їдуть у тілі
 *    запиту, а не заголовком.
 *
 * 2. Пачками, а не поштучно. Кожна подія окремим запитом — це виклик
 *    serverless-функції на кожен клік. Черга флашиться раз на 15 секунд і
 *    на приховання вкладки.
 *
 * 3. Аналітика ніколи не ламає сайт. Усі публічні функції загорнуті так,
 *    щоб виняток (заблокований localStorage у приватному режимі, вимкнене
 *    сховище) не долітав до коду магазину.
 */

export type WebstatsEventType =
  | "page_view"
  | "product_view"
  | "search"
  | "add_to_cart"
  | "add_to_wishlist"
  | "add_to_compare"
  | "order_placed"
  | "phone_click";

export interface WebstatsPayload {
  path?: string | null;
  productId?: string | null;
  query?: string | null;
  label?: string | null;
  value?: number | null;
  referrer?: string | null;
}

interface QueuedEvent extends WebstatsPayload {
  t: WebstatsEventType;
}

const VID_KEY = "bv_vid";
const SID_KEY = "bv_sid";
const SID_TS_KEY = "bv_sid_ts";

/** Пауза, після якої повернення на сайт вважаємо новим візитом. */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const FLUSH_INTERVAL_MS = 15_000;
/** Стеля черги: якщо флаш не проходить, ростимо не до нескінченності. */
const MAX_QUEUE = 50;
const ENDPOINT = "/api/site-events";

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|scrape/i;

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

/** Читання сховища не мусить валити сторінку в приватному режимі Safari. */
function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* сховище недоступне — подія просто поїде без стабільного id */
  }
}

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Чи взагалі варто рахувати цього відвідувача.
 *
 * Ботів відсіюємо ще на клієнті, щоб не платити за їхні запити; сервер
 * перевіряє UA вдруге — на випадок саморобного клієнта, що б'є в ендпоінт
 * напряму.
 */
export function isTrackable(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator;
  if (!nav) return false;
  if (nav.webdriver) return false;
  if (BOT_RE.test(nav.userAgent || "")) return false;
  return true;
}

export function getVisitorId(): string {
  let id = readStore(VID_KEY);
  if (!id) {
    id = randomId();
    writeStore(VID_KEY, id);
  }
  return id;
}

/**
 * Id сесії з ковзним тайм-аутом: кожна подія продовжує сесію, і лише
 * півгодини тиші починають нову.
 */
export function getSessionId(): string {
  const now = Date.now();
  const prev = readStore(SID_KEY);
  const ts = Number(readStore(SID_TS_KEY) || 0);

  let id = prev;
  if (!id || !ts || now - ts > SESSION_TIMEOUT_MS) {
    id = randomId();
    writeStore(SID_KEY, id);
  }
  writeStore(SID_TS_KEY, String(now));
  return id;
}

/** Чи ця подія — перша в сесії (для запису реферера). */
export function isNewSession(): boolean {
  const ts = Number(readStore(SID_TS_KEY) || 0);
  return !readStore(SID_KEY) || !ts || Date.now() - ts > SESSION_TIMEOUT_MS;
}

/**
 * Разові події в межах сесії.
 *
 * Перегляд товару рахуємо раз на сесію на товар, інакше людина, що
 * гортає туди-сюди між карткою і каталогом, виглядала б як десять
 * переглядів. sessionStorage, а не пам'ять: у ньому позначка переживає
 * перезавантаження сторінки, але не нову вкладку-сесію.
 */
export function markOnce(key: string): boolean {
  try {
    const full = `bv_seen_${key}`;
    if (sessionStorage.getItem(full)) return false;
    sessionStorage.setItem(full, "1");
    return true;
  } catch {
    return true;
  }
}

export function track(type: WebstatsEventType, payload: WebstatsPayload = {}) {
  if (!isTrackable()) return;
  try {
    // Сесію торкаємось до запису події: getSessionId продовжує вікно
    // активності, і саме його результат поїде з пачкою.
    getSessionId();
    if (queue.length >= MAX_QUEUE) return;
    queue.push({ t: type, ...payload });
    ensureTimer();
  } catch {
    /* аналітика мовчки здається, сайт працює далі */
  }
}

function ensureTimer() {
  if (timer || typeof window === "undefined") return;
  timer = setInterval(() => {
    if (queue.length === 0) {
      // Порожній таймер щохвилини нікому не потрібен: зупиняємось і
      // прокидаємось на наступній події.
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    flush();
  }, FLUSH_INTERVAL_MS);
}

/**
 * Відправка пачки.
 *
 * sendBeacon переживає закриття вкладки — саме тому він тут головний, а
 * fetch keepalive лишається запасним для браузерів без beacon.
 */
export function flush() {
  if (queue.length === 0) return;
  const events = queue;
  queue = [];

  const body = JSON.stringify({
    v: 1,
    vid: getVisitorId(),
    sid: getSessionId(),
    events,
  });

  try {
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      if (ok) return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* мережа лягла — пачку втрачаємо навмисно: аналітика не варта ретраїв */
  }
}

/** Вішає флаш на приховання вкладки. Викликається один раз із трекера. */
export function startWebstats() {
  if (started || typeof window === "undefined" || !isTrackable()) return;
  started = true;

  const onHide = () => {
    if (document.visibilityState === "hidden") flush();
  };
  document.addEventListener("visibilitychange", onHide);
  // pagehide, а не unload: у Safari лише він надійно спрацьовує при
  // переході «назад» і при згортанні застосунку.
  window.addEventListener("pagehide", flush);
}
