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
};

export function emptyEntities(): SeenEntities {
  return { clients: new Set(), products: new Map() };
}

const CLIENT_KEYS = new Set(["клієнт_id", "counterpartyId"]);
const PRODUCT_KEYS = new Set(["товар_id", "productId"]);

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
    if (typeof raw === "string") {
      if (CLIENT_KEYS.has(key)) {
        into.clients.add(raw);
      } else if (PRODUCT_KEYS.has(key)) {
        const sku = typeof obj["артикул"] === "string" ? (obj["артикул"] as string) : null;
        into.products.set(raw, sku ?? into.products.get(raw) ?? null);
      }
    }
    walk(raw, into);
  }
}

/** Плоский список id — його зберігаємо разом із повідомленням інструмента. */
export function entityIdList(entities: SeenEntities): string[] {
  return [...entities.clients, ...entities.products.keys()];
}

const LINK_RE = /\[([^\]]{1,120})\]\((client|product):([A-Za-z0-9_-]{6,40})\)/g;

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
