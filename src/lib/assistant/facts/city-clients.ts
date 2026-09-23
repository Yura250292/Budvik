/**
 * Хто є в цьому місті — ПО ВСІЙ БАЗІ, а не в портфелі торгового.
 *
 * Питання «кого можна розпрацювати в Сокільниках» — це питання про
 * можливості, а не про свій список: половина потенціалу лежить саме в
 * магазинах, які поки що ніхто не веде або веде хтось інший. Обмежити
 * відповідь портфелем — означає показати рівно те, що торговий і так
 * знає напам'ять.
 *
 * Місто береться і з адреси, і з НАЗВИ: у 1С його пишуть де завгодно —
 * «Біб В.П. (с.Сокільники)» має його в назві, «ОСББ ВЕСНЯНА 2» — лише в
 * адресі, а в «Техномаш (Сокільники)» адреси немає взагалі.
 *
 * Свої (Counterparty.isInternal) — не можливість для розпрацювання: «Склад
 * (Дубляни)» чи ФОП торгового у відповіді «кого розпрацювати» лише займали б
 * місце в ліміті.
 */

import { prisma } from "@/lib/prisma";
import { NOT_INTERNAL, SOURCE_FILTER } from "@/lib/analytics/facts";
import { agingByCounterparty } from "@/lib/analytics/money-facts";
import { myClientsCte } from "@/lib/assistant/facts/sql";
import { searchPatterns } from "@/lib/assistant/facts/search-words";
import { clientQuery, LOOSE_CHARS } from "@/lib/search/client-words";

/** Скільки днів мовчання вважати сном. */
const SLEEP_DAYS = 90;

/** За скільки днів рахуємо оборот, щоб зрозуміти вагу точки. */
const REVENUE_DAYS = 180;

type Row = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  mine: boolean;
  hasPin: boolean;
  lastDocAt: Date | null;
  revenue: number;
  debt: number;
  overdue: number;
};

export type CityClient = Row & {
  daysSinceLast: number | null;
  group: "active" | "asleep" | "never";
};

export type CityClients = {
  city: string;
  clients: CityClient[];
  counts: { total: number; active: number; asleep: number; never: number; mine: number };
};

export async function clientsInCity(city: string, repId: string, limit = 40): Promise<CityClients> {
  /*
   * Місто — тими самими словами, що й клієнт (search/client-words.ts).
   * Раніше весь рядок ішов одним підрядком, і «м. Перемишляни» знаходило 9
   * клієнтів із 25 (у назвах «(м.Перемишляни)» без пробілу), а
   * «(Перемишляни)» — одного.
   */
  const patterns = searchPatterns(clientQuery(city) || city, 3, 0);

  const rows = await prisma.$queryRaw<Row[]>`
    WITH ${myClientsCte(repId)}
    SELECT
      c.id, c.name, c.address, c.phone,
      (c.id IN (SELECT id FROM my_clients)) AS mine,
      (c."deliveryLat" IS NOT NULL AND c."deliveryLng" IS NOT NULL) AS "hasPin",
      (SELECT MAX(s."createdAt") FROM "SalesDocument" s
        WHERE s."counterpartyId" = c.id AND s."docType" <> 'RETURN') AS "lastDocAt",
      COALESCE((
        SELECT SUM(i.quantity * i."sellingPrice")::float
        FROM "SalesDocumentItem" i
        JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
        WHERE ${SOURCE_FILTER}
          AND s."counterpartyId" = c.id
          AND s."docType" <> 'RETURN'
          AND s."createdAt" >= NOW() - (${REVENUE_DAYS} * INTERVAL '1 day')
      ), 0) AS revenue,
      0::float AS debt,
      0::float AS overdue
    FROM "Counterparty" c
    WHERE c."isActive"
      AND ${NOT_INTERNAL}
      AND (
        translate(c.address, ${LOOSE_CHARS}, '') ILIKE ALL(${patterns}::text[])
        OR translate(c.name, ${LOOSE_CHARS}, '') ILIKE ALL(${patterns}::text[])
      )
    ORDER BY revenue DESC NULLS LAST
    LIMIT ${limit}
  `;

  /**
   * Борг беремо з розкладеного сальдо, а не з поля контрагента.
   *
   * `receivableBalance` — те, що востаннє приїхало з 1С одним числом;
   * прострочену частину з нього не видно, а саме вона й вирішує, з чим
   * заходити (див. money-facts).
   */
  const aging = await agingByCounterparty(rows.map((r) => r.id));

  const now = Date.now();
  const clients: CityClient[] = rows.map((r) => {
    const daysSinceLast = r.lastDocAt
      ? Math.round((now - r.lastDocAt.getTime()) / 86_400_000)
      : null;
    return {
      ...r,
      debt: Math.round(aging.get(r.id)?.debt ?? 0),
      overdue: Math.round(aging.get(r.id)?.overdue ?? 0),
      daysSinceLast,
      group:
        daysSinceLast == null ? "never" : daysSinceLast > SLEEP_DAYS ? "asleep" : "active",
    };
  });

  return {
    city,
    clients,
    counts: {
      total: clients.length,
      active: clients.filter((c) => c.group === "active").length,
      asleep: clients.filter((c) => c.group === "asleep").length,
      never: clients.filter((c) => c.group === "never").length,
      mine: clients.filter((c) => c.mine).length,
    },
  };
}
