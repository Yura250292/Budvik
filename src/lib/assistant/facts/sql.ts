/**
 * Спільні шматки SQL для фактів помічника.
 *
 * Вони вже існували поодинці в turnover.ts і order-margin.ts, і саме тому
 * їх варто мати в одному місці: «остання відома собівартість» — поняття, у
 * якому легко розійтися (з поверненнями чи без, з нулями чи без), а
 * розходження в ньому одразу перетворюється на різну маржу в двох
 * сусідніх екранах.
 */

import { Prisma } from "@prisma/client";

/** Вільний залишок на несервісних складах — єдине чесне «є на складі». */
export { FREE_STOCK } from "@/lib/analytics/clientOrder";

/**
 * Той самий вільний залишок, але одним проходом по всій таблиці.
 *
 * FREE_STOCK — це LATERAL, тобто підзапит на КОЖЕН рядок результату. Для
 * картки клієнта (десятки товарів) це дешево, а для зрізу по всьому
 * асортименту — ні: заміряно 04.09.2026, 4376 товарів давали 13,5 с проти
 * 0,6 с із цим CTE. Різниця не в оптимізації задля оптимізації: 13 секунд
 * — це майже чверть усього часу, який помічник має на відповідь.
 */
export const FREE_STOCK_ALL = Prisma.sql`
  free_stock AS (
    SELECT ls."productId", SUM(ls.available)::int AS free
    FROM "LocationStock" ls
    JOIN "StockLocation" sl ON sl.id = ls."stockLocationId"
    WHERE sl."isService" = false
    GROUP BY 1
  )`;

/**
 * Остання відома собівартість одиниці товару.
 *
 * purchasePrice = 0 означає «невідомо», а не «дісталось безкоштовно», тому
 * нулі відкидаємо: інакше маржа стрибнула б до 100% рівно на тих товарах,
 * по яких 1С собівартості не передала.
 *
 * Беремо з реалізацій: у поверненні та сама позиція має собівартість
 * поверненої партії, і для оцінки «почім ми зараз купуємо» вона гірша.
 */
export const LAST_COST = Prisma.sql`
  last_cost AS (
    SELECT DISTINCT ON (i."productId")
      i."productId",
      i."purchasePrice"::float AS cost,
      s."createdAt" AS at
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    WHERE s."externalId" IS NOT NULL
      AND s.status = 'CONFIRMED'
      AND s."docType" = 'REALIZATION'
      AND i."purchasePrice" > 0
    ORDER BY i."productId", s."createdAt" DESC
  )`;

/** Коли товар продавали востаннє — межа між «повільний» і «мертвий». */
export const LAST_SALE = Prisma.sql`
  last_sale AS (
    SELECT i."productId", MAX(s."createdAt") AS ts
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    WHERE s."externalId" IS NOT NULL
      AND s.status = 'CONFIRMED'
      AND s."docType" = 'REALIZATION'
    GROUP BY 1
  )`;

/**
 * Клієнти торгового — обома шляхами одразу.
 *
 * Закріплення (SalesRepClient) заповнене приблизно в кожного сьомого
 * контрагента; решту зв'язує лише «Ответственный» у документах 1С. Кабінет
 * скрізь питає портфель саме так (див. /api/erp/counterparties), і тут має
 * бути так само — інакше помічник радив би по вужчому колу, ніж те, що
 * торговий бачить у списку клієнтів.
 */
export const myClientsCte = (repId: string) => Prisma.sql`
  my_clients AS (
    SELECT c.id
    FROM "Counterparty" c
    WHERE EXISTS (
        SELECT 1 FROM "SalesRepClient" r
        WHERE r."counterpartyId" = c.id AND r."salesRepId" = ${repId}
      )
      OR EXISTS (
        SELECT 1 FROM "SalesDocument" d
        WHERE d."counterpartyId" = c.id AND d."salesRepId" = ${repId}
      )
  )`;
