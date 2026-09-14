/**
 * Ціни з 1С → сирий ціновий шар (Price1C) → рушій цін вітрини.
 *
 * Обмін більше не пише ціну вітрини сам. Він зберігає, що назвала 1С, а
 * скільки товар коштує на сайті, вирішує рушій (src/lib/pricing/engine.ts):
 * опт × націнка з поправкою на сайти виробників. Див. docs/pricing.md.
 *
 * Промо-поля (isPromo/promoPrice/promoLabel) — власність сайту, обмін їх не
 * торкається: акція живе в маркетингу, а не в обліку.
 *
 * ЗАПОБІЖНИК АСИМЕТРИЧНИЙ, і це головне тут. Дві помилки коштують по-різному:
 *
 *   - ціна на сайті НИЖЧА за облікову — продаємо собі в збиток, і дізнаємось
 *     про це з бухгалтерії за місяць;
 *   - ціна ВИЩА — втрачаємо покупця, але не гроші, і помилка сама лізе в очі.
 *
 * Тому підвищення ціни 1С приймаємо завжди й одразу, а здешевлення більш ніж
 * у PRICE_SANITY_FACTOR разів — лише коли 1С повторила ту саму ціну через
 * PRICE_CONFIRM_HOURS. Тепер це стосується насамперед опту: з нього рахується
 * вітрина, і опт, помилково поділений на десять, виставив би товар на сайт у
 * збиток. Без підтвердження запобіжник перетворювався на замок: 22 товари
 * стояли з цінами старого імпорту, поки 1С щоночі просила їх виправити.
 */

import type { PriceKind1C } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BASIS_LABELS, repriceProducts } from "@/lib/pricing/engine";
import type { PriceRecord } from "./types";
import { ApplyContext } from "./context";

const PRICE_EPSILON = 0.01;
const PRICE_SANITY_FACTOR = 5;
/**
 * Скільки має «відлежатись» підозріла ціна, щоб її прийняти.
 *
 * 12 годин, бо повний зріз цін приходить раз на добу (нічний прогін): та сама
 * ціна на наступну ніч — це підтвердження, а не повтор одруківки.
 */
const PRICE_CONFIRM_HOURS = 12;
/** Скільки змін ціни вітрини за батч писати в журнал розбіжностей. */
const SITE_PRICE_LOG_LIMIT = 100;

/** Поля журналу розбіжностей. «price_*» — історичні назви для роздрібу, їх читає адмінка. */
const FIELD: Record<PriceKind1C, { changed: string; rejected: string; confirmed: string }> = {
  RETAIL: { changed: "price", rejected: "price_rejected", confirmed: "price_confirmed" },
  WHOLESALE: { changed: "wholesale", rejected: "wholesale_rejected", confirmed: "wholesale_confirmed" },
};

/**
 * Чи називала 1С цю саму ціну раніше — достатньо давно, щоб вважати її свідомою.
 *
 * Питаємо журнал розбіжностей, а не окрему таблицю: відхилення там і так
 * пишуться. Запит робиться лише для підозрілих цін — їх одиниці на добу.
 */
async function confirmedEarlier(field: string, entityRef: string, value1C: string): Promise<boolean> {
  const prior = await prisma.syncDiscrepancy.findFirst({
    where: {
      field,
      entityRef,
      value1C,
      createdAt: { lt: new Date(Date.now() - PRICE_CONFIRM_HOURS * 3600_000) },
    },
    select: { id: true },
  });
  return prior !== null;
}

function isSuspiciousDrop(oldPrice: number, newPrice: number): boolean {
  return oldPrice > 0 && newPrice > 0 && newPrice < oldPrice && oldPrice / newPrice > PRICE_SANITY_FACTOR;
}

export async function applyPrices(records: PriceRecord[], ctx: ApplyContext): Promise<void> {
  if (records.length === 0) return;

  const externalIds = records.map((r) => r.externalId);

  const products = await prisma.product.findMany({
    where: { externalId: { in: externalIds } },
    select: {
      id: true, externalId: true, sku: true, name: true, wholesalePrice: true,
      prices1C: { select: { kind: true, price: true } },
    },
  });
  const byExternalId = new Map(products.map((p) => [p.externalId!, p]));

  // «Ціну підтвердив зріз 1С» — до циклу, одним запитом, годинником бази.
  // Зріз віддає лише ціни > 0, тож прибрана ціна не приходить нулем, а
  // позиція просто зникає з вивантаження. Див. reconcile-prices.ts.
  if (!ctx.isPreview) {
    await prisma.$executeRaw`
      UPDATE "Product" SET "priceSyncedAt" = now()
      WHERE "externalId" = ANY(${externalIds}::text[])
    `;
  }

  const upserts: { productId: string; kind: PriceKind1C; price: number }[] = [];
  const removals: { productId: string; kind: PriceKind1C }[] = [];
  const wholesaleCopies: { id: string; wholesale: number }[] = [];
  const touched = new Set<string>();

  for (const rec of records) {
    const product = byExternalId.get(rec.externalId);

    // Ціна на товар, якого ще немає на сайті — нормально, якщо батч товарів
    // ще не доїхав. Наступний цикл підхопить.
    if (!product) {
      ctx.skipped++;
      continue;
    }

    const entityRef = product.sku || rec.externalId;
    const have = new Map(product.prices1C.map((p) => [p.kind, p.price]));
    let moved = false;

    const incoming: [PriceKind1C, number | undefined][] = [
      ["RETAIL", rec.retail],
      ["WHOLESALE", rec.wholesale],
    ];

    for (const [kind, raw] of incoming) {
      const value = raw !== undefined && Number.isFinite(raw) && raw > 0 ? raw : undefined;
      const old = have.get(kind);
      const field = FIELD[kind];

      if (value === undefined) {
        if (old === undefined) continue;
        // Агент шле товар з усіма його цінами разом (extract.ps1), тож тип,
        // якого немає в записі, в 1С для товару немає — сирий шар мусить це
        // відбити. «А раптом це збій курсу на агенті» тут не підстава тримати
        // стару ціну: курси беруться зрізом останніх і є завжди, а ціни в
        // валюті без коду (335 рядків EUR) не приходять ніколи, тож не
        // зникають раптово. Натомість застарілий рядок тримав би на вітрині
        // опт старого імпорту, якого 1С не називала жодного разу.
        removals.push({ productId: product.id, kind });
        if (kind === "WHOLESALE") {
          ctx.discrepancy({
            entityType: "product",
            entityRef,
            entityName: product.name,
            field: "wholesale_removed",
            value1C: "немає в записі цін",
            valueBudvik: String(old),
          });
        }
        moved = true;
        continue;
      }

      if (old !== undefined && Math.abs(old - value) <= PRICE_EPSILON) continue;

      if (old !== undefined && isSuspiciousDrop(old, value)) {
        const confirmed = await confirmedEarlier(field.rejected, entityRef, String(value));
        ctx.discrepancy({
          entityType: "product",
          entityRef,
          entityName: product.name,
          field: confirmed ? field.confirmed : field.rejected,
          value1C: String(value),
          valueBudvik: String(old),
        });
        if (!confirmed) continue;
      } else if (old !== undefined) {
        ctx.discrepancy({
          entityType: "product",
          entityRef,
          entityName: product.name,
          field: field.changed,
          value1C: String(value),
          valueBudvik: String(old),
        });
      }

      upserts.push({ productId: product.id, kind, price: value });
      // Копія опту в товарі — для помічника й старих звітів.
      if (kind === "WHOLESALE" && Math.abs((product.wholesalePrice ?? 0) - value) > PRICE_EPSILON) {
        wholesaleCopies.push({ id: product.id, wholesale: value });
      }
      moved = true;
    }

    if (moved) touched.add(product.id);
    else ctx.skipped++;
  }

  ctx.updated += touched.size;
  if (ctx.isPreview || touched.size === 0) return;

  try {
    if (upserts.length > 0) {
      await prisma.$executeRaw`
        INSERT INTO "Price1C" ("productId", kind, price, "changedAt")
        SELECT x."productId", x.kind::"PriceKind1C", x.price, now()
        FROM jsonb_to_recordset(${JSON.stringify(upserts)}::jsonb) AS x("productId" text, kind text, price float8)
        ON CONFLICT ("productId", kind) DO UPDATE SET price = EXCLUDED.price, "changedAt" = now()
      `;
    }
    if (removals.length > 0) {
      await prisma.$executeRaw`
        DELETE FROM "Price1C" c
        USING jsonb_to_recordset(${JSON.stringify(removals)}::jsonb) AS x("productId" text, kind text)
        WHERE c."productId" = x."productId" AND c.kind = x.kind::"PriceKind1C"
      `;
    }
    if (wholesaleCopies.length > 0) {
      await prisma.$executeRaw`
        UPDATE "Product" p
        SET "wholesalePrice" = x.wholesale, "syncedAt" = now(), "syncSource" = '1C'
        FROM jsonb_to_recordset(${JSON.stringify(wholesaleCopies)}::jsonb) AS x(id text, wholesale float8)
        WHERE p.id = x.id
      `;
    }

    const repriced = await repriceProducts({ productIds: [...touched] });
    for (const c of repriced.changes.slice(0, SITE_PRICE_LOG_LIMIT)) {
      ctx.discrepancy({
        entityType: "product",
        entityRef: c.sku || c.productId,
        entityName: c.name,
        field: "site_price",
        value1C: `${c.newPrice} (${BASIS_LABELS[c.basis]})`,
        valueBudvik: String(c.oldPrice),
      });
    }
  } catch (e) {
    ctx.fail(`ціни (${touched.size} товарів)`, e);
  }
}
