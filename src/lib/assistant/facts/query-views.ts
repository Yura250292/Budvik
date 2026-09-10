/**
 * Віртуальні види бази для query_db — те, що модель бачить замість таблиць.
 *
 * Модель не отримує доступу до базових таблиць: там CamelCase у лапках,
 * enum-и, час 1С упереміш із часом сайту й три різні правила «що таке
 * продаж». Кожне з цих правил вона вгадувала б наново в кожному запиті —
 * і вгадувала б інакше, ніж кабінет. Тому база показана їй як набір
 * представлень зі snake_case-колонками, у які правила вже вшиті:
 * `real_sale` — той самий фільтр, що й у КПІ (SOURCE_FILTER + межа
 * аналітики), `rep_id` — та сама драбина торгового, що й на карті
 * замовлень, `day` — та сама київська доба, що й у готових інструментах,
 * `stock_free` — той самий вільний залишок, що й у картці клієнта.
 *
 * Це не справжні VIEW у Postgres, а CTE, які підставляються перед запитом
 * моделі (`WITH documents AS NOT MATERIALIZED (…)`): жодної міграції, а
 * NOT MATERIALIZED дозволяє планувальнику протягнути фільтри моделі
 * всередину — незгадані види не виконуються взагалі.
 *
 * Фрагменти тут — рядки, а не Prisma.sql: весь текст іде в
 * $queryRawUnsafe одним шматком, і параметризувати в ньому нема чого.
 *
 * Час. Мітки 1С (SalesDocument.createdAt, Payment.paidAt, RouteSheet.date)
 * — київський настінний час, збережений як UTC; сайтові мітки — справжній
 * UTC; «денні» колонки (TrackSession.day, DebtSnapshot.day, CashHandover.day)
 * — початок київської доби. Один вираз KYIV_DAY дає правильну дату для всіх
 * трьох: для 1С він зсуває на 3 години — та сама межа, що й у
 * kyivDayStart/kyivDayEnd готових інструментів (розбіжність лише для
 * документів 21:00–24:00, 1 з ~1700; обрано заради збігу з team_overview).
 * Настінний час 1С окремо — `clock` через WALL. Сирі мітки 1С у видах
 * переведено в справжній UTC (TS_1C), щоб форматер показував їх як усі
 * інші — київським часом.
 *
 * Правила імен: колонки маленькими літерами, без зарезервованих слів
 * (user, order, end, from, to, time, date, type); ідентифікатори —
 * client_id, product_id, rep_id, driver_id, user_id, document_id; enum-и
 * приведено до text, щоб ILIKE по них працював.
 */

import { SOURCE_FILTER } from "@/lib/analytics/facts";
import { FREE_STOCK_ALL, LAST_COST, LAST_SALE } from "@/lib/assistant/facts/sql";
import { ANALYTICS_SINCE_DAY } from "@/lib/analytics/since";
import { kyivDayStart } from "@/lib/date/kyiv";

export type ViewColumn = { name: string; type: string; description: string };

export type View = {
  name: string;
  /** Одним реченням: про що вид — це все, що модель бачить у списку. */
  purpose: string;
  columns: ViewColumn[];
  /** Тіло CTE без `name AS (`. */
  sql: string;
  /** Службові CTE, які мають стояти перед цим видом. */
  deps?: string[];
  /** Готові запити — для flash це працює краще за прозу. */
  examples?: string[];
};

/** Службовий CTE: не вид, модель його не бачить, але види на нього спираються. */
export type HelperCte = { name: string; body: string };

/* ── Фрагменти ─────────────────────────────────────────────────────────── */

/** Київська дата з будь-якої мітки (див. шапку про три види часу). */
export const KYIV_DAY = (col: string) =>
  `((${col}) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv')::date`;

/** Настінний час 1С як записано — для міток, що вже київські. */
export const WALL = (col: string) => `to_char(${col}, 'HH24:MI')`;

/** Київський час із справжньої UTC-мітки сайту. */
export const CLOCK = (col: string) =>
  `to_char((${col}) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'HH24:MI')`;

/** Мітка 1С (настінний час як UTC) → справжній UTC, щоб форматер не додав ще 3 години. */
export const TS_1C = (col: string) => `((${col}) AT TIME ZONE 'Europe/Kyiv' AT TIME ZONE 'UTC')`;

/** Межа аналітики тим самим моментом, що й ANALYTICS_SINCE у facts.ts. */
const SINCE_TS = `TIMESTAMP '${kyivDayStart(ANALYTICS_SINCE_DAY).toISOString().slice(0, 19).replace("T", " ")}'`;

/**
 * «Реальний продаж» для аліаса s: SOURCE_FILTER з КПІ плюс межа аналітики.
 *
 * До 2026 року в базі лише повернення, тож без межі оборот за старі
 * місяці був би від'ємним. Старі рядки при цьому видимі — з real_sale=false.
 */
export const REAL_SALE = `(${SOURCE_FILTER.sql.trim()} AND s."createdAt" >= ${SINCE_TS})`;

/* ── Службові CTE ──────────────────────────────────────────────────────── */

/** `name AS (body)` з Prisma.sql у facts/sql.ts → тіло. */
function bodyOf(tag: { sql: string }): { name: string; body: string } {
  const m = tag.sql.match(/^\s*(\w+)\s+AS\s*\(([\s\S]*)\)\s*$/);
  if (!m) throw new Error("Фрагмент facts/sql.ts не має вигляду `name AS (...)`");
  return { name: m[1], body: m[2] };
}

/**
 * Торговий і остання реалізація клієнта — один раз на клієнта.
 *
 * Драбина та сама, що в orders-today.ts і звірці боргів: закріплення
 * (SalesRepClient), далі останній проведений документ клієнта, крім
 * повернень. Рахується по клієнту, а не по рядку документа: інакше для
 * document_lines це були б два LATERAL на кожну позицію.
 */
const CLIENT_FACTS: HelperCte = {
  name: "client_facts",
  body: `
    SELECT c.id AS client_id,
           COALESCE(rc."salesRepId", last_doc."salesRepId") AS rep_id,
           ls.last_sale_at
    FROM "Counterparty" c
    LEFT JOIN LATERAL (
      SELECT r."salesRepId" FROM "SalesRepClient" r
      WHERE r."counterpartyId" = c.id
      ORDER BY r.id
      LIMIT 1
    ) rc ON TRUE
    LEFT JOIN LATERAL (
      SELECT d."salesRepId" FROM "SalesDocument" d
      WHERE d."counterpartyId" = c.id AND d."salesRepId" IS NOT NULL
        AND d."docType" <> 'RETURN' AND d.status = 'CONFIRMED'
      ORDER BY (d."docType" = 'REALIZATION') DESC, d."createdAt" DESC
      LIMIT 1
    ) last_doc ON TRUE
    LEFT JOIN LATERAL (
      SELECT MAX(d."createdAt") AS last_sale_at FROM "SalesDocument" d
      WHERE d."counterpartyId" = c.id AND d."externalId" IS NOT NULL
        AND d.status = 'CONFIRMED' AND d."docType" = 'REALIZATION'
    ) ls ON TRUE`,
};

export const HELPERS: HelperCte[] = [CLIENT_FACTS, bodyOf(FREE_STOCK_ALL), bodyOf(LAST_COST), bodyOf(LAST_SALE)];
export const HELPER_BY_NAME = new Map(HELPERS.map((h) => [h.name, h]));

/* ── Види ──────────────────────────────────────────────────────────────── */

const col = (name: string, type: string, description: string): ViewColumn => ({ name, type, description });

const ID = "id";
const T = "text";
const N = "число";
const I = "ціле";
const B = "так/ні";
const D = "дата";
const CLK = "HH:MM";
const TS = "дата й час";

/** Той самий трійник колонок про документ — у documents і document_lines. */
const DOC_HEAD = [
  col("document_id", ID, "ідентифікатор документа (для посилання)"),
  col("number", T, "номер 1С, 11 цифр із нулями («00000006466»); шукай number LIKE '%6466'"),
  col("doc_type", T, "ORDER (замовлення) / REALIZATION (реалізація, відвантажено) / RETURN (повернення)"),
  col("status", T, "DRAFT / CONFIRMED (проведено) / PACKING / IN_TRANSIT / DELIVERED / CANCELLED"),
  col("from_1c", B, "документ прийшов з 1С (інакше створений на сайті)"),
  col("real_sale", B, "проведена реалізація або повернення з 1С з 2026-01-01 — фільтр обороту, як у кабінеті"),
  col("day", D, "київська дата документа"),
];

const DOC_PEOPLE = [
  col("client_id", ID, "клієнт (Counterparty)"),
  col("client", T, "назва клієнта"),
  col("rep_id", ID, "торговий за драбиною: хто виписав → закріплення клієнта → останній документ клієнта"),
  col("rep", T, "імʼя торгового за драбиною"),
  col("doc_rep_id", ID, "хто виписав документ у 1С (може бути NULL — офіс); саме так рахує team_overview"),
];

export const VIEWS: View[] = [
  {
    name: "staff",
    purpose: "працівники фірми: торгові, водії, складовщики, офіс",
    columns: [
      col("user_id", ID, "ідентифікатор"),
      col("name", T, "імʼя"),
      col("role", T, "SALES / DRIVER / WAREHOUSE / ADMIN / MANAGER"),
      col("phone", T, "телефон"),
      col("email", T, "email"),
      col("has_telegram", B, "привʼязаний Telegram"),
      col("created_day", D, "коли заведено"),
    ],
    sql: `
      SELECT u.id AS user_id, u.name, u.role::text AS role, u.phone, u.email,
             (u."telegramId" IS NOT NULL) AS has_telegram,
             ${KYIV_DAY('u."createdAt"')} AS created_day
      FROM "User" u
      WHERE u.role IN ('SALES', 'DRIVER', 'WAREHOUSE', 'ADMIN', 'MANAGER')`,
  },
  {
    name: "clients",
    purpose: "контрагенти: борг, торговий за драбиною, остання реалізація, адреса",
    deps: ["client_facts"],
    columns: [
      col("client_id", ID, "ідентифікатор"),
      col("name", T, "назва"),
      col("code", T, "код 1С"),
      col("kind", T, "CUSTOMER / SUPPLIER / BOTH"),
      col("phone", T, "телефон"),
      col("contact", T, "контактна особа"),
      col("address", T, "юридична адреса"),
      col("delivery_address", T, "адреса доставки"),
      col("lat", N, "широта точки доставки"),
      col("lng", N, "довгота"),
      col("zone", T, "CITY / OBLAST або NULL"),
      col("active", B, "активний"),
      col("from_1c", B, "є в 1С"),
      col("debt", N, "дебіторка (receivableBalance), грн; NULL — боргу немає"),
      col("debt_synced_day", D, "коли борг востаннє звірено з 1С"),
      col("rep_id", ID, "торговий за драбиною (закріплення → останній документ)"),
      col("rep", T, "імʼя торгового"),
      col("last_sale_day", D, "остання проведена реалізація"),
      col("notes", T, "нотатки (до 200 символів)"),
      col("created_day", D, "коли заведено"),
    ],
    sql: `
      SELECT c.id AS client_id, c.name, c.code, c.type::text AS kind,
             c.phone, c."contactPerson" AS contact, c.address, c."deliveryAddress" AS delivery_address,
             c."deliveryLat" AS lat, c."deliveryLng" AS lng, c."deliveryZone"::text AS zone,
             c."isActive" AS active, (c."externalId" IS NOT NULL) AS from_1c,
             c."receivableBalance" AS debt, ${KYIV_DAY('c."balanceSyncedAt"')} AS debt_synced_day,
             cf.rep_id, ru.name AS rep,
             ${KYIV_DAY("cf.last_sale_at")} AS last_sale_day,
             LEFT(c.notes, 200) AS notes,
             ${KYIV_DAY('c."createdAt"')} AS created_day
      FROM "Counterparty" c
      JOIN client_facts cf ON cf.client_id = c.id
      LEFT JOIN "User" ru ON ru.id = cf.rep_id`,
    examples: [
      "SELECT name, debt, rep, last_sale_day FROM clients WHERE debt > 0 ORDER BY debt DESC LIMIT 20",
      "SELECT rep, COUNT(*) AS clients, SUM(debt) AS debt FROM clients WHERE debt > 0 GROUP BY rep ORDER BY debt DESC LIMIT 20",
    ],
  },
  {
    name: "rep_clients",
    purpose: "портфель торгового: пара торговий–клієнт із закріплення або з документів",
    columns: [
      col("rep_id", ID, "торговий"),
      col("rep", T, "імʼя торгового"),
      col("client_id", ID, "клієнт"),
      col("client", T, "назва клієнта"),
      col("pinned", B, "закріплений явно (SalesRepClient)"),
      col("has_docs", B, "торговий виписував йому документи"),
    ],
    sql: `
      SELECT x.rep_id, u.name AS rep, x.client_id, c.name AS client,
             bool_or(x.pinned) AS pinned, bool_or(x.has_docs) AS has_docs
      FROM (
        SELECT r."salesRepId" AS rep_id, r."counterpartyId" AS client_id, TRUE AS pinned, FALSE AS has_docs
        FROM "SalesRepClient" r
        UNION ALL
        SELECT DISTINCT d."salesRepId", d."counterpartyId", FALSE, TRUE
        FROM "SalesDocument" d
        WHERE d."salesRepId" IS NOT NULL AND d."counterpartyId" IS NOT NULL
      ) x
      JOIN "User" u ON u.id = x.rep_id
      JOIN "Counterparty" c ON c.id = x.client_id
      GROUP BY x.rep_id, u.name, x.client_id, c.name`,
  },
  {
    name: "documents",
    purpose: "накладні 1С і сайту: замовлення, реалізації, повернення — шапка документа",
    deps: ["client_facts"],
    columns: [
      ...DOC_HEAD,
      col("clock", CLK, "настінний час 1С"),
      ...DOC_PEOPLE,
      col("total", N, "сума документа, грн; у RETURN від'ємна — SUM(total) дає нетто"),
      col("discount", N, "знижка шапки, грн"),
      col("profit_1c", N, "вал за даними обміну (відстає, поки документ не перечитали)"),
      col("delivery_method", T, "DRIVER / SALES_REP_PICKUP / SELF_PICKUP або NULL"),
      col("lines", I, "кількість позицій"),
      col("created_at", TS, "дата й час документа"),
      col("confirmed_at", TS, "коли проведено на сайті (для 1С зазвичай NULL)"),
      col("notes", T, "примітка (до 200 символів)"),
    ],
    sql: `
      SELECT s.id AS document_id, s.number, s."docType"::text AS doc_type, s.status::text AS status,
             (s."externalId" IS NOT NULL) AS from_1c,
             ${REAL_SALE} AS real_sale,
             ${KYIV_DAY('s."createdAt"')} AS day,
             ${WALL('s."createdAt"')} AS clock,
             s."counterpartyId" AS client_id, c.name AS client,
             COALESCE(s."salesRepId", cf.rep_id) AS rep_id, ru.name AS rep,
             s."salesRepId" AS doc_rep_id,
             s."totalAmount" AS total, s."discountAmount" AS discount, s."profitAmount" AS profit_1c,
             s."deliveryMethod"::text AS delivery_method,
             (SELECT COUNT(*) FROM "SalesDocumentItem" i WHERE i."salesDocumentId" = s.id)::int AS lines,
             ${TS_1C('s."createdAt"')} AS created_at,
             s."confirmedAt" AS confirmed_at,
             LEFT(s.notes, 200) AS notes
      FROM "SalesDocument" s
      LEFT JOIN "Counterparty" c ON c.id = s."counterpartyId"
      LEFT JOIN client_facts cf ON cf.client_id = s."counterpartyId"
      LEFT JOIN "User" ru ON ru.id = COALESCE(s."salesRepId", cf.rep_id)`,
    examples: [
      "SELECT rep, SUM(total) AS amount, COUNT(*) FILTER (WHERE doc_type <> 'RETURN') AS docs FROM documents WHERE real_sale AND day BETWEEN '2026-09-01' AND '2026-09-10' GROUP BY rep ORDER BY amount DESC LIMIT 20",
      "SELECT number, client, total, status, clock FROM documents WHERE day = '2026-09-09' AND rep ILIKE '%Кулик%' ORDER BY clock LIMIT 50",
    ],
  },
  {
    name: "document_lines",
    purpose: "рядки накладних: товар, кількість, ціна, собівартість — для зрізів по товарах і брендах",
    deps: ["client_facts"],
    columns: [
      col("line_id", ID, "ідентифікатор рядка"),
      ...DOC_HEAD,
      ...DOC_PEOPLE,
      col("product_id", ID, "товар"),
      col("sku", T, "артикул"),
      col("product", T, "назва товару"),
      col("brand", T, "бренд"),
      col("category", T, "категорія 1С"),
      col("type_key", T, "вид товару за класифікатором (піна, електроди, круг…)"),
      col("section_id", T, "розділ каталогу"),
      col("quantity", N, "кількість; у RETURN від'ємна"),
      col("price", N, "ціна продажу за одиницю"),
      col("cost", N, "собівартість за одиницю; 0 = невідомо (не безкоштовно)"),
      col("discount_pct", N, "знижка рядка, %"),
      col("amount", N, "quantity × price; знижка шапки документа сюди не входить"),
      col("line_no", I, "номер рядка в документі"),
    ],
    sql: `
      SELECT i.id AS line_id,
             s.id AS document_id, s.number, s."docType"::text AS doc_type, s.status::text AS status,
             (s."externalId" IS NOT NULL) AS from_1c,
             ${REAL_SALE} AS real_sale,
             ${KYIV_DAY('s."createdAt"')} AS day,
             s."counterpartyId" AS client_id, c.name AS client,
             COALESCE(s."salesRepId", cf.rep_id) AS rep_id, ru.name AS rep,
             s."salesRepId" AS doc_rep_id,
             p.id AS product_id, p.sku, p.name AS product, b.name AS brand, cat.name AS category,
             p."typeKey" AS type_key, p."sectionId" AS section_id,
             i.quantity, i."sellingPrice" AS price, i."purchasePrice" AS cost,
             i."discountPercent" AS discount_pct,
             (i.quantity * i."sellingPrice") AS amount,
             i."lineNo" AS line_no
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      LEFT JOIN "Category" cat ON cat.id = p."categoryId"
      LEFT JOIN "Counterparty" c ON c.id = s."counterpartyId"
      LEFT JOIN client_facts cf ON cf.client_id = s."counterpartyId"
      LEFT JOIN "User" ru ON ru.id = COALESCE(s."salesRepId", cf.rep_id)`,
    examples: [
      "SELECT day, SUM(quantity) AS qty, SUM(amount) AS amount FROM document_lines WHERE real_sale AND product ILIKE '%піна%' AND day >= '2026-09-01' GROUP BY day ORDER BY day LIMIT 31",
      "SELECT brand, SUM(amount) AS amount, SUM(amount - quantity * cost) FILTER (WHERE cost > 0) AS profit FROM document_lines WHERE real_sale AND day BETWEEN '2026-09-01' AND '2026-09-30' GROUP BY brand ORDER BY amount DESC LIMIT 15",
    ],
  },
  {
    name: "products",
    purpose: "товари: ціни, вільний залишок, остання собівартість, бренд, розділ",
    deps: ["free_stock", "last_cost", "last_sale"],
    columns: [
      col("product_id", ID, "ідентифікатор"),
      col("sku", T, "артикул"),
      col("name", T, "назва"),
      col("brand_id", ID, "бренд"),
      col("brand", T, "назва бренду"),
      col("category", T, "категорія 1С"),
      col("type_key", T, "вид за класифікатором"),
      col("section_id", T, "розділ каталогу"),
      col("price", N, "роздрібна ціна сайту"),
      col("wholesale_price", N, "оптова ціна (тип цін 1С); NULL — немає"),
      col("promo_price", N, "акційна ціна або NULL"),
      col("pack_qty", I, "кратність пакування"),
      col("active", B, "показується в каталозі"),
      col("from_1c", B, "є в 1С"),
      col("has_photo", B, "є фото"),
      col("stock_free", I, "вільний залишок на несервісних складах (available)"),
      col("last_cost", N, "остання відома собівартість за одиницю; NULL — невідома"),
      col("last_sale_day", D, "коли продавали востаннє"),
      col("price_synced_day", D, "коли ціна востаннє прийшла з 1С"),
    ],
    sql: `
      SELECT p.id AS product_id, p.sku, p.name, p."brandId" AS brand_id, b.name AS brand,
             cat.name AS category, p."typeKey" AS type_key, p."sectionId" AS section_id,
             p.price, p."wholesalePrice" AS wholesale_price, p."promoPrice" AS promo_price,
             p."packQty" AS pack_qty, p."isActive" AS active,
             (p."externalId" IS NOT NULL) AS from_1c, (p.image IS NOT NULL) AS has_photo,
             COALESCE(fs.free, 0) AS stock_free, lc.cost AS last_cost,
             ${KYIV_DAY("ls.ts")} AS last_sale_day,
             ${KYIV_DAY('p."priceSyncedAt"')} AS price_synced_day
      FROM "Product" p
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      LEFT JOIN "Category" cat ON cat.id = p."categoryId"
      LEFT JOIN free_stock fs ON fs."productId" = p.id
      LEFT JOIN last_cost lc ON lc."productId" = p.id
      LEFT JOIN last_sale ls ON ls."productId" = p.id`,
    examples: [
      "SELECT sku, name, brand, price, stock_free, last_sale_day FROM products WHERE active AND name ILIKE '%піна%' ORDER BY stock_free DESC LIMIT 20",
      "SELECT brand, COUNT(*) AS items, SUM(stock_free) AS pieces FROM products WHERE active AND stock_free > 0 GROUP BY brand ORDER BY items DESC LIMIT 20",
    ],
  },
  {
    name: "stock_by_location",
    purpose: "залишки по складах: кількість, резерв, вільно; сервісні склади позначено",
    columns: [
      col("product_id", ID, "товар"),
      col("sku", T, "артикул"),
      col("product", T, "назва товару"),
      col("brand", T, "бренд"),
      col("location_id", ID, "склад"),
      col("location", T, "назва складу"),
      col("service", B, "сервісний склад (не для продажу)"),
      col("quantity", I, "кількість"),
      col("reserved", I, "у резерві"),
      col("available", I, "вільно"),
      col("synced_at", TS, "коли залишок прийшов з 1С"),
    ],
    sql: `
      SELECT ls."productId" AS product_id, p.sku, p.name AS product, b.name AS brand,
             sl.id AS location_id, sl.name AS location, sl."isService" AS service,
             ls.quantity, ls.reserved, ls.available, ls."syncedAt" AS synced_at
      FROM "LocationStock" ls
      JOIN "StockLocation" sl ON sl.id = ls."stockLocationId"
      JOIN "Product" p ON p.id = ls."productId"
      LEFT JOIN "Brand" b ON b.id = p."brandId"`,
  },
  {
    name: "payments",
    purpose: "оплати клієнтів: ПКО й банк з 1С, ручні з сайту",
    columns: [
      col("payment_id", ID, "ідентифікатор"),
      col("day", D, "дата оплати (paidAt, інакше створення)"),
      col("clock", CLK, "час"),
      col("amount", N, "сума, грн"),
      col("method", T, "спосіб: cash, bank_transfer…"),
      col("source", T, "звідки запис: 1С чи MANUAL"),
      col("cash_desk", T, "каса 1С"),
      col("contract", T, "договір 1С"),
      col("client_id", ID, "клієнт"),
      col("client", T, "назва клієнта"),
      col("invoice_number", T, "номер рахунку"),
      col("document_id", ID, "накладна рахунку, якщо є"),
      col("from_1c", B, "прийшло з 1С"),
      col("notes", T, "примітка"),
    ],
    sql: `
      SELECT pm.id AS payment_id,
             ${KYIV_DAY('COALESCE(pm."paidAt", pm."createdAt")')} AS day,
             ${WALL('COALESCE(pm."paidAt", pm."createdAt")')} AS clock,
             pm.amount, pm.method, pm.source, pm."cashDesk" AS cash_desk, pm."contractName" AS contract,
             inv."counterpartyId" AS client_id, c.name AS client,
             inv.number AS invoice_number, inv."salesDocumentId" AS document_id,
             (pm."externalId" IS NOT NULL) AS from_1c, LEFT(pm.notes, 200) AS notes
      FROM "Payment" pm
      JOIN "Invoice" inv ON inv.id = pm."invoiceId"
      LEFT JOIN "Counterparty" c ON c.id = inv."counterpartyId"`,
  },
  {
    name: "payment_allocations",
    purpose: "рознесення оплат на торгових і бренди — джерело «зібрано» в КПІ",
    columns: [
      col("allocation_id", ID, "ідентифікатор"),
      col("payment_id", ID, "оплата"),
      col("day", D, "дата оплати"),
      col("rep_id", ID, "торговий, якому зараховано"),
      col("rep", T, "імʼя торгового"),
      col("amount", N, "зараховано, грн"),
      col("profit", N, "вал у зарахованій сумі"),
      col("brand_id", ID, "бренд або NULL"),
      col("brand", T, "назва бренду"),
      col("source", T, "як рознесено: DOCUMENT (за документом) чи інакше"),
      col("client_id", ID, "клієнт"),
      col("client", T, "назва клієнта"),
    ],
    sql: `
      SELECT a.id AS allocation_id, a."paymentId" AS payment_id,
             ${KYIV_DAY('COALESCE(pm."paidAt", pm."createdAt")')} AS day,
             a."repId" AS rep_id, u.name AS rep, a.amount, a."profitAmount" AS profit,
             a."brandId" AS brand_id, b.name AS brand, a.source,
             inv."counterpartyId" AS client_id, c.name AS client
      FROM "PaymentAllocation" a
      JOIN "Payment" pm ON pm.id = a."paymentId"
      JOIN "Invoice" inv ON inv.id = pm."invoiceId"
      LEFT JOIN "Counterparty" c ON c.id = inv."counterpartyId"
      LEFT JOIN "User" u ON u.id = a."repId"
      LEFT JOIN "Brand" b ON b.id = a."brandId"`,
    examples: [
      "SELECT rep, SUM(amount) AS collected, SUM(profit) AS profit FROM payment_allocations WHERE day BETWEEN '2026-09-01' AND '2026-09-30' GROUP BY rep ORDER BY collected DESC LIMIT 20",
    ],
  },
  {
    name: "shifts",
    purpose: "зміни торгових: одометр, пробіг GPS проти одометра, тривалість, автозакриття",
    columns: [
      col("shift_id", ID, "ідентифікатор"),
      col("user_id", ID, "торговий"),
      col("name", T, "імʼя"),
      col("status", T, "OPEN / CLOSED / ABANDONED"),
      col("day", D, "дата початку"),
      col("started_clock", CLK, "час початку"),
      col("ended_day", D, "дата кінця"),
      col("ended_clock", CLK, "час кінця"),
      col("start_odometer", I, "одометр на старті, км"),
      col("end_odometer", I, "одометр у кінці"),
      col("distance_km", I, "пробіг за одометром"),
      col("gps_km", N, "пробіг за треком"),
      col("drive_km", N, "їзда за треком"),
      col("walk_km", N, "пішки"),
      col("stop_km", N, "дрейф на стоянках"),
      col("personal_km", I, "особисті км"),
      col("after_work_km", N, "після зміни"),
      col("duration_min", I, "тривалість, хв"),
      col("auto_closed", B, "закрито автоматично"),
      col("closed_late", B, "закрито із запізненням"),
      col("suspicious", B, "одометр підозрілий"),
      col("confirmed", B, "підтверджено офісом"),
      col("notes", T, "примітка"),
    ],
    sql: `
      SELECT sh.id AS shift_id, sh."userId" AS user_id, u.name, sh.status::text AS status,
             ${KYIV_DAY('sh."startedAt"')} AS day, ${CLOCK('sh."startedAt"')} AS started_clock,
             ${KYIV_DAY('sh."endedAt"')} AS ended_day, ${CLOCK('sh."endedAt"')} AS ended_clock,
             sh."startOdometer" AS start_odometer, sh."endOdometer" AS end_odometer,
             sh."distanceKm" AS distance_km, sh."gpsDistanceKm" AS gps_km, sh."driveKm" AS drive_km,
             sh."walkKm" AS walk_km, sh."stopKm" AS stop_km, sh."personalKm" AS personal_km,
             sh."afterWorkKm" AS after_work_km, sh."durationMinutes" AS duration_min,
             sh."closedAutomatically" AS auto_closed, sh."closedLate" AS closed_late,
             sh."odometerSuspicious" AS suspicious, (sh."confirmedAt" IS NOT NULL) AS confirmed,
             LEFT(sh.notes, 200) AS notes
      FROM "Shift" sh
      JOIN "User" u ON u.id = sh."userId"`,
  },
  {
    name: "track_days",
    purpose: "GPS-трек за день: точки, кілометри, коли почався й коли остання точка",
    columns: [
      col("user_id", ID, "працівник"),
      col("name", T, "імʼя"),
      col("day", D, "день"),
      col("started_clock", CLK, "перша точка"),
      col("last_point_clock", CLK, "остання точка"),
      col("points", I, "кількість точок"),
      col("distance_km", N, "пробіг за треком"),
    ],
    sql: `
      SELECT t."userId" AS user_id, u.name, ${KYIV_DAY("t.day")} AS day,
             ${CLOCK('t."startedAt"')} AS started_clock, ${CLOCK('t."lastPointAt"')} AS last_point_clock,
             t."pointsCount" AS points, t."distanceKm" AS distance_km
      FROM "TrackSession" t
      JOIN "User" u ON u.id = t."userId"`,
  },
  {
    name: "visits",
    purpose: "відмітки візитів до клієнтів у застосунку: був / пропустив, чи забрав гроші",
    columns: [
      col("visit_id", ID, "ідентифікатор"),
      col("user_id", ID, "хто відмітив"),
      col("name", T, "імʼя"),
      col("day", D, "день"),
      col("client_id", ID, "клієнт"),
      col("client", T, "назва клієнта"),
      col("status", T, "DONE / MISSED"),
      col("money", T, "FULL / PARTIAL / NONE / NOT_APPLICABLE"),
      col("collected", N, "забрано грошей, грн"),
      col("comment", T, "коментар"),
      col("marked_clock", CLK, "час відмітки"),
      col("lat", N, "широта"),
      col("lng", N, "довгота"),
    ],
    sql: `
      SELECT v.id AS visit_id, v."userId" AS user_id, u.name, ${KYIV_DAY("v.day")} AS day,
             v."counterpartyId" AS client_id, c.name AS client, v.status::text AS status,
             v.money::text AS money, v."collectedAmount" AS collected, LEFT(v.comment, 200) AS comment,
             ${CLOCK('v."markedAt"')} AS marked_clock, v.lat, v.lng
      FROM "Visit" v
      JOIN "User" u ON u.id = v."userId"
      JOIN "Counterparty" c ON c.id = v."counterpartyId"`,
  },
  {
    name: "route_sheets",
    purpose: "маршрутні листи водіїв з 1С: день, водій, авто, суми, кількість точок",
    columns: [
      col("sheet_id", ID, "ідентифікатор"),
      col("number", T, "номер листа"),
      col("day", D, "день"),
      col("driver_id", ID, "водій на сайті (NULL — не зіставлено)"),
      col("driver", T, "імʼя водія"),
      col("driver_1c", T, "водій як записано в 1С"),
      col("vehicle", T, "авто"),
      col("distance_km", N, "кілометраж із 1С (часто 0)"),
      col("orders_total", N, "сума замовлень у листі"),
      col("debts_total", N, "сума боргів до збору"),
      col("posted", B, "проведено в 1С"),
      col("stops", I, "точок у листі (без прихованих)"),
    ],
    sql: `
      SELECT rs.id AS sheet_id, rs.number, ${KYIV_DAY("rs.date")} AS day,
             rs."driverId" AS driver_id, u.name AS driver, rs."driverName1C" AS driver_1c,
             rs.vehicle, rs."distanceKm" AS distance_km, rs."ordersTotal" AS orders_total,
             rs."debtsTotal" AS debts_total, rs.posted,
             (SELECT COUNT(*) FROM "RouteSheetStop" st WHERE st."routeSheetId" = rs.id AND NOT st.hidden)::int AS stops
      FROM "RouteSheet" rs
      LEFT JOIN "User" u ON u.id = rs."driverId"`,
  },
  {
    name: "route_sheet_stops",
    purpose: "точки маршрутних листів 1С: клієнт, накладна, сума, борг",
    columns: [
      col("stop_id", ID, "ідентифікатор"),
      col("sheet_id", ID, "маршрутний лист"),
      col("sheet_number", T, "номер листа"),
      col("day", D, "день листа"),
      col("driver_id", ID, "водій"),
      col("driver", T, "імʼя водія"),
      col("sequence", I, "порядок у листі"),
      col("client_id", ID, "клієнт"),
      col("client", T, "назва клієнта"),
      col("document_id", ID, "накладна, якщо зіставлено"),
      col("doc_number", T, "номер накладної"),
      col("address", T, "адреса з листа"),
      col("amount", N, "сума до доставки"),
      col("debt", N, "борг до збору"),
      col("manual", B, "додано руками на сайті"),
      col("hidden", B, "прихована точка"),
    ],
    sql: `
      SELECT st.id AS stop_id, rs.id AS sheet_id, rs.number AS sheet_number, ${KYIV_DAY("rs.date")} AS day,
             rs."driverId" AS driver_id, u.name AS driver, st.sequence,
             st."counterpartyId" AS client_id, c.name AS client,
             st."salesDocumentId" AS document_id, d.number AS doc_number,
             st.address, st.amount, st."debtAmount" AS debt, st.manual, st.hidden
      FROM "RouteSheetStop" st
      JOIN "RouteSheet" rs ON rs.id = st."routeSheetId"
      LEFT JOIN "User" u ON u.id = rs."driverId"
      LEFT JOIN "Counterparty" c ON c.id = st."counterpartyId"
      LEFT JOIN "SalesDocument" d ON d.id = st."salesDocumentId"`,
  },
  {
    name: "delivery_routes",
    purpose: "маршрути доставки, складені на сайті: статус, водій, км план/факт, пальне",
    columns: [
      col("route_id", ID, "ідентифікатор"),
      col("number", T, "номер"),
      col("day", D, "день"),
      col("status", T, "PLANNED (чернетка) / ASSIGNED / IN_PROGRESS / COMPLETED / CANCELLED"),
      col("driver_id", ID, "водій"),
      col("driver", T, "імʼя водія"),
      col("vehicle", T, "авто"),
      col("planned_km", N, "км за планом"),
      col("actual_km", N, "км фактично"),
      col("fuel_cost", N, "пальне, грн"),
      col("stops", I, "точок"),
      col("assigned_at", TS, "коли передано водію"),
      col("notes", T, "примітка"),
    ],
    sql: `
      SELECT r.id AS route_id, r.number, ${KYIV_DAY("r.date")} AS day, r.status::text AS status,
             r."driverId" AS driver_id, u.name AS driver, r."vehicleInfo" AS vehicle,
             r."totalDistanceKm" AS planned_km, r."actualKm" AS actual_km, r."totalFuelCost" AS fuel_cost,
             (SELECT COUNT(*) FROM "DeliveryStop" ds WHERE ds."deliveryRouteId" = r.id)::int AS stops,
             r."assignedAt" AS assigned_at, LEFT(r.notes, 200) AS notes
      FROM "DeliveryRoute" r
      LEFT JOIN "User" u ON u.id = r."driverId"`,
  },
  {
    name: "delivery_stops",
    purpose: "точки маршрутів доставки сайту: клієнт, накладна, статус, зона, оплата водієві",
    columns: [
      col("stop_id", ID, "ідентифікатор"),
      col("route_id", ID, "маршрут"),
      col("route_number", T, "номер маршруту"),
      col("day", D, "день маршруту"),
      col("driver_id", ID, "водій"),
      col("driver", T, "імʼя водія"),
      col("sequence", I, "порядок"),
      col("kind", T, "DELIVERY / PICKUP / ERRAND"),
      col("status", T, "PENDING / LOADED / DELIVERED / FAILED"),
      col("client_id", ID, "клієнт"),
      col("client", T, "назва клієнта"),
      col("document_id", ID, "накладна"),
      col("doc_number", T, "номер накладної"),
      col("title", T, "назва точки (для доручень)"),
      col("address", T, "адреса"),
      col("zone", T, "CITY / OBLAST, якщо задано вручну"),
      col("distance_km", N, "км до точки"),
      col("delivery_cost", N, "вартість доставки"),
      col("pay_override", N, "оплата водієві, якщо задано вручну"),
      col("delivered_at", TS, "коли доставлено"),
      col("notes", T, "примітка"),
    ],
    sql: `
      SELECT ds.id AS stop_id, r.id AS route_id, r.number AS route_number, ${KYIV_DAY("r.date")} AS day,
             r."driverId" AS driver_id, u.name AS driver, ds.sequence, ds.kind::text AS kind,
             ds.status::text AS status, ds."counterpartyId" AS client_id, c.name AS client,
             ds."salesDocumentId" AS document_id, d.number AS doc_number, ds.title, ds.address,
             ds."zoneOverride"::text AS zone, ds."distanceKm" AS distance_km,
             ds."deliveryCost" AS delivery_cost, ds."payOverride" AS pay_override,
             ds."deliveredAt" AS delivered_at, LEFT(ds.notes, 200) AS notes
      FROM "DeliveryStop" ds
      JOIN "DeliveryRoute" r ON r.id = ds."deliveryRouteId"
      LEFT JOIN "User" u ON u.id = r."driverId"
      LEFT JOIN "Counterparty" c ON c.id = ds."counterpartyId"
      LEFT JOIN "SalesDocument" d ON d.id = ds."salesDocumentId"`,
  },
  {
    name: "cash_handovers",
    purpose: "здача каси водіями: скільки здав, скільки очікувалось, чи підтвердив офіс",
    columns: [
      col("handover_id", ID, "ідентифікатор"),
      col("driver_id", ID, "водій"),
      col("driver", T, "імʼя водія"),
      col("day", D, "день"),
      col("amount", N, "здано, грн"),
      col("expected", N, "очікувалось за маршрутом"),
      col("confirmed_amount", N, "скільки підтвердив офіс"),
      col("handed_at", TS, "коли здав"),
      col("confirmed_at", TS, "коли підтверджено"),
      col("confirmed_by_id", ID, "хто підтвердив"),
      col("confirmed_by", T, "імʼя"),
      col("status", T, "підтверджено / очікує"),
      col("comment", T, "коментар"),
    ],
    sql: `
      SELECT h.id AS handover_id, h."driverId" AS driver_id, u.name AS driver, ${KYIV_DAY("h.day")} AS day,
             h.amount, h."expectedAmount" AS expected, h."confirmedAmount" AS confirmed_amount,
             h."handedAt" AS handed_at, h."confirmedAt" AS confirmed_at,
             h."confirmedById" AS confirmed_by_id, cu.name AS confirmed_by,
             CASE WHEN h."confirmedAt" IS NULL THEN 'очікує' ELSE 'підтверджено' END AS status,
             LEFT(h.comment, 200) AS comment
      FROM "CashHandover" h
      JOIN "User" u ON u.id = h."driverId"
      LEFT JOIN "User" cu ON cu.id = h."confirmedById"`,
  },
  {
    name: "driver_bonuses",
    purpose: "бонусні поїздки й доплати водіям без накладної",
    columns: [
      col("bonus_id", ID, "ідентифікатор"),
      col("driver_id", ID, "водій"),
      col("driver", T, "імʼя водія"),
      col("day", D, "день"),
      col("amount", N, "сума, грн"),
      col("reason", T, "за що"),
      col("created_by", T, "хто нарахував"),
    ],
    sql: `
      SELECT b.id AS bonus_id, b."driverId" AS driver_id, u.name AS driver, ${KYIV_DAY("b.date")} AS day,
             b.amount, LEFT(b.reason, 200) AS reason, cu.name AS created_by
      FROM "DriverBonus" b
      JOIN "User" u ON u.id = b."driverId"
      LEFT JOIN "User" cu ON cu.id = b."createdById"`,
  },
  {
    name: "pick_marks",
    purpose: "відмітки збірки накладних на складі: хто, що, скільки, коли (у проді поки порожньо)",
    columns: [
      col("mark_id", ID, "ідентифікатор"),
      col("document_id", ID, "накладна"),
      col("doc_number", T, "номер накладної"),
      col("client_id", ID, "клієнт"),
      col("client", T, "назва клієнта"),
      col("product_id", ID, "товар"),
      col("sku", T, "артикул"),
      col("product", T, "назва товару"),
      col("quantity", N, "відмічено штук"),
      col("user_id", ID, "хто відмітив рядок останнім"),
      col("picker", T, "імʼя складовщика"),
      col("day", D, "день відмітки"),
      col("clock", CLK, "час відмітки"),
      col("marked_at", TS, "мітка часу"),
    ],
    sql: `
      SELECT m.id AS mark_id, m."salesDocumentId" AS document_id, d.number AS doc_number,
             d."counterpartyId" AS client_id, c.name AS client,
             m."productId" AS product_id, p.sku, p.name AS product, m.quantity,
             m."userId" AS user_id, u.name AS picker,
             ${KYIV_DAY('m."updatedAt"')} AS day, ${CLOCK('m."updatedAt"')} AS clock,
             m."updatedAt" AS marked_at
      FROM "PickMark" m
      JOIN "SalesDocument" d ON d.id = m."salesDocumentId"
      LEFT JOIN "Counterparty" c ON c.id = d."counterpartyId"
      JOIN "Product" p ON p.id = m."productId"
      JOIN "User" u ON u.id = m."userId"`,
  },
  {
    name: "warehouse_reports",
    purpose: "фото накладних зі складу й що з них розпізнано",
    columns: [
      col("report_id", ID, "ідентифікатор"),
      col("user_id", ID, "складовщик"),
      col("worker", T, "імʼя"),
      col("shift_id", ID, "складська зміна"),
      col("status", T, "PENDING / PROCESSING / DONE / FAILED"),
      col("doc_type", T, "тип документа на фото"),
      col("doc_number", T, "номер документа на фото"),
      col("doc_day", D, "дата документа на фото"),
      col("counterparty", T, "контрагент як прочитано"),
      col("client_id", ID, "зіставлений клієнт"),
      col("total", N, "сума на фото"),
      col("items", I, "позицій на фото"),
      col("attempts", I, "спроб розпізнати"),
      col("day", D, "день фото"),
      col("clock", CLK, "час фото"),
      col("processed_at", TS, "коли розпізнано"),
      col("error", T, "помилка розпізнавання"),
    ],
    sql: `
      SELECT w.id AS report_id, w."userId" AS user_id, u.name AS worker, w."shiftId" AS shift_id,
             w.status::text AS status, w."docType" AS doc_type, w."docNumber" AS doc_number,
             ${KYIV_DAY('w."docDate"')} AS doc_day, w."counterpartyName" AS counterparty,
             w."matchedCounterpartyId" AS client_id, w."totalAmount" AS total, w."itemsCount" AS items,
             w.attempts, ${KYIV_DAY('w."createdAt"')} AS day, ${CLOCK('w."createdAt"')} AS clock,
             w."processedAt" AS processed_at, LEFT(w."errorMessage", 200) AS error
      FROM "WarehouseReport" w
      JOIN "User" u ON u.id = w."userId"`,
  },
  {
    name: "warehouse_shifts",
    purpose: "зміни складовщиків: відкрито / закрито, тривалість, де відкрив",
    columns: [
      col("shift_id", ID, "ідентифікатор"),
      col("user_id", ID, "складовщик"),
      col("worker", T, "імʼя"),
      col("status", T, "OPEN / CLOSED"),
      col("day", D, "день відкриття"),
      col("opened_clock", CLK, "час відкриття"),
      col("closed_day", D, "день закриття"),
      col("closed_clock", CLK, "час закриття"),
      col("duration_min", I, "тривалість, хв"),
      col("open_address", T, "де відкрив"),
      col("close_address", T, "де закрив"),
      col("notes", T, "примітка"),
    ],
    sql: `
      SELECT ws.id AS shift_id, ws."userId" AS user_id, u.name AS worker, ws.status::text AS status,
             ${KYIV_DAY('ws."openedAt"')} AS day, ${CLOCK('ws."openedAt"')} AS opened_clock,
             ${KYIV_DAY('ws."closedAt"')} AS closed_day, ${CLOCK('ws."closedAt"')} AS closed_clock,
             ws."durationMinutes" AS duration_min, ws."openAddress" AS open_address,
             ws."closeAddress" AS close_address, LEFT(ws.notes, 200) AS notes
      FROM "WarehouseShift" ws
      JOIN "User" u ON u.id = ws."userId"`,
  },
  {
    name: "purchase_orders",
    purpose: "надходження від постачальників (прихід) з 1С і сайту: шапка",
    columns: [
      col("purchase_id", ID, "ідентифікатор"),
      col("number", T, "номер"),
      col("status", T, "DRAFT / CONFIRMED / CANCELLED…"),
      col("supplier_id", ID, "постачальник"),
      col("supplier", T, "назва постачальника"),
      col("day", D, "дата документа"),
      col("total", N, "сума, грн"),
      col("currency", T, "валюта закупівлі або NULL"),
      col("rate", N, "курс"),
      col("location", T, "склад надходження"),
      col("from_1c", B, "з 1С"),
      col("lines", I, "позицій"),
      col("notes", T, "примітка"),
    ],
    sql: `
      SELECT po.id AS purchase_id, po.number, po.status::text AS status,
             po."supplierId" AS supplier_id, sup.name AS supplier,
             ${KYIV_DAY('po."createdAt"')} AS day, po."totalAmount" AS total,
             po."currencyCode" AS currency, po."currencyRate" AS rate, sl.name AS location,
             (po."externalId" IS NOT NULL) AS from_1c,
             (SELECT COUNT(*) FROM "PurchaseOrderItem" i WHERE i."purchaseOrderId" = po.id)::int AS lines,
             LEFT(po.notes, 200) AS notes
      FROM "PurchaseOrder" po
      JOIN "Counterparty" sup ON sup.id = po."supplierId"
      LEFT JOIN "StockLocation" sl ON sl.id = po."stockLocationId"`,
  },
  {
    name: "purchase_lines",
    purpose: "рядки надходжень: товар, кількість, закупівельна ціна",
    columns: [
      col("line_id", ID, "ідентифікатор рядка"),
      col("purchase_id", ID, "надходження"),
      col("number", T, "номер надходження"),
      col("status", T, "статус надходження"),
      col("day", D, "дата надходження"),
      col("supplier_id", ID, "постачальник"),
      col("supplier", T, "назва постачальника"),
      col("product_id", ID, "товар"),
      col("sku", T, "артикул"),
      col("product", T, "назва товару"),
      col("brand", T, "бренд"),
      col("quantity", I, "кількість"),
      col("price", N, "закупівельна ціна за одиницю"),
      col("amount", N, "quantity × price"),
      col("line_no", I, "номер рядка"),
    ],
    sql: `
      SELECT i.id AS line_id, po.id AS purchase_id, po.number, po.status::text AS status,
             ${KYIV_DAY('po."createdAt"')} AS day, po."supplierId" AS supplier_id, sup.name AS supplier,
             i."productId" AS product_id, p.sku, p.name AS product, b.name AS brand,
             i.quantity, i."purchasePrice" AS price, (i.quantity * i."purchasePrice") AS amount,
             i."lineNo" AS line_no
      FROM "PurchaseOrderItem" i
      JOIN "PurchaseOrder" po ON po.id = i."purchaseOrderId"
      JOIN "Counterparty" sup ON sup.id = po."supplierId"
      JOIN "Product" p ON p.id = i."productId"
      LEFT JOIN "Brand" b ON b.id = p."brandId"`,
  },
  {
    name: "site_orders",
    purpose: "замовлення покупців із сайту й застосунку (роздріб): статус, сума, доставка",
    columns: [
      col("order_id", ID, "ідентифікатор"),
      col("order_number", I, "номер замовлення на сайті"),
      col("day", D, "дата"),
      col("clock", CLK, "час"),
      col("status", T, "PENDING (нове) / PAID / PACKAGING / IN_TRANSIT / DELIVERED / CANCELLED"),
      col("user_id", ID, "покупець (NULL — гість)"),
      col("customer", T, "імʼя покупця"),
      col("phone", T, "телефон"),
      col("city", T, "місто"),
      col("address", T, "адреса"),
      col("delivery", T, "DELIVERY / PICKUP"),
      col("payment", T, "COD"),
      col("total", N, "сума, грн"),
      col("bolts_used", N, "списано болтів"),
      col("bolts_earned", N, "нараховано болтів"),
      col("rep_id", ID, "торговий, чий QR привів покупця"),
      col("rep", T, "імʼя торгового"),
      col("comment", T, "коментар покупця"),
      col("lines", I, "позицій"),
    ],
    sql: `
      SELECT o.id AS order_id, o."orderNumber" AS order_number,
             ${KYIV_DAY('o."createdAt"')} AS day, ${CLOCK('o."createdAt"')} AS clock,
             o.status::text AS status, o."userId" AS user_id, COALESCE(o."contactName", u.name) AS customer,
             o.phone, o.city, o.address, o."deliveryMethod"::text AS delivery, o."paymentMethod"::text AS payment,
             o."totalAmount" AS total, o."boltsUsed" AS bolts_used, o."boltsEarned" AS bolts_earned,
             o."salesRepId" AS rep_id, r.name AS rep, LEFT(o.comment, 200) AS comment,
             (SELECT COUNT(*) FROM "OrderItem" i WHERE i."orderId" = o.id)::int AS lines
      FROM "Order" o
      LEFT JOIN "User" u ON u.id = o."userId"
      LEFT JOIN "User" r ON r.id = o."salesRepId"`,
  },
  {
    name: "site_order_lines",
    purpose: "рядки замовлень із сайту: товар, кількість, ціна",
    columns: [
      col("line_id", ID, "ідентифікатор рядка"),
      col("order_id", ID, "замовлення"),
      col("order_number", I, "номер замовлення"),
      col("day", D, "дата замовлення"),
      col("status", T, "статус замовлення"),
      col("product_id", ID, "товар"),
      col("sku", T, "артикул"),
      col("product", T, "назва товару"),
      col("brand", T, "бренд"),
      col("quantity", I, "кількість"),
      col("price", N, "ціна за одиницю"),
      col("amount", N, "quantity × price"),
    ],
    sql: `
      SELECT i.id AS line_id, o.id AS order_id, o."orderNumber" AS order_number,
             ${KYIV_DAY('o."createdAt"')} AS day, o.status::text AS status,
             i."productId" AS product_id, p.sku, p.name AS product, b.name AS brand,
             i.quantity, i.price, (i.quantity * i.price) AS amount
      FROM "OrderItem" i
      JOIN "Order" o ON o.id = i."orderId"
      JOIN "Product" p ON p.id = i."productId"
      LEFT JOIN "Brand" b ON b.id = p."brandId"`,
  },
  {
    name: "debt_snapshots",
    purpose: "щоденні зрізи дебіторки по клієнтах — як мінявся борг у часі",
    columns: [
      col("client_id", ID, "клієнт"),
      col("client", T, "назва клієнта"),
      col("day", D, "день зрізу"),
      col("balance", N, "борг разом, грн"),
      col("not_due", N, "строк ще не настав"),
      col("overdue_30", N, "прострочено до 30 днів"),
      col("overdue_60", N, "31–60"),
      col("overdue_90", N, "61–90"),
      col("overdue_90_plus", N, "понад 90"),
    ],
    sql: `
      SELECT d."counterpartyId" AS client_id, c.name AS client, ${KYIV_DAY("d.day")} AS day,
             d.balance, d.current AS not_due, d.overdue30 AS overdue_30, d.overdue60 AS overdue_60,
             d.overdue90 AS overdue_90, d."overdue90Plus" AS overdue_90_plus
      FROM "DebtSnapshot" d
      JOIN "Counterparty" c ON c.id = d."counterpartyId"`,
  },
  {
    name: "sales_plans",
    purpose: "плани торгових: показник, період, ціль, бренд",
    columns: [
      col("plan_id", ID, "ідентифікатор"),
      col("period", T, "DAY / WEEK / MONTH / QUARTER"),
      col("metric", T, "COLLECTED_AMOUNT / REVENUE / PROFIT / SKU_COUNT / CLIENTS_COUNT / CHECKPOINTS / OVERDUE_RATIO"),
      col("period_start", D, "початок періоду"),
      col("rep_id", ID, "торговий (NULL — план фірми)"),
      col("rep", T, "імʼя торгового"),
      col("brand_id", ID, "бренд (NULL — усі)"),
      col("brand", T, "назва бренду"),
      col("target", N, "ціль"),
      col("notes", T, "примітка"),
    ],
    sql: `
      SELECT sp.id AS plan_id, sp.period::text AS period, sp.metric::text AS metric,
             ${KYIV_DAY('sp."periodStart"')} AS period_start,
             sp."repId" AS rep_id, u.name AS rep, sp."brandId" AS brand_id, b.name AS brand,
             sp."targetValue" AS target, LEFT(sp.notes, 200) AS notes
      FROM "SalesPlan" sp
      LEFT JOIN "User" u ON u.id = sp."repId"
      LEFT JOIN "Brand" b ON b.id = sp."brandId"`,
  },
  {
    name: "client_memory",
    purpose: "памʼять про клієнта з помічника торгового: як платить, з ким говорити, що бере",
    columns: [
      col("memory_id", ID, "ідентифікатор"),
      col("client_id", ID, "клієнт"),
      col("client", T, "назва клієнта"),
      col("kind", T, "PAYMENT / RELATIONSHIP / PREFERENCE / LOGISTICS / COMPETITOR / OTHER"),
      col("text", T, "запис (до 300 символів)"),
      col("source", T, "REP (сам торговий) / ASSISTANT"),
      col("author_id", ID, "автор"),
      col("author", T, "імʼя автора"),
      col("day", D, "коли записано"),
    ],
    sql: `
      SELECT m.id AS memory_id, m."counterpartyId" AS client_id, c.name AS client, m.kind::text AS kind,
             LEFT(m.text, 300) AS text, m.source::text AS source, m."authorId" AS author_id, u.name AS author,
             ${KYIV_DAY('m."createdAt"')} AS day
      FROM "ClientMemory" m
      JOIN "Counterparty" c ON c.id = m."counterpartyId"
      LEFT JOIN "User" u ON u.id = m."authorId"
      WHERE m."archivedAt" IS NULL`,
  },
  {
    name: "client_comments",
    purpose: "нотатки й фото торгових на картці клієнта",
    columns: [
      col("comment_id", ID, "ідентифікатор"),
      col("client_id", ID, "клієнт"),
      col("client", T, "назва клієнта"),
      col("author_id", ID, "автор"),
      col("author", T, "імʼя автора"),
      col("text", T, "текст (до 300 символів)"),
      col("has_photo", B, "з фото"),
      col("day", D, "день"),
      col("clock", CLK, "час"),
      col("lat", N, "широта"),
      col("lng", N, "довгота"),
    ],
    sql: `
      SELECT cm.id AS comment_id, cm."counterpartyId" AS client_id, c.name AS client,
             cm."authorId" AS author_id, u.name AS author, LEFT(cm.text, 300) AS text,
             (cm."photoUrl" IS NOT NULL) AS has_photo,
             ${KYIV_DAY('cm."createdAt"')} AS day, ${CLOCK('cm."createdAt"')} AS clock, cm.lat, cm.lng
      FROM "ClientComment" cm
      JOIN "Counterparty" c ON c.id = cm."counterpartyId"
      JOIN "User" u ON u.id = cm."authorId"`,
  },
];

export const VIEW_BY_NAME = new Map(VIEWS.map((v) => [v.name, v]));
