/**
 * Накладні для помічника керівника: список за період і картка за номером.
 *
 * Досі перелік документів не віддавав ніхто: team_overview рахує
 * «реалізацій» одним числом, рядки документів бачив лише склад, а накладну
 * за номером не шукав жоден інструмент. Питання «покажи вчорашній оборот
 * Кулика з накладними» впиралося в «не знайшли».
 *
 * Правила, від яких тут усе залежить:
 * • «продаж» — той самий SOURCE_FILTER, що й у КПІ та team_overview: суми
 *   тут мусять збігатися з розділами адмінки до гривні, інакше два джерела
 *   сперечатимуться, і довіри не буде до жодного;
 * • повернення лежать у базі ВІД'ЄМНИМИ (сума й кількості), тож SUM дає
 *   нетто сам, а лічильники документів і клієнтів повернення не рахують —
 *   як SALES_ONLY у analytics/facts.ts;
 * • маржа — як у revenueByRep: сума документа мінус собівартість рядків із
 *   відомою собівартістю. purchasePrice = 0 означає «1С не привезла», а не
 *   «безкоштовно», тому документ без жодної такої позиції маржі не має;
 * • торговий — s."salesRepId", тобто хто виписав документ у 1С. Офіс
 *   виписує на себе, і такі документи чесно віддаються без торгового;
 * • час 1С лежить у базі як настінний, збережений «як UTC» (див.
 *   formatDocDate у lib/utils.ts і docDay у erp/superseded.ts): дата й
 *   година документа з 1С беруться з UTC-подання без перерахунку, сайтові
 *   документи — за Києвом. Межі періоду при цьому київські, як у
 *   team_overview, інакше «за вчора» тут і там дало б різні документи.
 *
 * Лише читання; 1С не чіпається.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { RETURNS_ONLY, SOURCE_FILTER } from "@/lib/analytics/facts";
import { kyivDate, kyivTime } from "@/lib/date/kyiv";
import { humanText, pct, uah } from "@/lib/assistant/format";
import { pickLines, pickProgress } from "@/lib/warehouse/picking";
import { orderMargin } from "@/lib/analytics/order-margin";
import { findReplacements, isOneCDraft } from "@/lib/erp/superseded";

/** Який зріз документів питають. */
export type DocKind = "sales" | "orders" | "returns" | "all";

export const DOC_KINDS = ["sales", "orders", "returns", "all"] as const;

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  sales: "проведені реалізації з 1С разом із поверненнями",
  orders: "замовлення (крім скасованих)",
  returns: "проведені повернення",
  all: "усі документи, крім скасованих",
};

/** Той самий зріз, коли статус названо явно: «проведені» тоді неправда. */
const DOC_KIND_LABEL_ANY_STATUS: Record<DocKind, string> = {
  sales: "реалізації з 1С разом із поверненнями",
  orders: "замовлення",
  returns: "повернення",
  all: "усі документи",
};

export function docKindLabel(kind: DocKind, status?: string | null): string {
  return status ? DOC_KIND_LABEL_ANY_STATUS[kind] : DOC_KIND_LABEL[kind];
}

export const DOC_STATUSES = ["DRAFT", "CONFIRMED", "PACKING", "IN_TRANSIT", "DELIVERED", "CANCELLED"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

type DocTypeCode = "ORDER" | "REALIZATION" | "RETURN";

const TYPE_WORD: Record<DocTypeCode, string> = {
  REALIZATION: "реалізація",
  RETURN: "повернення",
  ORDER: "замовлення",
};

/**
 * DRAFT з 1С — це накладна, яку менеджер ще набирає (обмін забирає й
 * непроведені), а DRAFT із сайту — заготовка торгового. Слово різне, бо
 * різне й те, що з нею робити.
 */
export function statusLabel(status: string, from1c = true): string {
  switch (status) {
    case "DRAFT":
      return from1c ? "набирається" : "чернетка";
    case "CONFIRMED":
      return "проведено";
    case "PACKING":
      return "пакується";
    case "IN_TRANSIT":
      return "в дорозі";
    case "DELIVERED":
      return "доставлено";
    case "CANCELLED":
      return "скасовано";
    default:
      return status.toLowerCase();
  }
}

const STOP_WORD: Record<string, string> = {
  PENDING: "чекає",
  LOADED: "завантажено",
  DELIVERED: "доставлено",
  FAILED: "не доставлено",
};

const DELIVERY_WORD: Record<string, string> = {
  DRIVER: "водієм",
  SALES_REP_PICKUP: "забирає торговий",
  SELF_PICKUP: "самовивіз",
};

/** «00000006466» → «6466», «00000000412/2026» → «412/2026»; чуже лишаємо як є. */
export function shortNumber(number: string): string {
  const m = number.match(/^0*(\d+)(\/\d+)?$/);
  return m ? `${m[1]}${m[2] ?? ""}` : number;
}

/** Дата й година документа — див. правило про час 1С у шапці файлу. */
function docClock(at: Date, from1c: boolean): { дата: string; час: string } {
  if (from1c) {
    const iso = at.toISOString();
    return { дата: iso.slice(0, 10), час: iso.slice(11, 16) };
  }
  return { дата: kyivDate(at), час: kyivTime(at) };
}

/** День маршруту: лист 1С — настінна дата, маршрут сайту — київська. */
function routeDay(at: Date, from1c: boolean): string {
  return from1c ? at.toISOString().slice(0, 10) : kyivDate(at);
}

const money2 = (n: number) => Math.round(n * 100) / 100;

/* ── Список за період ─────────────────────────────────────────────────── */

export type DocumentFilter = {
  from: Date;
  to: Date;
  repId?: string | null;
  counterpartyId?: string | null;
  /** Документи, які цей водій віз; тоді період — по даті маршруту. */
  driverId?: string | null;
  docType: DocKind;
  status?: DocStatus | null;
  limit: number;
};

type ListRow = {
  id: string;
  number: string;
  docType: DocTypeCode;
  status: string;
  createdAt: Date;
  totalAmount: number;
  discountAmount: number;
  from1c: boolean;
  counterpartyId: string | null;
  clientName: string | null;
  salesRepId: string | null;
  repName: string | null;
  cost: number | null;
  lines: number;
};

type TotalsRow = {
  total: number;
  docs: number;
  returns: number;
  amount: number;
  returnsAmount: number;
  clients: number;
  profit: number;
  costedAmount: number;
  noRep: number;
};

/**
 * Явний статус перебиває статусну частину зрізу, а не додається до неї:
 * «sales зі статусом PACKING» інакше давав би порожньо мовчки, бо
 * SOURCE_FILTER сам вимагає CONFIRMED.
 */
function kindSql(kind: DocKind, status: DocStatus | null | undefined): Prisma.Sql {
  if (!status) {
    switch (kind) {
      case "sales":
        return SOURCE_FILTER;
      case "returns":
        return RETURNS_ONLY;
      case "orders":
        return Prisma.sql`s."docType" = 'ORDER' AND s.status <> 'CANCELLED'`;
      case "all":
        return Prisma.sql`s.status <> 'CANCELLED'`;
    }
  }
  const st = Prisma.sql`s.status::text = ${status}`;
  switch (kind) {
    case "sales":
      return Prisma.sql`s."externalId" IS NOT NULL AND s."docType" IN ('REALIZATION', 'RETURN') AND ${st}`;
    case "returns":
      return Prisma.sql`s."externalId" IS NOT NULL AND s."docType" = 'RETURN' AND ${st}`;
    case "orders":
      return Prisma.sql`s."docType" = 'ORDER' AND ${st}`;
    case "all":
      return st;
  }
}

/**
 * «Що повіз водій» — документи з його маршрутів за період, обома шляхами:
 * лист 1С (точки з накладними, крім прибраних руками) і маршрут сайту.
 * Період тут — по даті маршруту, а не документа: накладну, виписану в
 * п'ятницю, він міг везти в понеділок.
 */
function driverSql(driverId: string, from: Date, to: Date): Prisma.Sql {
  return Prisma.sql`AND (
    EXISTS (
      SELECT 1 FROM "RouteSheetStop" st
      JOIN "RouteSheet" rs ON rs.id = st."routeSheetId"
      WHERE st."salesDocumentId" = s.id AND st.hidden = false
        AND rs."driverId" = ${driverId} AND rs.date >= ${from} AND rs.date <= ${to}
    )
    OR EXISTS (
      SELECT 1 FROM "DeliveryStop" ds
      JOIN "DeliveryRoute" dr ON dr.id = ds."deliveryRouteId"
      WHERE ds."salesDocumentId" = s.id
        AND dr."driverId" = ${driverId} AND dr.date >= ${from} AND dr.date <= ${to}
    )
  )`;
}

function scopeSql(f: DocumentFilter): Prisma.Sql {
  return Prisma.sql`
    ${kindSql(f.docType, f.status)}
    ${f.repId ? Prisma.sql`AND s."salesRepId" = ${f.repId}` : Prisma.empty}
    ${f.counterpartyId ? Prisma.sql`AND s."counterpartyId" = ${f.counterpartyId}` : Prisma.empty}
    ${
      f.driverId
        ? driverSql(f.driverId, f.from, f.to)
        : Prisma.sql`AND s."createdAt" >= ${f.from} AND s."createdAt" <= ${f.to}`
    }
  `;
}

/** Собівартість документа — та сама LATERAL, що в revenueByRep. */
const COST_LATERAL = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT SUM(i."purchasePrice" * i.quantity) AS cost
    FROM "SalesDocumentItem" i
    WHERE i."salesDocumentId" = s.id AND i."purchasePrice" > 0
  ) m ON TRUE`;

export type DocumentRow = {
  документ_id: string;
  номер: string;
  тип: string;
  статус: string;
  дата: string;
  час: string;
  клієнт_id?: string | null;
  клієнт?: string | null;
  торговий_id?: string | null;
  торговий?: string | null;
  сума: number;
  знижка?: number;
  маржа: number | null;
  позицій: number;
  з_1с?: boolean;
};

export type DocumentList = {
  разом: {
    документів: number;
    повернень: number;
    сума_повернень: number;
    оборот: number;
    клієнтів: number;
    середній_чек: number;
    маржа: number | null;
    маржа_відсотків: number | null;
    без_торгового: number;
  };
  показано: number;
  усього: number;
  документи: DocumentRow[];
};

/**
 * Список — один запит із LIMIT, підсумки — другий без нього: керівникові
 * потрібен оборот за ВЕСЬ період, навіть коли показано лише 25 документів.
 */
export async function listDocuments(filter: DocumentFilter): Promise<DocumentList> {
  const scope = scopeSql(filter);

  const [rows, [totals]] = await Promise.all([
    prisma.$queryRaw<ListRow[]>`
      SELECT
        s.id,
        s.number,
        s."docType"::text AS "docType",
        s.status::text AS status,
        s."createdAt",
        s."totalAmount"::float AS "totalAmount",
        s."discountAmount"::float AS "discountAmount",
        (s."externalId" IS NOT NULL) AS "from1c",
        s."counterpartyId",
        c.name AS "clientName",
        s."salesRepId",
        u.name AS "repName",
        m.cost::float AS cost,
        (SELECT COUNT(*) FROM "SalesDocumentItem" i WHERE i."salesDocumentId" = s.id)::int AS lines
      FROM "SalesDocument" s
      LEFT JOIN "Counterparty" c ON c.id = s."counterpartyId"
      LEFT JOIN "User" u ON u.id = s."salesRepId"
      ${COST_LATERAL}
      WHERE ${scope}
      ORDER BY s."createdAt" DESC
      LIMIT ${filter.limit}
    `,
    prisma.$queryRaw<TotalsRow[]>`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE s."docType" <> 'RETURN')::int AS docs,
        COUNT(*) FILTER (WHERE s."docType" = 'RETURN')::int AS returns,
        COALESCE(SUM(s."totalAmount"), 0)::float AS amount,
        COALESCE(-SUM(s."totalAmount") FILTER (WHERE s."docType" = 'RETURN'), 0)::float AS "returnsAmount",
        COUNT(DISTINCT s."counterpartyId") FILTER (WHERE s."docType" <> 'RETURN')::int AS clients,
        COALESCE(SUM(s."totalAmount" - m.cost) FILTER (WHERE m.cost IS NOT NULL), 0)::float AS profit,
        COALESCE(SUM(s."totalAmount") FILTER (WHERE m.cost IS NOT NULL), 0)::float AS "costedAmount",
        COUNT(*) FILTER (WHERE s."salesRepId" IS NULL)::int AS "noRep"
      FROM "SalesDocument" s
      ${COST_LATERAL}
      WHERE ${scope}
    `,
  ]);

  // Що вже стоїть у фільтрі, у кожному рядку не повторюємо: 25 рядків із
  // тим самим прізвищем — це третина ліміту відповіді ні на що.
  const hideRep = !!filter.repId;
  const hideClient = !!filter.counterpartyId;

  return {
    разом: {
      документів: totals.docs,
      повернень: totals.returns,
      сума_повернень: uah(totals.returnsAmount),
      оборот: uah(totals.amount),
      клієнтів: totals.clients,
      // Як avgCheck у бенчмарку: нетто-оборот на кількість продажів.
      середній_чек: totals.docs > 0 ? uah(totals.amount / totals.docs) : 0,
      маржа: totals.costedAmount > 0 ? uah(totals.profit) : null,
      маржа_відсотків: totals.costedAmount > 0 ? pct((totals.profit / totals.costedAmount) * 100) : null,
      без_торгового: totals.noRep,
    },
    показано: rows.length,
    усього: totals.total,
    документи: rows.map((r) => ({
      документ_id: r.id,
      номер: shortNumber(r.number),
      тип: TYPE_WORD[r.docType] ?? r.docType,
      статус: statusLabel(r.status, r.from1c),
      ...docClock(r.createdAt, r.from1c),
      ...(hideClient ? {} : { клієнт_id: r.counterpartyId, клієнт: r.clientName }),
      ...(hideRep ? {} : { торговий_id: r.salesRepId, торговий: r.repName }),
      сума: uah(r.totalAmount),
      ...(r.discountAmount ? { знижка: uah(r.discountAmount) } : {}),
      маржа: r.cost == null ? null : uah(r.totalAmount - r.cost),
      позицій: r.lines,
      ...(r.from1c ? {} : { з_1с: false }),
    })),
  };
}

/* ── Рядки документа ──────────────────────────────────────────────────── */

export type DocumentLine = {
  товар_id: string;
  артикул: string | null;
  товар: string;
  кількість: number;
  ціна: number;
  сума: number;
  знижка_відсотків?: number;
};

/**
 * Порядок рядків — той самий, що на картці документа (/api/erp/sales/[id]):
 * спершу номер рядка з 1С, далі назва. Керівник звіряє відповідь з екраном
 * 1С, і мішанина рядків читається як «дані не ті».
 */
const LINES_ORDER = [
  { lineNo: { sort: "asc" as const, nulls: "last" as const } },
  { product: { name: "asc" as const } },
];

const LINE_SELECT = {
  quantity: true,
  sellingPrice: true,
  purchasePrice: true,
  discountPercent: true,
  product: { select: { id: true, name: true, sku: true } },
} as const;

type RawLine = {
  quantity: number;
  sellingPrice: number;
  purchasePrice: number;
  discountPercent: number;
  product: { id: string; name: string; sku: string | null };
};

function lineRow(i: RawLine): DocumentLine {
  return {
    товар_id: i.product.id,
    артикул: i.product.sku,
    товар: humanText(i.product.name, 70),
    кількість: i.quantity,
    ціна: money2(i.sellingPrice),
    сума: uah(i.quantity * i.sellingPrice),
    ...(i.discountPercent ? { знижка_відсотків: pct(i.discountPercent) } : {}),
  };
}

/** Рядки для списку з with_lines: небагато на документ, бо документів кілька. */
export async function documentLines(
  documentId: string,
  max = 12
): Promise<{ рядки: DocumentLine[]; рядків_усього: number }> {
  const [items, total] = await Promise.all([
    prisma.salesDocumentItem.findMany({
      where: { salesDocumentId: documentId },
      orderBy: LINES_ORDER,
      take: max,
      select: LINE_SELECT,
    }),
    prisma.salesDocumentItem.count({ where: { salesDocumentId: documentId } }),
  ]);
  return { рядки: items.map(lineRow), рядків_усього: total };
}

/* ── Картка за номером ────────────────────────────────────────────────── */

/** Скільки рядків віддає картка: далі — «і ще N», інакше не влазить. */
const CARD_LINES_MAX = 30;

/**
 * Як число з питання перетворюється на номери в базі.
 *
 * 1С зберігає 11 цифр із нулями («00000006466»), повернення — ще з роком
 * через дріб («00000000412/2026»), а людина каже «6466» або «412/2026».
 * Сайтові документи мають свої номери — їх шукаємо як є.
 */
export function numberCandidates(raw: string): { exact: string[]; prefix: string | null } {
  const trimmed = raw.trim();
  const exact = new Set<string>();
  if (trimmed) exact.add(trimmed);
  const m = trimmed.match(/^\D*?(\d{1,11})(?:\s*\/\s*(\d{2,4}))?\D*$/);
  if (!m) return { exact: [...exact], prefix: null };
  const padded = m[1].padStart(11, "0");
  exact.add(m[2] ? `${padded}/${m[2]}` : padded);
  return { exact: [...exact], prefix: m[2] ? null : `${padded}/` };
}

const TYPE_RANK: Record<DocTypeCode, number> = { REALIZATION: 0, RETURN: 1, ORDER: 2 };

export async function documentByNumber(number: string, docType?: DocKind | null) {
  const { exact, prefix } = numberCandidates(number);
  if (exact.length === 0) return null;

  const typeWhere =
    docType === "sales"
      ? { docType: { in: ["REALIZATION", "RETURN"] as DocTypeCode[] } }
      : docType === "returns"
        ? { docType: "RETURN" as const }
        : docType === "orders"
          ? { docType: "ORDER" as const }
          : {};

  const docs = await prisma.salesDocument.findMany({
    where: {
      ...typeWhere,
      OR: [{ number: { in: exact } }, ...(prefix ? [{ number: { startsWith: prefix } }] : [])],
    },
    take: 4,
    include: {
      counterparty: { select: { id: true, name: true, address: true } },
      salesRep: { select: { id: true, name: true } },
      items: { orderBy: LINES_ORDER, select: LINE_SELECT },
      pickMarks: {
        select: {
          quantity: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, name: true } },
        },
      },
      deliveryStop: {
        select: {
          status: true,
          deliveredAt: true,
          deliveryRoute: {
            select: { number: true, date: true, driver: { select: { id: true, name: true } } },
          },
        },
      },
      routeSheetStops: {
        where: { hidden: false },
        select: {
          routeSheet: {
            select: {
              number: true,
              date: true,
              driverName1C: true,
              driver: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (docs.length === 0) return null;

  /**
   * ORDER і REALIZATION ділять номерний простір, тож «6466» — це часто два
   * документи. Головна — реалізація: вона і є відвантаження; замовлення
   * віддаємо поруч, щоб модель могла сказати «є ще замовлення з тим самим
   * номером», а не мовчки показати не те.
   */
  docs.sort(
    (a, b) =>
      TYPE_RANK[a.docType] - TYPE_RANK[b.docType] ||
      Number(b.status === "CONFIRMED") - Number(a.status === "CONFIRMED") ||
      b.createdAt.getTime() - a.createdAt.getTime()
  );
  const [doc, ...others] = docs;
  const from1c = !!doc.externalId;

  /* Маржа: собівартість 1С, коли вона є хоч в одному рядку; інакше оцінка. */
  const costed = doc.items.filter((i) => i.purchasePrice > 0);
  let маржа: number | null = null;
  let маржа_відсотків: number | null = null;
  let маржа_джерело: string;
  if (costed.length > 0) {
    const cost = costed.reduce((s, i) => s + i.purchasePrice * i.quantity, 0);
    маржа = uah(doc.totalAmount - cost);
    маржа_відсотків = doc.totalAmount > 0 ? pct(((doc.totalAmount - cost) / doc.totalAmount) * 100) : null;
    маржа_джерело =
      costed.length === doc.items.length
        ? "собівартість з 1С"
        : `собівартість з 1С лише у ${costed.length} із ${doc.items.length} рядків — маржа завищена`;
  } else if (doc.items.length > 0) {
    const est = await orderMargin(doc.id);
    if (est && est.costKnownAmount > 0) {
      маржа = uah(est.estimatedProfit);
      маржа_відсотків = pct(est.marginPct);
      маржа_джерело = `оцінка за останньою собівартістю (покриває ${pct(est.coverage)} % суми)`;
    } else {
      маржа_джерело = "собівартості немає — товар ще не відвантажувався";
    }
  } else {
    маржа_джерело = "рядків немає";
  }

  /* Збірка: лише коли склад щось відмічав — інакше це не «0 із 9», а «не збирали». */
  const marks = doc.pickMarks.filter((m) => m.quantity > 0);
  const збірка = marks.length > 0 ? pickProgress(await pickLines(doc.id)) : null;
  const byPicker = new Map<string, { хто: string; хто_id: string; рядків: number; з: Date; по: Date }>();
  for (const m of marks) {
    const acc = byPicker.get(m.user.id) ?? {
      хто: m.user.name,
      хто_id: m.user.id,
      рядків: 0,
      з: m.createdAt,
      по: m.updatedAt,
    };
    acc.рядків += 1;
    if (m.createdAt < acc.з) acc.з = m.createdAt;
    if (m.updatedAt > acc.по) acc.по = m.updatedAt;
    byPicker.set(m.user.id, acc);
  }
  const зібрав = [...byPicker.values()].map((p) => ({
    хто: p.хто,
    рядків: p.рядків,
    день: kyivDate(p.по),
    з: kyivTime(p.з),
    по: kyivTime(p.по),
  }));

  /* Доставка: лист 1С і маршрут сайту — обидва, якщо є. */
  const доставка = [
    ...doc.routeSheetStops.map((st) => ({
      джерело: "лист 1С",
      водій_id: st.routeSheet.driver?.id ?? null,
      водій: st.routeSheet.driver?.name ?? st.routeSheet.driverName1C ?? null,
      номер: shortNumber(st.routeSheet.number),
      день: routeDay(st.routeSheet.date, true),
      стан: null as string | null,
    })),
    ...(doc.deliveryStop
      ? [
          {
            джерело: "маршрут сайту",
            водій_id: doc.deliveryStop.deliveryRoute.driver?.id ?? null,
            водій: doc.deliveryStop.deliveryRoute.driver?.name ?? null,
            номер: doc.deliveryStop.deliveryRoute.number,
            день: routeDay(doc.deliveryStop.deliveryRoute.date, false),
            стан: STOP_WORD[doc.deliveryStop.status] ?? doc.deliveryStop.status,
          },
        ]
      : []),
  ];

  const replacement = isOneCDraft(doc) ? (await findReplacements([doc])).get(doc.id) : undefined;

  return {
    документ: {
      документ_id: doc.id,
      номер: shortNumber(doc.number),
      номер_1с: doc.number,
      тип: TYPE_WORD[doc.docType],
      статус: statusLabel(doc.status, from1c),
      ...docClock(doc.createdAt, from1c),
      клієнт_id: doc.counterparty?.id ?? null,
      клієнт: doc.counterparty?.name ?? null,
      адреса: doc.counterparty?.address ?? null,
      торговий_id: doc.salesRep?.id ?? null,
      торговий: doc.salesRep?.name ?? null,
      сума: uah(doc.totalAmount),
      знижка: uah(doc.discountAmount),
      позицій: doc.items.length,
      з_1с: from1c,
      доставка_спосіб: doc.deliveryMethod ? (DELIVERY_WORD[doc.deliveryMethod] ?? doc.deliveryMethod) : null,
      примітки: humanText(doc.notes, 200) || null,
    },
    рядки: doc.items.slice(0, CARD_LINES_MAX).map(lineRow),
    рядків_усього: doc.items.length,
    маржа,
    маржа_відсотків,
    маржа_джерело,
    збірка,
    зібрав,
    доставка,
    замінено_на: replacement
      ? { документ_id: replacement.id, номер: shortNumber(replacement.number), сума: uah(replacement.totalAmount) }
      : undefined,
    інший_з_тим_самим_номером:
      others.length > 0
        ? others.map((o) => ({
            документ_id: o.id,
            номер: shortNumber(o.number),
            тип: TYPE_WORD[o.docType],
            статус: statusLabel(o.status, !!o.externalId),
            ...docClock(o.createdAt, !!o.externalId),
            сума: uah(o.totalAmount),
            позицій: o.items.length,
          }))
        : undefined,
  };
}

export type DocumentCard = NonNullable<Awaited<ReturnType<typeof documentByNumber>>>;
