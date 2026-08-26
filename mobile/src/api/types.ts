/**
 * Форми відповідей /api/v1.
 *
 * Мусять збігатися з тим, що віддає сайт (src/lib/shop/api.ts і роути під
 * src/app/api/v1). Установлену збірку не можна оновити примусово, тож будь-яка
 * зміна цих типів має лишатися сумісною зі старими застосунками — або їхати
 * під /api/v2.
 */

export type CardDto = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  /** Ціна до показу — уже з урахуванням акції. */
  price: number;
  /** Базова ціна, якщо вона вища за price: її показують закресленою. */
  basePrice: number | null;
  promoLabel: string | null;
  stock: number;
  image: string | null;
  packQty: number | null;
  brand: string | null;
  /** Категорія, якщо осмислена, інакше бренд. Сирої категорії з 1С тут не буває. */
  label: string | null;
};

/** Рядок підказки пошуку. Легший за CardDto: без кратності, бренда й басейну цін. */
export type SuggestRow = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  price: number;
  image: string | null;
  stock: number;
  label: string | null;
};

export type CatalogPage = {
  items: CardDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Точного збігу не було — це результат рятувальної спроби. Так і сказати людині. */
  isFuzzy: boolean;
};

export type ProductDto = CardDto & {
  description: string;
  /**
   * Опис, розібраний на секції тим самим splitDescription, що й на сайті.
   * specs — пари «ключ: значення», kit — рядки комплектації, rest — решта тексту.
   */
  sections: {
    specs: { key: string; value: string }[];
    kit: string[];
    rest: string;
  };
  specs: {
    powerWatts: number | null;
    rpm: number | null;
    discDiameterMm: number | null;
    chuckMm: number | null;
    weightKg: number | null;
  };
  related: CardDto[];
};

export type LookupResult =
  | { match: "qr" | "sku" | "barcode"; product: CardDto }
  | { match: "none"; code: string; fallback: CardDto[] };

/**
 * Куди веде вхід.
 *
 * "shop" — покупець, далі нативні екрани магазину.
 * "track" — працівник; його кабінет живе на сайті, і застосунок відкриває
 * його у WebView за адресою target.
 */
export type LoginScope = "shop" | "track";

export type LoginResult = {
  token: string;
  scope: LoginScope;
  /** Домівка працівника на сайті ("/sales", "/driver", "/admin"). У покупця null. */
  target: string | null;
  user: AppUser;
};

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  boltsBalance: number;
};

export type AppConfig = {
  minSupportedBuild: number;
  latestBuild: number;
  boltsCashbackRate: number;
  boltsMaxUsageRate: number;
  contacts: {
    legalName: string;
    phone: string;
    phoneAlt: string;
    email: string;
    street: string;
    city: string;
  };
  maintenance: string | null;
};
