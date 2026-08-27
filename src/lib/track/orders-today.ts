/**
 * Кого торговий сьогодні опрацював — точками на тій самій карті, що й трек.
 *
 * Маршрут сам собою відповідає лише на питання «де людина була». Поруч із
 * ним завжди стоїть друге, дорожче: а що з того вийшло. Дані для нього в
 * базі вже є — замовлення з 1С знають і клієнта, і час, і торгового, — але
 * лежать вони в іншому розділі, і зіставляти їх доводилось очима: тут
 * маршрут, там список номерів.
 *
 * Тому ці точки лягають шаром на карту дня: видно, до кого заїхав і
 * замовлення звідти є, а де людина стояла годину — і замовлення немає.
 *
 * Три речі, про які тут легко помилитися:
 *
 * 1. Замовлення торгових — це `SalesDocument`, а не `Order`. Другий —
 *    роздрібний кошик сайту, він про контрагентів 1С не знає взагалі.
 *
 * 2. Чернетки (`DRAFT`) показуємо. Так, у грошових підрахунках їх
 *    виключають — це намір, а не виручка. Але офіс проводить документ
 *    ГОДИНАМИ пізніше, тож фільтр «лише проведені» на сьогоднішньому дні
 *    майже завжди дав би порожню карту — рівно в той день, заради якого
 *    все й робиться. На карті вони порожнім кільцем.
 *
 * 3. Дати документів з 1С лежать зсунутими: агент віддає стінний
 *    київський час, сервер читає його як UTC. Тому доба тут рахується
 *    простою UTC-межею, а не kyivDayStart — інакше в «сьогодні»
 *    потрапляли б три години вчорашнього вечора.
 */

import { prisma } from "@/lib/prisma";

/** Замовлення сьогодні — рівно те, що потрібно карті. */
export type OrderDot = {
  counterpartyId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  /** Номер документа в 1С. */
  number: string;
  amount: number;
  /** Час документа за Києвом, «HH:MM». */
  time: string;
  /** Непроведене замовлення: офіс іще не підтвердив. */
  draft: boolean;
};

export type OrdersToday = {
  /** Ті, кого є де показати. */
  dots: OrderDot[];
  /** Замовлення без координат клієнта: на карту не лягають, але вони є. */
  unmapped: number;
  total: number;
};

type Row = {
  counterpartyId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  number: string;
  amount: number;
  at: Date;
  draft: boolean;
  repId: string | null;
};

/**
 * Межі доби для документів з 1С.
 *
 * Свідомо UTC: у базі лежить київський стінний час, підписаний як UTC
 * (див. formatDocDate). Перекладати його ще раз означало б зсунути день.
 */
function docDayBounds(day: string): { from: Date; to: Date } {
  return {
    from: new Date(`${day}T00:00:00.000Z`),
    to: new Date(`${day}T23:59:59.999Z`),
  };
}

/** Час документа «14:05»: читаємо як UTC, бо там уже київський час. */
function docClock(at: Date): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/**
 * Замовлення за день з торговим біля кожного.
 *
 * Торговий береться драбиною, тією самою, що й у звірці боргів: спершу
 * «Ответственный» самого документа, далі закріплення клієнта, і аж потім
 * останній документ клієнта. Заповнений він не завжди — офіс проводить
 * замовлення на себе, — а карта без торгового марна.
 */
async function ordersOfDay(day: string): Promise<Row[]> {
  const { from, to } = docDayBounds(day);

  return prisma.$queryRaw<Row[]>`
    SELECT
      c.id                        AS "counterpartyId",
      c.name                      AS name,
      c."deliveryLat"::float      AS lat,
      c."deliveryLng"::float      AS lng,
      s.number                    AS number,
      s."totalAmount"::float      AS amount,
      s."createdAt"               AS at,
      (s.status = 'DRAFT')        AS draft,
      COALESCE(s."salesRepId", rc."salesRepId", last."salesRepId") AS "repId"
    FROM "SalesDocument" s
    JOIN "Counterparty" c ON c.id = s."counterpartyId"
    LEFT JOIN LATERAL (
      SELECT "salesRepId" FROM "SalesRepClient"
      WHERE "counterpartyId" = c.id
      ORDER BY id
      LIMIT 1
    ) rc ON TRUE
    LEFT JOIN LATERAL (
      -- Повернення не рахуються: оформити його міг хто завгодно, і клієнт
      -- перекинувся б на чужого торгового разом із замовленням.
      SELECT "salesRepId" FROM "SalesDocument"
      WHERE "counterpartyId" = c.id AND "salesRepId" IS NOT NULL
        AND "docType" <> 'RETURN'
      ORDER BY ("docType" = 'REALIZATION') DESC, "createdAt" DESC
      LIMIT 1
    ) last ON TRUE
    WHERE s."docType" = 'ORDER'
      AND s."externalId" IS NOT NULL
      AND s.status <> 'CANCELLED'
      AND s."createdAt" BETWEEN ${from} AND ${to}
    ORDER BY s."createdAt" ASC
  `;
}

function shape(rows: Row[]): OrdersToday {
  const dots: OrderDot[] = [];
  let unmapped = 0;

  for (const r of rows) {
    if (r.lat == null || r.lng == null) {
      unmapped++;
      continue;
    }
    dots.push({
      counterpartyId: r.counterpartyId,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      number: r.number,
      amount: r.amount,
      time: docClock(r.at),
      draft: r.draft,
    });
  }

  return { dots, unmapped, total: rows.length };
}

/** Сьогоднішні замовлення одного торгового. */
export async function ordersTodayForRep(repId: string, day: string): Promise<OrdersToday> {
  const rows = await ordersOfDay(day);
  return shape(rows.filter((r) => r.repId === repId));
}

/**
 * Скільки замовлень у кожного за день — для колонки в таблиці.
 *
 * Рахуємо ті самі рядки, що йдуть на карту: інакше цифра в таблиці й
 * кількість точок під нею розходилися б, і вірити не можна було б жодній.
 */
export async function orderCountsByRep(day: string): Promise<Map<string, number>> {
  const rows = await ordersOfDay(day);
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.repId) continue;
    counts.set(r.repId, (counts.get(r.repId) ?? 0) + 1);
  }
  return counts;
}
