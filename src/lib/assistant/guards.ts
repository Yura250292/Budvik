/**
 * Запобіжник від вигаданих клієнтів і товарів.
 *
 * Модель не має доступу до бази, але охоче добудовує правдоподібне: якщо
 * в питанні звучало «Ромашка», вона напише посилання на «Ромашку», навіть
 * коли жоден інструмент її не повертав. Текст при цьому виглядає
 * бездоганно — і саме тому небезпечний.
 *
 * Тому правило просте: посилатися можна лише на те, що модель БАЧИЛА в
 * результаті інструмента. Ідентифікатори збираються з видачі, а посилання
 * у відповіді звіряються з цим списком. Невідоме перетворюється на
 * звичайний текст — відповідь лишається, зникає лише хибний перехід.
 */

/** Що модель бачила: клієнти та товари (товар — з артикулом для пошуку). */
export type SeenEntities = {
  clients: Set<string>;
  products: Map<string, string | null>;
  /**
   * Усі числа з результатів інструментів ЦЬОГО ходу.
   *
   * Потрібні числовому вартовому: сума у відповіді має походити з даних,
   * а не з памʼяті моделі. Через розмови не переносяться — перевіряти
   * торішні числа в новій відповіді немає сенсу.
   */
  numbers: Set<number>;
  /** Торгові, згадані інструментами цього ходу — для посилань на картку. */
  reps: Set<string>;
};

export function emptyEntities(): SeenEntities {
  return { clients: new Set(), products: new Map(), reps: new Set(), numbers: new Set() };
}

const CLIENT_KEYS = new Set(["клієнт_id", "counterpartyId"]);
const PRODUCT_KEYS = new Set(["товар_id", "productId"]);
/**
 * Торгові — лише в помічника керівника, і лише вони.
 *
 * У водія й складовщика картки торгового немає взагалі (розділ під
 * ADMIN/MANAGER), тож посилання туди вело б у «Доступ заборонено». Саме
 * тому ключі тут лише українські: вони трапляються ТІЛЬКИ в інструментах
 * керівника. Латинський repId навмисно не збираємо — він є і в аргументах
 * інших інструментів, і тоді торговий міг би отримати посилання в
 * заборонений йому розділ.
 */
const REP_KEYS = new Set(["торговий_id", "водій_id"]);

/** Обходить результат інструмента й збирає id, які модель побачить. */
export function collectEntities(
  value: unknown,
  into: SeenEntities = emptyEntities()
): SeenEntities {
  walk(value, into);
  return into;
}

function walk(value: unknown, into: SeenEntities) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, into);
    return;
  }
  if (!value || typeof value !== "object") return;

  const obj = value as Record<string, unknown>;
  for (const [key, raw] of Object.entries(obj)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      into.numbers.add(Math.round(raw));
      // Відсотки приходять із десятковою частиною («7,5»), а в тексті
      // модель пише їх так само — тримаємо обидва вигляди.
      into.numbers.add(Math.round(raw * 10) / 10);
    }
    if (typeof raw === "string") {
      if (CLIENT_KEYS.has(key)) {
        into.clients.add(raw);
      } else if (PRODUCT_KEYS.has(key)) {
        const sku = typeof obj["артикул"] === "string" ? (obj["артикул"] as string) : null;
        into.products.set(raw, sku ?? into.products.get(raw) ?? null);
      } else if (REP_KEYS.has(key)) {
        into.reps.add(raw);
      }
    }
    walk(raw, into);
  }
}

/** Плоский список id — його зберігаємо разом із повідомленням інструмента. */
export function entityIdList(entities: SeenEntities): string[] {
  return [...entities.clients, ...entities.products.keys(), ...entities.reps];
}

/**
 * Числа у відповіді, які ЗУСТРІЧАЮТЬСЯ у виданих даних.
 *
 * Модель не бачить бази, але вміє впевнено написати суму, якої їй ніхто
 * не показував, — і саме така відповідь найнебезпечніша: вона виглядає
 * як усі інші. Тут кожне число з тексту звіряється з тим, що справді
 * повернули інструменти цього ходу.
 *
 * ЩО НЕ РАХУЄМО ПОМИЛКОЮ:
 * • відсотки — їх модель законно РАХУЄ («78,9 % від обороту»), і жодна
 *   з двох сум, з яких вони вийшли, від цього не стає вигаданою;
 * • дрібні числа (до 40) — це «5 клієнтів», «за 30 днів», номери пунктів;
 * • роки й дати — вони не з бази, а з календаря;
 * • числа, які людина сама назвала в питанні;
 * • суми, які збігаються з даними після заокруглення до сотні: модель
 *   має право написати «12 300» там, де в даних 12 297.
 */
export type NumberCheck = { checked: number; unverified: number[] };

const NUMBER_RE = /(?<![\w./-])(\d{1,3}(?:[\s\u00A0\u202F]\d{3})+|\d+(?:[.,]\d+)?)(?![\w./-])/g;

/** Нижче цього числа вважаємо лічильником, а не сумою з бази. */
const SMALL = 40;

export function verifyNumbers(answer: string, question: string, seen: SeenEntities): NumberCheck {
  const fromQuestion = new Set<number>();
  for (const m of question.matchAll(NUMBER_RE)) {
    fromQuestion.add(parseNumber(m[1]));
  }

  const unverified: number[] = [];
  let checked = 0;

  // Дати («2026-09-06», «06.09») до перевірки не потрапляють: NUMBER_RE
  // не бере числа, приклеєні до крапки чи дефіса з обох боків.
  for (const m of answer.matchAll(NUMBER_RE)) {
    const value = parseNumber(m[1]);
    if (!Number.isFinite(value)) continue;
    if (Math.abs(value) <= SMALL) continue;
    // Відсоток одразу за числом — ознака порахованого, а не взятого.
    if (/^\s*%/.test(answer.slice(m.index + m[0].length))) continue;
    if (value >= 1900 && value <= 2100 && Number.isInteger(value)) continue;
    if (fromQuestion.has(value)) continue;

    checked++;
    if (isKnown(value, seen.numbers)) continue;
    unverified.push(value);
  }

  return { checked, unverified };
}

function parseNumber(raw: string): number {
  return Number(raw.replace(/[\s\u00A0\u202F]/g, "").replace(",", "."));
}

/** Точний збіг, або збіг після заокруглення — до сотні й до десятків. */
function isKnown(value: number, known: Set<number>): boolean {
  if (known.has(value)) return true;
  const rounded = [Math.round(value), Math.round(value * 10) / 10];
  if (rounded.some((r) => known.has(r))) return true;

  for (const step of [10, 100, 1000]) {
    if (value % step !== 0) continue;
    for (const k of known) {
      if (Math.round(k / step) * step === value) return true;
    }
  }
  return false;
}

const LINK_RE = /\[([^\]]{1,120})\]\((client|product|rep):([A-Za-z0-9_-]{6,40})\)/g;

/**
 * Переписує службові посилання у справжні адреси кабінету.
 *
 * Модель пише `client:ID`, бо адреси вона писати не мусить — і не мусить
 * знати, що завтра розділ переїде. Тут вони стають шляхами сайту, а
 * невідомі id — просто назвою без посилання.
 */
export function rewriteLinks(
  answer: string,
  entities: SeenEntities
): { text: string; stripped: number } {
  let stripped = 0;

  const text = answer.replace(LINK_RE, (_full, label: string, kind: string, entityId: string) => {
    if (kind === "client") {
      if (!entities.clients.has(entityId)) {
        stripped++;
        return label;
      }
      return `[${label}](/sales/clients/${entityId})`;
    }

    if (kind === "rep") {
      // Картка торгового живе в адмінці — туди веде лише помічник
      // керівника, і лише по тих, кого справді показав інструмент.
      if (!entities.reps.has(entityId)) {
        stripped++;
        return label;
      }
      return `[${label}](/admin/sales-reps/${entityId})`;
    }

    if (!entities.products.has(entityId)) {
      stripped++;
      return label;
    }
    // Картки товару в кабінеті немає — ведемо в каталог пошуком за
    // артикулом. Без артикула посилання не буде: пошук за назвою з
    // пробілами дає випадковий результат, а це гірше за просто текст.
    const sku = entities.products.get(entityId);
    if (!sku) return label;
    return `[${label}](/sales/catalog/list?search=${encodeURIComponent(sku)})`;
  });

  return { text, stripped };
}
