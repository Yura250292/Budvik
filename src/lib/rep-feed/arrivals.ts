/**
 * Прихід товару для торгового: що приїхало й кому з його клієнтів це везти.
 *
 * Надходження з 1С (канал purchase_doc → PurchaseOrder) торговий не бачить
 * ніде, а це найпростіший привід зайти до клієнта: «те, що ви брали,
 * знову є». Тому не весь прихід, а лише позиції, які за останні півроку
 * брали клієнти САМЕ ЦЬОГО торгового, і лише ті, що зараз є у вільному
 * залишку (прихід міг уже розійтися).
 *
 * Раз на день о 10:00 у будні, вікном від 10:00 попереднього робочого дня
 * (arrivalWindow) — у понеділок це п'ятниця після обіду й вихідні. Один
 * рядок і один пуш на людину; повний список — сторінка /sales/arrivals/<день>,
 * яка рахує те саме цією ж функцією.
 *
 * Модуль без next/*: воркер.
 */

import { prisma } from "@/lib/prisma";
import { FREE_STOCK } from "@/lib/analytics/clientOrder";
import { SOURCE_FILTER } from "@/lib/analytics/facts";
import { myClientsCte } from "@/lib/assistant/facts/sql";
import { isHiddenCategory } from "@/lib/catalog/category-display";
import { kyivDate } from "@/lib/date/kyiv";
import { worksToday, isWeekend } from "./call-list";
import { ARRIVAL_HOUR, arrivalWindow, describeArrival, inDigestWindow } from "./format";
import { isInternalCounterparty, loadStaffNames } from "./internal";
import { REP_FEED_TYPES, type FeedEvent } from "./types";

/** За скільки днів покупки клієнта вважаються «він це бере». */
const BUYER_WINDOW_DAYS = 180;
const DAY_MS = 24 * 60 * 60_000;

export type ArrivalClient = { id: string; name: string; lastAt: string };

export type ArrivalItem = {
  productId: string;
  name: string;
  sku: string | null;
  arrivedQty: number;
  freeStock: number;
  clients: ArrivalClient[];
};

type Row = {
  productId: string;
  name: string;
  sku: string | null;
  categoryName: string | null;
  arrivedQty: number;
  freeStock: number;
  clients: ArrivalClient[] | null;
};

/**
 * Позиції приходу за вікно, які беруть клієнти торгового, від найширше
 * затребуваних. Внутрішні контрагенти (склад, співробітники) — не клієнти.
 */
export async function arrivalsForRep(
  repId: string,
  window: { from: Date; to: Date },
  staff?: ReadonlySet<string>
): Promise<ArrivalItem[]> {
  // Дати продажів 1С теж стінний час як UTC; півроку назад похибка в години не важить.
  const buyersSince = new Date(window.to.getTime() - BUYER_WINDOW_DAYS * DAY_MS);

  const rows = await prisma.$queryRaw<Row[]>`
    WITH ${myClientsCte(repId)},
    arrived AS (
      SELECT poi."productId", SUM(poi.quantity)::int AS qty
      FROM "PurchaseOrderItem" poi
      JOIN "PurchaseOrder" po ON po.id = poi."purchaseOrderId"
      WHERE po.status = 'CONFIRMED'
        AND po."externalId" IS NOT NULL
        AND COALESCE(po."confirmedAt", po."createdAt") >= ${window.from}
        AND COALESCE(po."confirmedAt", po."createdAt") < ${window.to}
      GROUP BY 1
    ),
    buyers AS (
      SELECT i."productId", c.id AS "clientId", c.name AS "clientName", MAX(s."createdAt") AS "lastAt"
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Counterparty" c ON c.id = s."counterpartyId"
      WHERE ${SOURCE_FILTER}
        AND s."docType" = 'REALIZATION'
        AND s."createdAt" >= ${buyersSince}
        AND s."counterpartyId" IN (SELECT id FROM my_clients)
        AND i."productId" IN (SELECT "productId" FROM arrived)
      GROUP BY 1, 2, 3
    )
    SELECT
      p.id AS "productId", p.name, p.sku, cat.name AS "categoryName",
      a.qty AS "arrivedQty", st.free AS "freeStock",
      json_agg(json_build_object('id', b."clientId", 'name', b."clientName", 'lastAt', b."lastAt")
               ORDER BY b."lastAt" DESC) AS clients
    FROM arrived a
    JOIN "Product" p ON p.id = a."productId"
    LEFT JOIN "Category" cat ON cat.id = p."categoryId"
    JOIN buyers b ON b."productId" = p.id
    ${FREE_STOCK("p")}
    WHERE p."isActive" AND st.free > 0
    GROUP BY p.id, p.name, p.sku, cat.name, a.qty, st.free
    ORDER BY COUNT(*) DESC, MAX(b."lastAt") DESC
    LIMIT 300
  `;

  const staffKeys = staff ?? (await loadStaffNames());
  const items: ArrivalItem[] = [];
  for (const r of rows) {
    if (isHiddenCategory(r.categoryName)) continue;
    const clients = (r.clients ?? []).filter((c) => !isInternalCounterparty(c.name, staffKeys));
    if (clients.length === 0) continue;
    items.push({
      productId: r.productId,
      name: r.name,
      sku: r.sku,
      arrivedQty: r.arrivedQty,
      freeStock: r.freeStock,
      clients,
    });
  }
  // Після відсіву внутрішніх порядок міг зсунутись — ще раз за кількістю клієнтів.
  return items.sort((a, b) => b.clients.length - a.clients.length);
}

export function arrivalDedupKey(day: string, repId: string): string {
  return `${REP_FEED_TYPES.ARRIVAL}:${day}:${repId}`;
}

export async function collectArrivals(now: Date): Promise<FeedEvent[]> {
  // Вікно в кілька годин, а не одна: хто почав день пізніше, теж отримає.
  if (!inDigestWindow(now, ARRIVAL_HOUR) || isWeekend(now)) return [];

  const day = kyivDate(now);
  const window = arrivalWindow(day);

  // Дешева перевірка до обходу торгових: у день без приходу — нічого.
  const docs = await prisma.purchaseOrder.count({
    where: {
      status: "CONFIRMED",
      externalId: { not: null },
      OR: [
        { confirmedAt: { gte: window.from, lt: window.to } },
        { confirmedAt: null, createdAt: { gte: window.from, lt: window.to } },
      ],
    },
  });
  if (docs === 0) return [];

  const reps = await prisma.user.findMany({ where: { role: "SALES" }, select: { id: true } });
  const staff = await loadStaffNames();
  const events: FeedEvent[] = [];

  for (const { id: repId } of reps) {
    const dedupKey = arrivalDedupKey(day, repId);
    const known = await prisma.notification.findUnique({ where: { dedupKey }, select: { id: true } });
    if (known) continue;
    if (!(await worksToday(repId, day))) continue;

    const items = await arrivalsForRep(repId, window, staff);
    if (items.length === 0) continue;

    events.push({
      type: REP_FEED_TYPES.ARRIVAL,
      repId,
      dedupKey,
      relatedId: day,
      target: `/sales/arrivals/${day}`,
      ...describeArrival(items.map((i) => ({ name: i.name, clients: i.clients.map((c) => c.name) }))),
      at: now,
      standalone: true,
    });
  }
  return events;
}
