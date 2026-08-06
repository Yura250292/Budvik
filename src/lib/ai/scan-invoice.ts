import { prisma } from "@/lib/prisma";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = "gemini-2.5-flash";

export interface ScannedItem {
  name: string;
  sku?: string;
  quantity: number;
  price: number;
  unit?: string;
}

export interface ScannedDocument {
  type: "purchase" | "sales";
  number?: string;
  date?: string;
  counterpartyName?: string;
  counterpartyCode?: string;
  items: ScannedItem[];
  totalAmount?: number;
  notes?: string;
}

export interface MatchedProduct {
  id: string;
  name: string;
  sku: string | null;
  currentPrice: number;
}

export interface MatchedItem extends ScannedItem {
  matched: MatchedProduct | null;
}

export interface MatchedCounterparty {
  id: string;
  name: string;
  code: string | null;
  type: string;
}

/** Помилка розпізнавання з HTTP-статусом для мапінгу у відповідь роуту. */
export class ScanError extends Error {
  status: number;
  raw?: string;

  constructor(message: string, status: number, raw?: string) {
    super(message);
    this.name = "ScanError";
    this.status = status;
    this.raw = raw;
  }
}

export const INVOICE_SYSTEM_PROMPT = `Ти — експерт з розпізнавання документів. Тобі дають фото видаткової накладної, прихідної накладної, рахунку або іншого торгового документа.

Твоє завдання — витягти ВСЮ інформацію з документа та повернути її в JSON форматі.

Правила:
1. Визнач тип документа: "purchase" (прихідна/закупівля) або "sales" (видаткова/продаж)
2. Знайди номер документа, дату
3. Знайди назву контрагента (постачальник або покупець) та його код (ЄДРПОУ) якщо є
4. Для КОЖНОГО товару в таблиці витягни: назву, артикул/код (якщо є), кількість, ціну за одиницю, одиницю виміру
5. Знайди загальну суму документа
6. Якщо є додаткові примітки — включи їх

ВАЖЛИВО:
- Ціна — це ціна ЗА ОДИНИЦЮ, а не за рядок
- Кількість — числове значення
- Якщо щось не вдається прочитати — пропусти, не вигадуй
- Поверни ТІЛЬКИ валідний JSON, без markdown обгортки

Формат відповіді:
{
  "type": "purchase" | "sales",
  "number": "номер документа",
  "date": "дата у форматі YYYY-MM-DD",
  "counterpartyName": "назва контрагента",
  "counterpartyCode": "ЄДРПОУ або код",
  "items": [
    {
      "name": "назва товару",
      "sku": "артикул якщо є",
      "quantity": 10,
      "price": 150.50,
      "unit": "шт"
    }
  ],
  "totalAmount": 1505.00,
  "notes": "додаткові примітки"
}`;

/**
 * Розпізнає фото документа через Gemini 2.5 Flash.
 * Кидає ScanError зі статусом 429 / 422 / 500.
 */
export async function scanInvoiceImage(
  base64: string,
  mimeType: string
): Promise<{ scanned: ScannedDocument; raw: string }> {
  if (!GEMINI_API_KEY) {
    throw new ScanError("AI сервіс не налаштований", 500);
  }

  const url = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: "Розпізнай цей документ (накладну/рахунок). Витягни всю інформацію." },
          ],
        },
      ],
      systemInstruction: { parts: [{ text: INVOICE_SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
      },
    }),
  });

  if (!res.ok) {
    if (res.status === 429) {
      throw new ScanError("AI сервіс перевантажений. Спробуйте через хвилину.", 429);
    }
    throw new ScanError(`AI помилка: ${res.status}`, 500);
  }

  const data = await res.json();
  const rawText: string = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  // Знімаємо markdown-обгортку, якщо модель її додала
  let jsonStr = rawText.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let scanned: ScannedDocument;
  try {
    scanned = JSON.parse(jsonStr);
  } catch {
    throw new ScanError(
      "AI не зміг розпізнати документ. Спробуйте краще фото.",
      422,
      rawText
    );
  }

  if (!scanned || typeof scanned !== "object") {
    throw new ScanError(
      "AI не зміг розпізнати документ. Спробуйте краще фото.",
      422,
      rawText
    );
  }

  if (!Array.isArray(scanned.items)) scanned.items = [];

  return { scanned, raw: rawText };
}

const PRODUCT_SELECT = { id: true, name: true, sku: true, price: true } as const;

function toMatched(p: {
  id: string;
  name: string;
  sku: string | null;
  price: number;
}): MatchedProduct {
  return { id: p.id, name: p.name, sku: p.sku, currentPrice: p.price };
}

/**
 * Фаззі-матчинг позицій до наявних товарів: артикул → точна назва → значущі слова.
 * Пакетні запити замість пер-позиційних: для накладної на 30 рядків це 2-3 запити
 * замість ~150.
 */
export async function matchItemsToProducts(
  items: ScannedItem[]
): Promise<MatchedItem[]> {
  if (!items.length) return [];

  const result: MatchedItem[] = items.map((item) => ({ ...item, matched: null }));

  // 1) Пакетний матчинг за артикулом
  const skus = Array.from(
    new Set(items.map((i) => i.sku).filter((s): s is string => !!s && !!s.trim()))
  );
  if (skus.length) {
    const bySku = await prisma.product.findMany({
      where: { sku: { in: skus } },
      select: PRODUCT_SELECT,
    });
    const skuMap = new Map(bySku.map((p) => [p.sku, p]));
    result.forEach((item) => {
      if (item.matched || !item.sku) return;
      const found = skuMap.get(item.sku);
      if (found) item.matched = toMatched(found);
    });
  }

  // 2) Пакетний матчинг за точною назвою (без урахування регістру)
  const pending = result.filter((i) => !i.matched && i.name?.trim());
  if (pending.length) {
    const names = Array.from(new Set(pending.map((i) => i.name.trim())));
    const byName = await prisma.product.findMany({
      where: { name: { in: names, mode: "insensitive" } },
      select: PRODUCT_SELECT,
    });
    const nameMap = new Map(byName.map((p) => [p.name.toLowerCase(), p]));
    pending.forEach((item) => {
      const found = nameMap.get(item.name.trim().toLowerCase());
      if (found) item.matched = toMatched(found);
    });
  }

  // 3) Для решти — пошук за входженням повної назви.
  //
  // Свідомо НЕ шукаємо за одним словом: у базі 40k+ товарів, і збіг по
  // одному слову дає абсурдні результати («Ялинка зелена 150 см» →
  // «Штуцер ... "ялинка" FI 25», «Куля скляна» → «Циркулярна пила»).
  // Краще не зіставити нічого, ніж підставити чужий товар — адмін
  // однаково звіряє з фото.
  const stillPending = result.filter((i) => !i.matched && i.name?.trim());
  for (const item of stillPending) {
    const cleaned = item.name.trim();

    // Точне входження всієї назви
    let product = await prisma.product.findFirst({
      where: { name: { contains: cleaned, mode: "insensitive" } },
      select: PRODUCT_SELECT,
    });

    // Якщо ні — пробуємо назву без хвоста в дужках/після коми
    if (!product) {
      const core = cleaned.split(/[(,]/)[0].trim();
      if (core.length >= 8 && core !== cleaned) {
        product = await prisma.product.findFirst({
          where: { name: { contains: core, mode: "insensitive" } },
          select: PRODUCT_SELECT,
        });
      }
    }

    if (product) item.matched = toMatched(product);
  }

  return result;
}

/** Матчинг контрагента: спершу за кодом (ЄДРПОУ), потім за назвою. */
export async function matchCounterparty(
  name?: string,
  code?: string
): Promise<MatchedCounterparty | null> {
  if (code) {
    const byCode = await prisma.counterparty.findUnique({
      where: { code },
      select: { id: true, name: true, code: true, type: true },
    });
    if (byCode) return byCode;
  }

  if (name) {
    const byName = await prisma.counterparty.findFirst({
      where: { name: { contains: name, mode: "insensitive" } },
      select: { id: true, name: true, code: true, type: true },
    });
    if (byName) return byName;
  }

  return null;
}

/** Зручна обгортка: розпізнавання + матчинг товарів і контрагента. */
export async function scanAndMatch(
  base64: string,
  mimeType: string
): Promise<{
  scanned: ScannedDocument;
  items: MatchedItem[];
  matchedCounterparty: MatchedCounterparty | null;
  raw: string;
}> {
  const { scanned, raw } = await scanInvoiceImage(base64, mimeType);

  const [items, matchedCounterparty] = await Promise.all([
    matchItemsToProducts(scanned.items || []),
    matchCounterparty(scanned.counterpartyName, scanned.counterpartyCode),
  ]);

  return { scanned, items, matchedCounterparty, raw };
}
