/**
 * Оборотність складу: що рухається, що лежить, скільки в цьому грошей.
 *
 * Питання, на яке відповідає звіт: склад — це запас чи це склад? На базі
 * зараз 6 789 позицій із залишком, і 4 120 із них (14,5 млн ₴ у цінах
 * продажу) не рухалися жодного разу за 90 днів. Половина складу лежить.
 *
 * ВАЖЛИВО про гроші. Запас оцінюється за СОБІВАРТІСТЮ там, де вона відома, і
 * за ціною продажу там, де ні. Собівартість береться з останнього продажу
 * товару (SalesDocumentItem.purchasePrice, який тепер приходить з
 * РегистрНакопления.ПродажиСебестоимость) — це найближче до «скільки грошей
 * у цій позиції лежить».
 *
 * Змішувати дві бази довелося б у будь-якому разі: товар, який ніколи не
 * продавався, собівартості не має, а саме таких на складі 3 099 позицій —
 * викинути їх зі звіту означало б сховати найбільшу частину неліквіду.
 * Тому звіт віддає `costKnownValue` / `priceOnlyValue` окремо, і інтерфейс
 * зобов'язаний показати, яка частина оцінки чого варта.
 *
 * Оборотність рахуємо в ШТУКАХ (скільки разів запас обернувся за період), а
 * не класичним COGS / середній запас: у знаменнику мав би стояти середній
 * запас за період, а ми маємо лише зріз «на зараз».
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Вікно, за яким визначається рух. Те саме, що в звіті закупівель
 * (lib/procurement/low-stock.ts): дефіцит і неліквід — дві сторони одного
 * питання, і рахувати їх за різними вікнами означало б давати
 * закупівельникові два різні уявлення про той самий товар.
 */
const VELOCITY_DAYS = 90;

/** Скільки днів запасу вважати надлишком: понад півроку продажів на полиці. */
const OVERSTOCK_DAYS = 180;

export type StaleBucket = "never" | "d365" | "d180" | "d90";

/** Групи неліквіду за давністю останнього продажу. */
export const STALE_LABELS: Record<StaleBucket, string> = {
  never: "жодного продажу",
  d365: "понад рік тому",
  d180: "180–365 днів тому",
  d90: "90–180 днів тому",
};

export type TurnoverBrand = {
  brandId: string | null;
  brandName: string;
  /** Позицій із залишком. */
  items: number;
  /** Позицій без руху за VELOCITY_DAYS. */
  stale: number;
  stockQty: number;
  /** Вартість запасу в цінах продажу. */
  stockValue: number;
  staleValue: number;
  /** Продано штук за вікно (нетто). */
  sold: number;
  /**
   * Скільки разів запас обернувся за рік у поточному темпі.
   * null — продажів за вікно не було взагалі.
   */
  turns: number | null;
  /** На скільки днів вистачить залишку в поточному темпі; null — не продається. */
  daysOfStock: number | null;
};

export type StaleItem = {
  id: string;
  sku: string | null;
  name: string;
  brandName: string;
  stock: number;
  price: number;
  value: number;
  bucket: StaleBucket;
  /** Днів від останнього продажу; null — не продавався ніколи. */
  daysSinceSale: number | null;
};

export type TurnoverReport = {
  velocityDays: number;
  /**
   * Змішана оцінка: собівартість там, де відома, ціна продажу — де ні.
   * Фронт зобов'язаний показати розклад (costKnownValue / priceOnlyValue).
   */
  valuedAt: "cost_where_known";
  totals: {
    items: number;
    stockValue: number;
    /** Скільки позицій оцінено за реальною собівартістю, і на яку суму. */
    costKnownItems: number;
    costKnownValue: number;
    /** Решта — оцінені за прайсом, тобто завищені на маржу. */
    priceOnlyValue: number;
    stale: number;
    staleValue: number;
    /** Частка «мертвих» грошей у складі, %. */
    staleShare: number;
    overstock: number;
    overstockValue: number;
    sold: number;
    turns: number | null;
  };
  byBrand: TurnoverBrand[];
  byBucket: Array<{ bucket: StaleBucket; label: string; items: number; value: number }>;
  worst: StaleItem[];
};

type RawProduct = {
  id: string;
  sku: string | null;
  name: string;
  brandId: string | null;
  brandName: string | null;
  stock: number;
  price: number;
  /** Собівартість за одиницю з останнього продажу; 0 — невідома. */
  unitCost: number;
  sold90: number;
  lastSale: Date | null;
};

const DAY_MS = 86_400_000;

function bucketOf(lastSale: Date | null, now: number): StaleBucket {
  if (!lastSale) return "never";
  const days = (now - lastSale.getTime()) / DAY_MS;
  if (days >= 365) return "d365";
  if (days >= 180) return "d180";
  return "d90";
}

/**
 * Будує звіт оборотності.
 *
 * `brandId` звужує до одного бренду — так закупівельник дивиться свій
 * напрямок, не гортаючи весь склад.
 */
export async function buildTurnoverReport(
  brandId?: string | null,
  worstLimit = 100
): Promise<TurnoverReport> {
  const brandCondition = brandId ? Prisma.sql`AND p."brandId" = ${brandId}` : Prisma.empty;

  // Один запит замість трьох проходів: залишок, швидкість і дата останнього
  // продажу зводяться в SQL. У каталозі 49 тисяч позицій, тягнути їх у Node
  // заради двох агрегатів — найдорожча частина будь-якого складського звіту
  // (той самий урок, що й у low-stock.ts).
  const rows = await prisma.$queryRaw<RawProduct[]>`
    WITH sold AS (
      SELECT i."productId", SUM(i.quantity)::float AS qty
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" IN ('REALIZATION', 'RETURN')
        AND s."createdAt" >= NOW() - (${VELOCITY_DAYS} * INTERVAL '1 day')
      GROUP BY i."productId"
    ),
    last_sale AS (
      SELECT i."productId", MAX(s."createdAt") AS ts
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
      GROUP BY i."productId"
    ),
    last_cost AS (
      -- Собівартість з ОСТАННЬОГО продажу, де вона відома. DISTINCT ON бере
      -- перший рядок кожної групи в заданому порядку — тобто найсвіжіший.
      -- Рядки з нулем відсіяні: нуль тут означає «не приїхало», і брати його
      -- за собівартість означало б оцінити запас у нуль гривень.
      SELECT DISTINCT ON (i."productId")
        i."productId",
        i."purchasePrice" AS cost
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
        AND i."purchasePrice" > 0
      ORDER BY i."productId", s."createdAt" DESC
    )
    SELECT
      p.id, p.sku, p.name, p."brandId",
      b.name AS "brandName",
      p.stock::float AS stock,
      p.price::float AS price,
      COALESCE(lc.cost, 0)::float AS "unitCost",
      COALESCE(sd.qty, 0)::float AS "sold90",
      ls.ts AS "lastSale"
    FROM "Product" p
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    LEFT JOIN sold sd ON sd."productId" = p.id
    LEFT JOIN last_sale ls ON ls."productId" = p.id
    LEFT JOIN last_cost lc ON lc."productId" = p.id
    WHERE p."isActive"
      -- Тільки номенклатура з 1С: позиції без externalId — старі записи
      -- магазину, яких в обліку немає, і залишок у них фіктивний.
      AND p."externalId" IS NOT NULL
      AND p.stock > 0
      ${brandCondition}
  `;

  const now = Date.now();
  // Сервісні позиції «РЕМОНТ …» — не товар на полиці, а послуга.
  const goods = rows.filter((p) => !/^РЕМОНТ/i.test(p.name.trim()));

  const brands = new Map<string, TurnoverBrand>();
  const buckets = new Map<StaleBucket, { items: number; value: number }>();
  const stale: StaleItem[] = [];

  let stockValue = 0;
  let staleValue = 0;
  let staleCount = 0;
  let overstock = 0;
  let overstockValue = 0;
  let soldTotal = 0;
  let costKnownItems = 0;
  let costKnownValue = 0;
  let priceOnlyValue = 0;

  for (const p of goods) {
    // Собівартість, якщо товар колись продавався і вона приїхала з 1С;
    // інакше прайс — завищено на маржу, і саме тому обидві суми віддаються
    // окремо (див. коментар угорі файлу).
    const hasCost = p.unitCost > 0;
    const value = p.stock * (hasCost ? p.unitCost : p.price);
    if (hasCost) {
      costKnownItems++;
      costKnownValue += value;
    } else {
      priceOnlyValue += value;
    }
    // Повернення можуть перекрити продажі — тоді нетто від'ємне, і для
    // швидкості це те саме, що нуль: товар нікуди не поїхав.
    const sold = Math.max(0, p.sold90);
    const perDay = sold / VELOCITY_DAYS;
    const daysOfStock = perDay > 0 ? p.stock / perDay : null;
    const isStale = sold <= 0;

    stockValue += value;
    soldTotal += sold;

    if (isStale) {
      staleCount++;
      staleValue += value;
      const bucket = bucketOf(p.lastSale, now);
      const agg = buckets.get(bucket) ?? { items: 0, value: 0 };
      agg.items++;
      agg.value += value;
      buckets.set(bucket, agg);

      stale.push({
        id: p.id,
        sku: p.sku,
        name: p.name,
        brandName: p.brandName ?? "—",
        stock: p.stock,
        price: p.price,
        value,
        bucket,
        daysSinceSale: p.lastSale ? Math.round((now - p.lastSale.getTime()) / DAY_MS) : null,
      });
    } else if (daysOfStock !== null && daysOfStock > OVERSTOCK_DAYS) {
      // Надлишок — не неліквід: товар продається, але запасу набрано на
      // роки. Гроші так само заморожені, а рішення інше (не розпродаж, а
      // пауза в закупівлі), тому рахуємо окремо.
      overstock++;
      overstockValue += value;
    }

    const key = p.brandId ?? "—";
    const agg =
      brands.get(key) ??
      ({
        brandId: p.brandId,
        brandName: p.brandName ?? "— без бренду —",
        items: 0,
        stale: 0,
        stockQty: 0,
        stockValue: 0,
        staleValue: 0,
        sold: 0,
        turns: null,
        daysOfStock: null,
      } satisfies TurnoverBrand);

    agg.items++;
    agg.stockQty += p.stock;
    agg.stockValue += value;
    agg.sold += sold;
    if (isStale) {
      agg.stale++;
      agg.staleValue += value;
    }
    brands.set(key, agg);
  }

  // Оборотів на рік: скільки разів наявний запас «згорить» у поточному темпі.
  // Рахується по бренду в цілому, а не як середнє по товарах — інакше одна
  // рідкісна позиція з мікрозалишком роздувала б показник напрямку.
  const turnsOf = (sold: number, qty: number): number | null =>
    qty > 0 && sold > 0 ? (sold / qty) * (365 / VELOCITY_DAYS) : null;

  const byBrand = [...brands.values()]
    .map((b) => ({
      ...b,
      turns: turnsOf(b.sold, b.stockQty),
      daysOfStock: b.sold > 0 ? (b.stockQty / (b.sold / VELOCITY_DAYS)) : null,
    }))
    .sort((a, b) => b.staleValue - a.staleValue || b.stockValue - a.stockValue);

  const byBucket = (["never", "d365", "d180", "d90"] as const)
    .map((bucket) => ({
      bucket,
      label: STALE_LABELS[bucket],
      items: buckets.get(bucket)?.items ?? 0,
      value: buckets.get(bucket)?.value ?? 0,
    }))
    .filter((b) => b.items > 0);

  // Найдорожчий мертвий запас угорі: саме з нього починають розпродаж.
  stale.sort((a, b) => b.value - a.value);

  const stockQtyTotal = goods.reduce((s, p) => s + p.stock, 0);

  return {
    velocityDays: VELOCITY_DAYS,
    valuedAt: "cost_where_known",
    totals: {
      items: goods.length,
      stockValue,
      costKnownItems,
      costKnownValue,
      priceOnlyValue,
      stale: staleCount,
      staleValue,
      staleShare: stockValue > 0 ? (staleValue / stockValue) * 100 : 0,
      overstock,
      overstockValue,
      sold: soldTotal,
      turns: turnsOf(soldTotal, stockQtyTotal),
    },
    byBrand,
    byBucket,
    worst: stale.slice(0, worstLimit),
  };
}
