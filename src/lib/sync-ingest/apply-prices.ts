/**
 * Застосування цін із зрізу 1С.
 *
 * Промо-поля (isPromo/promoPrice/promoLabel) — власність сайту, синхронізація
 * їх не торкається: акція живе в маркетингу, а не в обліку.
 *
 * Захист від помилок в 1С: зміна ціни більш ніж у PRICE_SANITY_FACTOR разів
 * не застосовується одразу, а спершу реєструється як розбіжність. Типова
 * причина — зміна одиниці виміру (ціна за упаковку замість штуки) або помилка
 * оператора.
 *
 * Але «не застосовується» не означає «ніколи»: якщо 1С називає ту саму ціну і
 * наступної доби, це вже не одруківка, а рішення — і ми його приймаємо. Без
 * цього запобіжник перетворювався на замок: 22 товари стояли з цінами старого
 * імпорту, поки 1С щоночі просила їх виправити. Мастило продавалось по 35 ₴
 * замість 209 ₴, а розетка висіла з 20 199 ₴ замість 48 ₴ — тобто сторож,
 * поставлений берегти від помилкової ціни, сам тримав помилкову ціну.
 */

import { prisma } from "@/lib/prisma";
import type { PriceRecord } from "./types";
import { ApplyContext } from "./context";

const PRICE_EPSILON = 0.01;
const PRICE_SANITY_FACTOR = 5;
/**
 * Скільки має «відлежатись» підозріла ціна, щоб її прийняти.
 *
 * 12 годин, бо повний зріз цін приходить раз на добу (нічний прогін): та сама
 * ціна на наступну ніч — це підтвердження, а не повтор одруківки. Менший поріг
 * нічого не дав би (інкрементальні прогони віддають лише змінені ціни), більший
 * розтягнув би виправлення на кілька днів.
 */
const PRICE_CONFIRM_HOURS = 12;

/**
 * Чи називала 1С цю саму ціну раніше — достатньо давно, щоб вважати її свідомою.
 *
 * Питаємо журнал розбіжностей, а не окрему таблицю: відхилення там і так
 * пишуться, тож історія вже є, і другого джерела правди не заводимо. Запит
 * робиться лише для підозрілих цін — їх одиниці на добу.
 */
async function confirmedEarlier(entityRef: string, value1C: string): Promise<boolean> {
  const prior = await prisma.syncDiscrepancy.findFirst({
    where: {
      field: "price_rejected",
      entityRef,
      value1C,
      createdAt: { lt: new Date(Date.now() - PRICE_CONFIRM_HOURS * 3600_000) },
    },
    select: { id: true },
  });
  return prior !== null;
}

/** Чи виглядає нова ціна як помилка на тлі старої. */
function isSuspicious(oldPrice: number, newPrice: number): boolean {
  if (oldPrice <= 0 || newPrice <= 0) return false; // з/на нуль — легітимно
  const ratio = newPrice > oldPrice ? newPrice / oldPrice : oldPrice / newPrice;
  return ratio > PRICE_SANITY_FACTOR;
}

export async function applyPrices(records: PriceRecord[], ctx: ApplyContext): Promise<void> {
  if (records.length === 0) return;

  const externalIds = records.map((r) => r.externalId);

  const products = await prisma.product.findMany({
    where: { externalId: { in: externalIds } },
    select: { id: true, externalId: true, sku: true, name: true, price: true, wholesalePrice: true },
  });
  const byExternalId = new Map(products.map((p) => [p.externalId!, p]));

  // «Ціну підтвердив зріз 1С» — до циклу, одним запитом, годинником бази.
  // Та сама механіка, що для сальдо дебіторки, і з тих самих причин:
  // зріз віддає лише ціни > 0, тож прибрана ціна не приходить нулем, а
  // позиція просто зникає з вивантаження. Див. reconcile-prices.ts.
  if (!ctx.isPreview) {
    await prisma.$executeRaw`
      UPDATE "Product" SET "priceSyncedAt" = now()
      WHERE "externalId" = ANY(${externalIds}::text[])
    `;
  }

  for (const rec of records) {
    const product = byExternalId.get(rec.externalId);

    // Ціна на товар, якого ще немає на сайті — нормально, якщо батч товарів
    // ще не доїхав. Наступний цикл підхопить.
    if (!product) {
      ctx.skipped++;
      continue;
    }

    const updates: Record<string, number> = {};

    if (rec.retail !== undefined && Number.isFinite(rec.retail)) {
      if (Math.abs((product.price || 0) - rec.retail) > PRICE_EPSILON) {
        const entityRef = product.sku || rec.externalId;
        const suspicious = isSuspicious(product.price || 0, rec.retail);
        // Підозрілу ціну приймаємо з другого разу: 1С повторила її наступної
        // доби — отже, це не промах оператора.
        const confirmed = suspicious && (await confirmedEarlier(entityRef, String(rec.retail)));

        if (suspicious && !confirmed) {
          ctx.discrepancy({
            entityType: "product",
            entityRef,
            entityName: product.name,
            field: "price_rejected",
            value1C: String(rec.retail),
            valueBudvik: String(product.price),
          });
        } else {
          if (confirmed) {
            // Окреме поле, щоб в адмінці було видно саме розблокування, а не
            // звичайну зміну ціни: різниця тут велика і варта людського ока.
            ctx.discrepancy({
              entityType: "product",
              entityRef,
              entityName: product.name,
              field: "price_confirmed",
              value1C: String(rec.retail),
              valueBudvik: String(product.price),
            });
          }
          if (!confirmed) {
            ctx.discrepancy({
              entityType: "product",
              entityRef,
              entityName: product.name,
              field: "price",
              value1C: String(rec.retail),
              valueBudvik: String(product.price),
            });
          }
          updates.price = rec.retail;
        }
      }
    }

    if (rec.wholesale !== undefined && Number.isFinite(rec.wholesale)) {
      const current = product.wholesalePrice ?? 0;
      if (Math.abs(current - rec.wholesale) > PRICE_EPSILON) {
        if (isSuspicious(current, rec.wholesale)) {
          ctx.discrepancy({
            entityType: "product",
            entityRef: product.sku || rec.externalId,
            entityName: product.name,
            field: "wholesalePrice_rejected",
            value1C: String(rec.wholesale),
            valueBudvik: String(product.wholesalePrice ?? "—"),
          });
        } else {
          updates.wholesalePrice = rec.wholesale;
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      ctx.skipped++;
      continue;
    }

    if (ctx.isPreview) {
      ctx.updated++;
      continue;
    }

    try {
      await prisma.product.update({
        where: { id: product.id },
        data: { ...updates, syncedAt: new Date(), syncSource: "1C" },
      });
      ctx.updated++;
    } catch (e) {
      ctx.fail(product.name, e);
    }
  }
}
