/**
 * Контракт обміну між агентом на сервері 1С і ingest-API Budvik.
 *
 * Єдине джерело правди: агент імпортує ці типи напряму (agent/tsconfig.json
 * містить path-alias на цей файл), тож несумісність контракту ловиться
 * компілятором, а не в проді.
 *
 * Правила, які закладені в самі типи:
 *  - `externalId` (Ref_Key з 1С) присутній завжди й є первинним ключем зіставлення;
 *  - усі інші поля опційні: `undefined` означає «1С не надала значення»,
 *    і таке поле НЕ затирає наявні дані сайту (див. apply-*.ts).
 */

/** Типи сутностей, які вміє приймати ingest. */
export type SyncEntityType =
  | "category"
  | "product"
  | "price"
  | "warehouse"
  | "stock"
  | "counterparty"
  | "sales_doc"
  | "realization_doc"
  | "return_doc"
  | "purchase_doc"
  | "route_sheet"
  | "route_sheet_stop"
  | "debt"
  | "payment";

/**
 * Режим прогону.
 *  - `incremental` — звичайний цикл, лише змінені записи; нічого не деактивує;
 *  - `full` — нічна повна звірка, несе `fullSnapshotIds` для виявлення зниклих;
 *  - `preview` — сухий прогін: рахує розбіжності, але не пише в БД.
 */
export type SyncRunKind = "incremental" | "full" | "preview";

// ========== Записи сутностей ==========

/** Група номенклатури 1С → Category. */
export interface CategoryRecord {
  externalId: string;
  name: string;
  /** externalId батьківської групи; відсутній — корінь дерева. */
  parentExternalId?: string;
  /** Помічена на видалення в 1С. */
  deleted?: boolean;
}

/** Номенклатура 1С → Product (без цін і залишків — вони окремими типами). */
export interface ProductRecord {
  externalId: string;
  name: string;
  /** Артикул 1С → Product.sku. Якщо порожній — SKU згенерується з назви. */
  sku?: string;
  description?: string;
  /** externalId групи 1С — визначає категорію лише для НОВИХ товарів. */
  categoryExternalId?: string;
  /** Одиниця виміру, довідково. */
  unit?: string;
  deleted?: boolean;
}

/** Зріз цін 1С. Ціни, яких 1С не надала, лишаються без змін. */
export interface PriceRecord {
  externalId: string;
  /** Роздрібна ціна → Product.price. */
  retail?: number;
  /** Оптова ціна → Product.wholesalePrice. */
  wholesale?: number;
}

/** Склад 1С → StockLocation. */
export interface WarehouseRecord {
  externalId: string;
  name: string;
  address?: string;
}

/** Залишок по конкретному складу → LocationStock. */
export interface StockRecord {
  /** externalId номенклатури. */
  externalId: string;
  /** externalId складу. */
  warehouseExternalId: string;
  /** Фізичний залишок на складі (регістр ТоварыНаСкладах). */
  quantity: number;
  /**
   * Зарезервовано під замовлення клієнтів (регістр ТоварыВРезервеНаСкладах).
   * Необов'язкове: агенти старіших версій його не надсилають, тоді 0.
   */
  reserved?: number;
  /**
   * Вільний залишок = quantity - reserved, не менше нуля. Саме це число
   * бачить торговий: продавати можна лише те, що ще не обіцяно.
   */
  available?: number;
}

/** Контрагент 1С → Counterparty. */
export interface CounterpartyRecord {
  externalId: string;
  name: string;
  /** Код контрагента в 1С → Counterparty.code. */
  code?: string;
  phone?: string;
  email?: string;
  address?: string;
  /** "SUPPLIER" | "CUSTOMER" | "BOTH" — за замовчуванням BOTH. */
  type?: "SUPPLIER" | "CUSTOMER" | "BOTH";
  deleted?: boolean;
}

/** Рядок табличної частини документа. */
export interface DocumentItemRecord {
  /** externalId номенклатури. */
  productExternalId: string;
  /**
   * Номер рядка в табличній частині 1С — єдине, що задає порядок позицій.
   *
   * Свого ідентифікатора рядок документа в 1С не має, тож і зіставити рядки
   * між прогонами неможливо: табличну частину ми перезаписуємо цілком. А от
   * ПОРЯДОК зберегти можна й треба — торговий звіряє нашу картку з екраном
   * 1С поруч, і переставлені позиції читаються як інші дані.
   *
   * Поля немає (старий агент) — порядок лишається невідомим, і картка
   * сортує такі документи за назвою товару, як доти.
   */
  lineNo?: number;
  /**
   * Кількість ЯК У 1С, тобто завжди додатна — і для повернень теж
   * (перевірено пробою: 200 рядків, жодного від'ємного).
   *
   * Мінус для повернень ставить сервер при прийомі: агент лишається
   * стенограмою 1С, а знак — це вже бізнес-семантика сайту.
   */
  quantity: number;
  price: number;
  /**
   * Собівартість РЯДКА (не за одиницю) з РегистрНакопления.ПродажиСебестоимость.
   *
   * Поле відсутнє, коли собівартості для рядка немає — і це навмисно не 0:
   * «не приїхало» і «продали за собівартістю» дають однаковий нуль, але
   * різну маржу, і плутати їх не можна. Сервер лишає наявне значення, якщо
   * поле не прийшло.
   *
   * Сума на рядок, а не ціна: у пробі 13 шт дали 638,43 — ділити на
   * кількість не можна (див. _costFieldsComment у queries.json).
   */
  cost?: number;
}

/** Документ реалізації / надходження / повернення 1С. */
export interface DocumentRecord {
  externalId: string;
  number: string;
  date: string; // ISO 8601
  counterpartyExternalId?: string;
  totalAmount?: number;
  posted?: boolean;
  /**
   * Позначка видалення в 1С. Приходить лише для замовлень — тільки вони
   * живуть на сайті непроведеними, тож тільки вони й можуть залишитись тут
   * після того, як у 1С чернетку викинули. Поля немає (старий агент) —
   * вважаємо, що документ живий: так само, як з posted.
   */
  deleted?: boolean;
  items?: DocumentItemRecord[];
  /**
   * Торговий, за яким рахується документ, — реквізит «Ответственный» у 1С.
   *
   * Перевірено на базі: там 39 різних значень, і це справжні прізвища
   * торгових, а не кілька офісних менеджерів. Окремого поля «менеджер
   * продажів» чи «торговий представник» у документі немає, тому саме це
   * поле — єдине джерело для KPI «хто скільки продав».
   */
  salesRepName?: string;
  /** externalId користувача 1С — стабільніший за прізвище при перейменуванні. */
  salesRepExternalId?: string;
}

/**
 * Один рядок маршрутного листа — точка вигрузки.
 *
 * Адреса може прийти рядком з документа або не прийти взагалі: тоді сайт
 * бере її з картки контрагента. Точки для оплати рахуються за унікальною
 * адресою, тож три рядки на одну адресу дадуть одну оплачену точку.
 */
export interface RouteSheetStopRecord {
  /** externalId замовлення або реалізації, яку везуть у цю точку. */
  salesDocExternalId?: string;
  counterpartyExternalId?: string;
  address?: string;
  /** Сума замовлення в рядку. */
  amount?: number;
  /** Борг за попередні доставки, який водій забирає в цій точці. */
  debtAmount?: number;
}

/**
 * Точка листа, що приїхала окремим потоком.
 *
 * Документ.МаршрутнийЛист не має власної табличної частини: рядки, які
 * менеджер бачить у формі, — це реалізації з реквізитом МаршрутнийЛист.
 * Агент віддає їх окремим файлом, бо в 1С вони лежать в іншому документі,
 * і кожна несе посилання на свій лист.
 *
 * Порядок точок 1С не зберігає — тільки склад. Послідовність (sequence)
 * проставляє прийом, і саме тому її можна вільно перевпорядковувати на
 * сайті: затирати з 1С нічого.
 */
export interface RouteSheetStopArrival extends RouteSheetStopRecord {
  /** externalId листа, до якого належить точка. */
  routeSheetExternalId: string;
}

/**
 * Маршрутний лист — факт виїзду водія за день; основа його зарплати.
 *
 * `distanceKm` критичний: саме за ним рахується ставка за лист, і лист без
 * пробігу оплатиться за найнижчим тарифом. `ordersTotal` та `debtsTotal` —
 * дві суми з документа, різниця між якими дає базу відсотка.
 *
 * Водій приходить як `driverExternalId` (Ref_Key фізособи в 1С); акаунт на
 * сайті прив'язує адмін вручну, тож лист із невідомим водієм зберігається
 * з driverId = null і чекає прив'язки, а не відкидається.
 */
export interface RouteSheetRecord {
  externalId: string;
  number: string;
  date: string; // ISO 8601
  posted?: boolean;
  driverName?: string;
  driverExternalId?: string;
  vehicle?: string;
  distanceKm?: number;
  ordersTotal?: number;
  debtsTotal?: number;
  stops?: RouteSheetStopRecord[];
}

/**
 * Сальдо взаєморозрахунків по контрагенту.
 *
 * `balance` — загальний борг, він є завжди. Розбивка за строками
 * необов'язкова: 1С віддає її лише зі звіту «Дебіторська заборгованість
 * за строками боргу», і поки агент його не вивантажує, лишається null.
 * Без розбивки видно тільки загальну дебіторку — протерміновану з одного
 * числа не вивести, бо в ньому немає дат.
 */
export interface DebtRecord {
  /** externalId контрагента. */
  externalId: string;
  /** Дебіторська заборгованість; додатне — контрагент винен нам. */
  balance: number;
  /**
   * Розбивка боргу за строками, грн. Ключі — межі в днях прострочення,
   * як їх дає звіт 1С. `current` — борг у межах відстрочки.
   *
   * Сума розбивки має дорівнювати balance; якщо ні — довіряємо balance,
   * а розбіжність потрапляє в журнал розбіжностей.
   */
  aging?: {
    current?: number;
    overdue30?: number;
    overdue60?: number;
    overdue90?: number;
    overdue90plus?: number;
  };
}

/**
 * Оплата від контрагента.
 *
 * Головне джерело для мотивації торгових: комісія рахується від
 * ЗІБРАНИХ грошей, а не від обороту. Без цих даних «скільки реально
 * забрали» порахувати неможливо.
 */
export interface PaymentRecord {
  /** Ref_Key документа оплати в 1С — ключ ідемпотентності */
  externalId: string;
  /** externalId контрагента, який заплатив */
  counterpartyExternalId: string;
  /** Сума оплати */
  amount: number;
  /** Дата надходження грошей, ISO 8601 */
  date: string;
  /** Номер документа оплати */
  number?: string;
  /** "cash" | "bank_transfer" — готівка чи безготівка */
  method?: string;
  /**
   * externalId накладної, яку закриває ця оплата, якщо в 1С є
   * прив'язка. Без неї рознесемо на торгового через закріплення
   * клієнта (SalesRepClient).
   */
  salesDocExternalId?: string;
}

/** Об'єднання всіх записів — дискримінується полем `entityType` батча. */
export type SyncRecord =
  | CategoryRecord
  | ProductRecord
  | PriceRecord
  | WarehouseRecord
  | StockRecord
  | CounterpartyRecord
  | DocumentRecord
  | RouteSheetRecord
  | DebtRecord
  | PaymentRecord;

/** Відповідність entityType → тип запису, для типобезпеки на боці агента. */
export interface SyncRecordMap {
  category: CategoryRecord;
  product: ProductRecord;
  price: PriceRecord;
  warehouse: WarehouseRecord;
  stock: StockRecord;
  counterparty: CounterpartyRecord;
  sales_doc: DocumentRecord;
  realization_doc: DocumentRecord;
  return_doc: DocumentRecord;
  purchase_doc: DocumentRecord;
  route_sheet: RouteSheetRecord;
  route_sheet_stop: RouteSheetStopArrival;
  debt: DebtRecord;
  payment: PaymentRecord;
}

// ========== Запити й відповіді ==========

/** Максимум записів у одному батчі — більший батч ingest відхилить. */
export const MAX_BATCH_RECORDS = 500;

/** Допустиме розходження часу підпису з часом сервера. */
export const SIGNATURE_WINDOW_SECONDS = 300;

/** POST /api/sync-ingest/runs */
export interface StartRunRequest {
  /** uuid, згенерований агентом — ним же ідентифікується прогін далі. */
  runId: string;
  kind: SyncRunKind;
  /** ISO 8601, час старту за годинником агента. */
  startedAt: string;
  /** Версія агента, для діагностики. */
  agentVersion?: string;
}

export interface StartRunResponse {
  runId: string;
  /** id створеного SyncJob. */
  syncJobId: string;
  /** true, якщо прогін із таким runId уже існував (повторна відправка). */
  duplicate: boolean;
}

/** POST /api/sync-ingest/batch */
export interface BatchRequest<T extends SyncEntityType = SyncEntityType> {
  runId: string;
  /** uuid батча — ключ ідемпотентності. */
  batchId: string;
  /** Порядковий номер батча в межах прогону. */
  seq: number;
  entityType: T;
  records: SyncRecordMap[T][];
  /**
   * Лише для `kind: "full"` і лише в ОСТАННЬОМУ батчі даного entityType:
   * повний перелік externalId активних сутностей у 1С. Сервер позначає
   * відсутні як MISSING у SyncDiscrepancy (без автодеактивації).
   */
  fullSnapshotIds?: string[];
}

export interface BatchResponse {
  batchId: string;
  duplicate: boolean;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  discrepancies: number;
  errors: string[];
}

/** POST /api/sync-ingest/runs/[runId]/complete */
export interface CompleteRunRequest {
  status: "completed" | "failed";
  /** Повідомлення про помилку, якщо агент завершив прогін аварійно. */
  error?: string;
  /**
   * Лічильники з manifest.json агента. Опційне: старіші версії агента їх не
   * надсилають, і прогін від цього не має падати.
   *
   * Запити боргу й оплат у 1С — best-effort: якщо котрийсь упав, агент
   * записує сюди причину, але прогін завершується успішно і вотермарк
   * рухається далі. Без сповіщення таке вікно зникає безслідно.
   */
  counts?: Record<string, unknown> & {
    debtFailed?: string;
    paymentsFailed?: string;
  };
}

export interface CompleteRunResponse {
  runId: string;
  syncJobId: string;
  status: string;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
  discrepancies: number;
  /** Скільки сутностей позначено MISSING за результатами повної звірки. */
  missing: number;
}

/** GET /api/sync-ingest/health */
export interface HealthResponse {
  ok: true;
  serverTime: string;
  /** Коли агент востаннє звертався; null — жодного разу. */
  agentLastSeen: string | null;
  lastRun: {
    runId: string;
    type: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
  } | null;
}

/** Тіло помилки, яке ingest повертає на будь-який 4xx/5xx. */
export interface SyncErrorResponse {
  error: string;
}

// ========== Ключі SyncState ==========

export const SYNC_STATE_KEYS = {
  /** ISO-час останнього успішного звернення агента. */
  agentLastSeen: "agent:lastSeen",
  /** ISO-час останньої повної звірки. */
  lastFullRun: "sync:lastFullRun",
  /** ISO-час останнього скидання кешу вітрини — див. throttle у complete. */
  lastCacheBust: "sync:lastCacheBust",
  /** ISO-час останнього сповіщення «агент мовчить» — щоб не слати його щогодини. */
  lastSilentAlert: "agent:lastSilentAlert",
  /**
   * runId прогону, в якому батч цього каналу впав із винятком.
   *
   * Такий батч отримує відповідь 200 із лічильником failed, і прогін
   * закривається як успішний — ззовні збою не видно. Звірки «чого немає в
   * 1С» без цієї позначки прийняли б непроставлені мітки за зникнення й
   * обнулили живі дані.
   */
  batchErrorKey: (entityType: string) => `sync:batchError:${entityType}`,
  /**
   * Дозвіл довідника на конкретний прогін: `{ at, runId }`.
   *
   * Пише диспетчер, коли відкриває вікно каналу (див. SLOW_ENTITIES). Читають
   * звірки: SyncBatch реєструється ДО застосування, тож рядки в ньому є навіть
   * у батча, який тротл пропустив, і єдина достовірна ознака застосування —
   * саме цей запис.
   */
  slowEntityKey: (entityType: string) => `sync:lastEntity:${entityType}`,
} as const;
