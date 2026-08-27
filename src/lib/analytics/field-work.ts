/**
 * Польова робота над картою клієнтів: хто уточнює точки, знімає магазини
 * й лишає нотатки.
 *
 * Питання, заради якого це написано, звучить так: «чи торгові взагалі цим
 * займаються». Доти відповіді не було. База знала, що 35 точок поставлені
 * руками (geoSource='MANUAL'), але не знала чиїми — авторство піна почали
 * писати лише з міграцією 20260827090000. Тому в звіті є розрив: піни,
 * поставлені до неї, лічаться в покритті, але не мають автора і в розкладці
 * по людях не з'являються. Це видно окремим рядком, а не замовчується.
 *
 * Три дії зведені в один звіт навмисно: поодинці кожна нічого не каже.
 * Уточнений пін без нотатки — координата без пояснення, нотатка без піна —
 * знання, до якого не доїхати. Разом вони і є «клієнта опрацьовано».
 */

import { prisma } from "@/lib/prisma";
import type { Period } from "@/lib/analytics/period";

/**
 * Скільки днів назад дивимось, щоб назвати клієнта «живим».
 *
 * Порогом слугує остання реалізація: клієнт, якому не возили три місяці,
 * не мусить псувати відсоток готовності карти — маршрут до нього все одно
 * не будують. Те саме вікно, що в probe-geo-coverage.
 */
const SHIPPED_WINDOW_DAYS = 90;

export type GeoCoverage = {
  /** Активні контрагенти всієї бази */
  total: number;
  exact: number;
  city: number;
  geocoded: number;
  failed: number;
  missing: number;
  /** Ті, кому реально возили за останні SHIPPED_WINDOW_DAYS */
  shipped: number;
  shippedExact: number;
  shippedApprox: number;
  shippedMissing: number;
  /** Ручні піни без автора: поставлені до появи колонки geoById */
  unattributed: number;
  windowDays: number;
};

/** Покриття бази координатами — знаменник для всієї польової роботи. */
export async function geoCoverage(): Promise<GeoCoverage> {
  const [row] = await prisma.$queryRaw<
    Array<{
      total: number;
      exact: number;
      city: number;
      geocoded: number;
      failed: number;
      missing: number;
      shipped: number;
      shipped_exact: number;
      shipped_approx: number;
      shipped_missing: number;
      unattributed: number;
    }>
  >`
    WITH shipped AS (
      SELECT DISTINCT s."counterpartyId" AS id
      FROM "SalesDocument" s
      WHERE s."externalId" IS NOT NULL
        AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
        AND s."counterpartyId" IS NOT NULL
        AND s."createdAt" > NOW() - (${SHIPPED_WINDOW_DAYS} || ' days')::interval
    )
    SELECT
      COUNT(*)::int                                                          AS total,
      COUNT(*) FILTER (WHERE c."geoSource" = 'MANUAL')::int                  AS exact,
      COUNT(*) FILTER (WHERE c."geoSource" = 'CITY')::int                    AS city,
      COUNT(*) FILTER (WHERE c."geoSource" = 'GEOCODED')::int                AS geocoded,
      COUNT(*) FILTER (WHERE c."geoSource" = 'FAILED')::int                  AS failed,
      COUNT(*) FILTER (WHERE c."deliveryLat" IS NULL)::int                   AS missing,
      COUNT(*) FILTER (WHERE sh.id IS NOT NULL)::int                         AS shipped,
      COUNT(*) FILTER (WHERE sh.id IS NOT NULL AND c."geoSource" = 'MANUAL')::int AS shipped_exact,
      COUNT(*) FILTER (
        WHERE sh.id IS NOT NULL AND c."deliveryLat" IS NOT NULL AND c."geoSource" <> 'MANUAL'
      )::int                                                                 AS shipped_approx,
      COUNT(*) FILTER (WHERE sh.id IS NOT NULL AND c."deliveryLat" IS NULL)::int AS shipped_missing,
      COUNT(*) FILTER (WHERE c."geoSource" = 'MANUAL' AND c."geoById" IS NULL)::int AS unattributed
    FROM "Counterparty" c
    LEFT JOIN shipped sh ON sh.id = c.id
    WHERE c."isActive"`;

  return {
    total: row?.total ?? 0,
    exact: row?.exact ?? 0,
    city: row?.city ?? 0,
    geocoded: row?.geocoded ?? 0,
    failed: row?.failed ?? 0,
    missing: row?.missing ?? 0,
    shipped: row?.shipped ?? 0,
    shippedExact: row?.shipped_exact ?? 0,
    shippedApprox: row?.shipped_approx ?? 0,
    shippedMissing: row?.shipped_missing ?? 0,
    unattributed: row?.unattributed ?? 0,
    windowDays: SHIPPED_WINDOW_DAYS,
  };
}

export type FieldWorker = {
  userId: string;
  name: string;
  role: string;
  /** За вибраний період */
  pins: number;
  pinsOnSite: number;
  photos: number;
  notes: number;
  notesWithPhoto: number;
  clients: number;
  /** За весь час, скільки база пам'ятає авторство */
  pinsAllTime: number;
  photosAllTime: number;
  notesAllTime: number;
  lastAt: string | null;
};

type PinRow = {
  userId: string;
  pins: number;
  on_site: number;
  pins_all: number;
  last_at: Date | null;
  clients: string[];
};

type PhotoRow = {
  userId: string;
  photos: number;
  photos_all: number;
  last_at: Date | null;
  clients: string[];
};

type NoteRow = {
  userId: string;
  notes: number;
  with_photo: number;
  notes_all: number;
  last_at: Date | null;
  clients: string[];
};

/**
 * Хто що зробив за період.
 *
 * Три запити замість одного зведеного: джерела різні (дві колонки
 * контрагента і окрема таблиця нотаток), і FULL OUTER JOIN по трьох
 * агрегатах читався б утричі гірше за злиття мапами в JS. Рядків тут
 * стільки, скільки людей у компанії, — десятки.
 *
 * `clients` тягнемо списками id саме тому, що «клієнтів опрацьовано» —
 * це об'єднання трьох множин, а не сума трьох лічильників: пін, фото й
 * нотатка на одному магазині мають рахуватись як один клієнт.
 */
export async function fieldWorkers(period: Period): Promise<FieldWorker[]> {
  const [pins, photos, notes] = await Promise.all([
    prisma.$queryRaw<PinRow[]>`
      SELECT
        c."geoById" AS "userId",
        COUNT(*) FILTER (WHERE c."geoAt" >= ${period.from} AND c."geoAt" <= ${period.to})::int AS pins,
        COUNT(*) FILTER (
          WHERE c."geoAt" >= ${period.from} AND c."geoAt" <= ${period.to}
            AND c."geoAccuracyM" IS NOT NULL
        )::int AS on_site,
        COUNT(*)::int AS pins_all,
        MAX(c."geoAt") AS last_at,
        COALESCE(
          ARRAY_AGG(c.id) FILTER (WHERE c."geoAt" >= ${period.from} AND c."geoAt" <= ${period.to}),
          '{}'
        ) AS clients
      FROM "Counterparty" c
      WHERE c."geoById" IS NOT NULL
      GROUP BY 1`,
    prisma.$queryRaw<PhotoRow[]>`
      SELECT
        c."photoById" AS "userId",
        COUNT(*) FILTER (WHERE c."photoAt" >= ${period.from} AND c."photoAt" <= ${period.to})::int AS photos,
        COUNT(*)::int AS photos_all,
        MAX(c."photoAt") AS last_at,
        COALESCE(
          ARRAY_AGG(c.id) FILTER (WHERE c."photoAt" >= ${period.from} AND c."photoAt" <= ${period.to}),
          '{}'
        ) AS clients
      FROM "Counterparty" c
      WHERE c."photoUrl" IS NOT NULL AND c."photoById" IS NOT NULL
      GROUP BY 1`,
    prisma.$queryRaw<NoteRow[]>`
      SELECT
        cc."authorId" AS "userId",
        COUNT(*) FILTER (WHERE cc."createdAt" >= ${period.from} AND cc."createdAt" <= ${period.to})::int AS notes,
        COUNT(*) FILTER (
          WHERE cc."createdAt" >= ${period.from} AND cc."createdAt" <= ${period.to}
            AND cc."photoUrl" IS NOT NULL
        )::int AS with_photo,
        COUNT(*)::int AS notes_all,
        MAX(cc."createdAt") AS last_at,
        COALESCE(
          ARRAY_AGG(cc."counterpartyId") FILTER (
            WHERE cc."createdAt" >= ${period.from} AND cc."createdAt" <= ${period.to}
          ),
          '{}'
        ) AS clients
      FROM "ClientComment" cc
      GROUP BY 1`,
  ]);

  const ids = new Set<string>([
    ...pins.map((r) => r.userId),
    ...photos.map((r) => r.userId),
    ...notes.map((r) => r.userId),
  ]);
  if (ids.size === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, role: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const acc = new Map<string, FieldWorker & { touched: Set<string> }>();
  const ensure = (userId: string) => {
    let row = acc.get(userId);
    if (!row) {
      const u = userById.get(userId);
      row = {
        userId,
        // Ім'я може не знайтись, якщо обліковий запис видалили: колонка
        // навмисно не має зовнішнього ключа, щоб слід роботи лишався.
        name: u?.name ?? "Видалений користувач",
        role: u?.role ?? "—",
        pins: 0,
        pinsOnSite: 0,
        photos: 0,
        notes: 0,
        notesWithPhoto: 0,
        clients: 0,
        pinsAllTime: 0,
        photosAllTime: 0,
        notesAllTime: 0,
        lastAt: null,
        touched: new Set<string>(),
      };
      acc.set(userId, row);
    }
    return row;
  };

  /** Остання дія людини — максимум із трьох стрічок, а не з однієї. */
  const bumpLast = (row: FieldWorker, at: Date | null) => {
    if (!at) return;
    const iso = at.toISOString();
    if (!row.lastAt || iso > row.lastAt) row.lastAt = iso;
  };

  for (const r of pins) {
    const row = ensure(r.userId);
    row.pins = r.pins;
    row.pinsOnSite = r.on_site;
    row.pinsAllTime = r.pins_all;
    bumpLast(row, r.last_at);
    for (const id of r.clients) row.touched.add(id);
  }
  for (const r of photos) {
    const row = ensure(r.userId);
    row.photos = r.photos;
    row.photosAllTime = r.photos_all;
    bumpLast(row, r.last_at);
    for (const id of r.clients) row.touched.add(id);
  }
  for (const r of notes) {
    const row = ensure(r.userId);
    row.notes = r.notes;
    row.notesWithPhoto = r.with_photo;
    row.notesAllTime = r.notes_all;
    bumpLast(row, r.last_at);
    for (const id of r.clients) row.touched.add(id);
  }

  return [...acc.values()]
    .map(({ touched, ...row }) => ({ ...row, clients: touched.size }))
    .sort((a, b) => {
      const byPeriod = b.pins + b.photos + b.notes - (a.pins + a.photos + a.notes);
      if (byPeriod !== 0) return byPeriod;
      return b.pinsAllTime - a.pinsAllTime;
    });
}

export type RepGeoBacklog = {
  repId: string | null;
  name: string;
  clients: number;
  exact: number;
  approx: number;
  missing: number;
  /** Частка точних пінів, % */
  ready: number;
};

/**
 * Скільки кожному ще лишилось уточнити.
 *
 * Без цього стовпчика звіт відповідав би лише «хто скільки зробив», а
 * керівнику потрібне інше: чи це багато. Двадцять пінів — це подвиг, якщо
 * у людини сорок клієнтів, і майже нічого, якщо триста.
 *
 * Власник клієнта визначається так само, як у решті аналітики: спершу
 * закріплення руками (SalesRepClient), далі — торговий з останньої
 * реалізації. Закріплення в базі майже порожнє, тож фактично працює друге;
 * саме тому воно тут, а не для повноти. Клієнти без жодного джерела
 * зводяться в рядок «Без торгового» — це не помилка звіту, а стан бази.
 */
export async function repGeoBacklog(): Promise<RepGeoBacklog[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      repId: string | null;
      name: string | null;
      clients: number;
      exact: number;
      approx: number;
      missing: number;
    }>
  >`
    WITH shipped AS (
      SELECT DISTINCT ON (s."counterpartyId")
        s."counterpartyId" AS id,
        s."salesRepId"     AS "repId"
      FROM "SalesDocument" s
      WHERE s."externalId" IS NOT NULL
        AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
        AND s."counterpartyId" IS NOT NULL
        AND s."createdAt" > NOW() - (${SHIPPED_WINDOW_DAYS} || ' days')::interval
      ORDER BY s."counterpartyId", s."createdAt" DESC
    ),
    assigned AS (
      SELECT DISTINCT ON ("counterpartyId")
        "counterpartyId" AS id,
        "salesRepId"     AS "repId"
      FROM "SalesRepClient"
      ORDER BY "counterpartyId"
    )
    SELECT
      COALESCE(a."repId", sh."repId")                                        AS "repId",
      u.name                                                                 AS name,
      COUNT(*)::int                                                          AS clients,
      COUNT(*) FILTER (WHERE c."geoSource" = 'MANUAL')::int                  AS exact,
      COUNT(*) FILTER (WHERE c."deliveryLat" IS NOT NULL AND c."geoSource" <> 'MANUAL')::int AS approx,
      COUNT(*) FILTER (WHERE c."deliveryLat" IS NULL)::int                   AS missing
    FROM shipped sh
    JOIN "Counterparty" c ON c.id = sh.id
    LEFT JOIN assigned a ON a.id = sh.id
    LEFT JOIN "User" u ON u.id = COALESCE(a."repId", sh."repId")
    GROUP BY 1, 2
    ORDER BY 3 DESC`;

  return rows.map((r) => ({
    repId: r.repId,
    name: r.name ?? "Без торгового",
    clients: r.clients,
    exact: r.exact,
    approx: r.approx,
    missing: r.missing,
    ready: r.clients > 0 ? (r.exact / r.clients) * 100 : 0,
  }));
}

export type FieldEvent = {
  kind: "PIN" | "PHOTO" | "NOTE";
  clientId: string;
  clientName: string;
  userId: string | null;
  userName: string;
  at: string;
  /** Лише для PIN: ±м GPS, null — пін посунули рукою */
  accuracyM: number | null;
  /** Лише для NOTE: перший рядок тексту, щоб було видно, що це не порожньо */
  text: string | null;
  hasPhoto: boolean;
};

/**
 * Стрічка останніх дій — щоб побачити не лише лічильники, а й самі вчинки.
 *
 * Цифра в таблиці не показує, чи людина уточнює точки по-справжньому, чи
 * прокликує підряд. Стрічка показує: тут видно час, точність GPS і чи
 * поруч лягла нотатка.
 */
export async function fieldEvents(period: Period, limit = 40): Promise<FieldEvent[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      kind: string;
      clientId: string;
      clientName: string;
      userId: string | null;
      at: Date;
      accuracyM: number | null;
      text: string | null;
      hasPhoto: boolean;
    }>
  >`
    (
      SELECT 'PIN' AS kind, c.id AS "clientId", c.name AS "clientName",
             c."geoById" AS "userId", c."geoAt" AS at,
             c."geoAccuracyM" AS "accuracyM", NULL::text AS text, false AS "hasPhoto"
      FROM "Counterparty" c
      WHERE c."geoAt" IS NOT NULL AND c."geoAt" >= ${period.from} AND c."geoAt" <= ${period.to}
    )
    UNION ALL
    (
      SELECT 'PHOTO', c.id, c.name, c."photoById", c."photoAt", NULL::int, NULL::text, true
      FROM "Counterparty" c
      WHERE c."photoUrl" IS NOT NULL AND c."photoAt" IS NOT NULL
        AND c."photoAt" >= ${period.from} AND c."photoAt" <= ${period.to}
    )
    UNION ALL
    (
      SELECT 'NOTE', cp.id, cp.name, cc."authorId", cc."createdAt", NULL::int,
             NULLIF(LEFT(cc.text, 140), ''), cc."photoUrl" IS NOT NULL
      FROM "ClientComment" cc
      JOIN "Counterparty" cp ON cp.id = cc."counterpartyId"
      WHERE cc."createdAt" >= ${period.from} AND cc."createdAt" <= ${period.to}
    )
    ORDER BY at DESC
    LIMIT ${limit}`;

  const ids = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return rows.map((r) => ({
    kind: r.kind as FieldEvent["kind"],
    clientId: r.clientId,
    clientName: r.clientName,
    userId: r.userId,
    userName: r.userId ? (nameById.get(r.userId) ?? "Видалений користувач") : "Невідомо хто",
    at: r.at.toISOString(),
    accuracyM: r.accuracyM,
    text: r.text,
    hasPhoto: r.hasPhoto,
  }));
}
