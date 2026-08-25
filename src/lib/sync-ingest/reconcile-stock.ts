/**
 * Звірка наявності: розпродана позиція має показувати нуль.
 *
 * Регістр `ТоварыНаСкладах.Остатки` віддає лише ненульові рядки, тож пара
 * «товар+склад», продана в нуль, зникає з вивантаження. На інкрементальних
 * прогонах агент домальовує їй нуль сам — він знає зі списку рухів, що вона
 * ворушилась. На ПОВНОМУ прогоні такого списку немає за визначенням, і саме
 * там залишок застигав: покупець бачив «в наявності» те, чого на складі вже
 * немає, і міг це замовити.
 *
 * Тому звірка робиться лише на повному прогоні — тільки він приносить зріз
 * регістру цілком, і лише щодо нього «немає у вивантаженні» означає «немає
 * на складі».
 */

import { prisma } from "@/lib/prisma";
import { ApplyContext } from "./context";
import { channelDelivered, CLOCK_SKEW_GUARD_MS } from "./stale";

/**
 * Скільки рядків дозволено обнулити за раз — в абсолюті й часткою зрізу.
 *
 * За добу розпродається кількасот пар, і це норма. Тисячі означають радше
 * обірваний зріз, а обнулення в такому разі спорожнило б вітрину.
 */
const STALE_ABSOLUTE_LIMIT = 3000;
const STALE_RATIO_LIMIT = 0.5;

/**
 * Обнуляє залишки, яких немає в повному зрізі 1С.
 *
 * Повертає кількість обнулених пар. Викликається із закриття прогону.
 */
export async function reconcileStock(ctx: ApplyContext): Promise<number> {
  if (ctx.kind !== "full") return 0;

  const delivered = await channelDelivered(ctx, "stock");
  if (!delivered) return 0;

  const cutoff = new Date(delivered.firstBatchAt.getTime() - CLOCK_SKEW_GUARD_MS);

  const stale = await prisma.locationStock.findMany({
    where: {
      OR: [{ quantity: { not: 0 } }, { reserved: { not: 0 } }, { available: { not: 0 } }],
      syncedAt: { lt: cutoff },
      // Позиції без externalId 1С не веде взагалі — їх залишок веде сайт.
      product: { externalId: { not: null } },
    },
    select: { id: true, productId: true },
  });

  if (stale.length === 0) return 0;

  if (
    stale.length > STALE_ABSOLUTE_LIMIT ||
    stale.length > STALE_RATIO_LIMIT * (stale.length + delivered.seen)
  ) {
    console.error(
      `sync-ingest: звірку наявності пропущено — забагато зниклих рядків ` +
        `(${stale.length} проти ${delivered.seen} у зрізі)`
    );
    return 0;
  }

  const CHUNK = 500;
  const ids = stale.map((s) => s.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    await prisma.locationStock.updateMany({
      where: { id: { in: ids.slice(i, i + CHUNK) } },
      data: { quantity: 0, reserved: 0, available: 0, syncedAt: new Date() },
    });
  }

  // Сумарний залишок товару перераховуємо з рядків, що лишились: у товару
  // могли бути інші склади, і ставити нуль наосліп означало б сховати з
  // вітрини те, що насправді десь є. Сервісні склади не рахуються — товар у
  // майстерні фізично існує, але продати його не можна.
  const productIds = [...new Set(stale.map((s) => s.productId))];
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const slice = productIds.slice(i, i + CHUNK);
    const totals = await prisma.locationStock.groupBy({
      by: ["productId"],
      where: { productId: { in: slice }, stockLocation: { isService: false } },
      _sum: { available: true },
    });
    const totalByProduct = new Map(totals.map((t) => [t.productId, t._sum.available ?? 0]));

    for (const productId of slice) {
      await prisma.product.update({
        where: { id: productId },
        data: {
          stock: totalByProduct.get(productId) ?? 0,
          syncedAt: new Date(),
          syncSource: "1C",
        },
      });
    }
  }

  return stale.length + (await zeroOrphans(delivered.seen));
}

/**
 * Другий прохід: товари, у яких рядків складу немає ВЗАГАЛІ.
 *
 * Перший прохід ловить те, що має рядок у LocationStock і випало зі зрізу.
 * Але позиція, залишок якої приїхав ще першим імпортом каталогу і жодного
 * разу не потрапила в регістр 1С, рядка не має — для звірки її наче й немає,
 * а `Product.stock` тримає березневе число й ніколи не перераховується
 * (перерахунок іде по ЗАЧЕПЛЕНИХ зрізом товарах).
 *
 * Заміряно 25.08.2026: 923 активні товари з ключем 1С показували 19 226 штук
 * на 3,6 млн ₴ за прайсом. Пробою в 1С (agent/ps/gen-probe-stock-orphans.py)
 * перевірено, що це саме розпродані позиції, а не транзитні: у регістрі за
 * рік видно і прихід, і розхід на справжніх складах, а кінцевий залишок нуль.
 * Тобто вітрина обіцяла покупцям те, чого немає, а поради торговому — везли.
 *
 * Обнуляємо лише позиції з `externalId`: залишок товарів, яких 1С не веде,
 * веде сам сайт, і зріз про них нічого не каже.
 */
async function zeroOrphans(seen: number): Promise<number> {
  const orphans = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT p.id
    FROM "Product" p
    WHERE p."isActive"
      AND p.stock > 0
      AND p."externalId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "LocationStock" ls
        JOIN "StockLocation" sl ON sl.id = ls."stockLocationId"
        WHERE ls."productId" = p.id AND sl."isService" = false
      )
  `;

  if (orphans.length === 0) return 0;

  // Ті самі запобіжники, що й у першому проході: якщо «зниклих» раптом
  // більше, ніж прийшло у зрізі, це не розпродаж, а обірваний обмін.
  if (
    orphans.length > STALE_ABSOLUTE_LIMIT ||
    orphans.length > STALE_RATIO_LIMIT * (orphans.length + seen)
  ) {
    console.error(
      `sync-ingest: обнулення товарів без рядків складу пропущено — ` +
        `забагато кандидатів (${orphans.length} проти ${seen} у зрізі)`
    );
    return 0;
  }

  const CHUNK = 500;
  const ids = orphans.map((o) => o.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    await prisma.product.updateMany({
      where: { id: { in: ids.slice(i, i + CHUNK) } },
      data: { stock: 0, syncedAt: new Date(), syncSource: "1C" },
    });
  }

  return ids.length;
}
