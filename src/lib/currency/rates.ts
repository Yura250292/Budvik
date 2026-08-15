/**
 * Курси валют: спільне джерело для віджета дашборду і звітів.
 *
 * Лежить у lib, а не в роуті, щоб серверний код звітів міг викликати
 * getCurrencyRates() напряму — без HTTP-запиту до власного API і без
 * сесії адміна, яку вимагає роут віджета.
 *
 * Джерела за призначенням:
 *  - НБУ — офіційний курс, за яким рахують документи й переоцінку;
 *  - валютний аукціон «Мінфіну» по Львову — головне джерело готівки:
 *    реальні заявки міняйл міста, а не середнє по банках країни;
 *  - сторінка «Мінфіну», Приват і Моно — резерв, якщо аукціон мовчить.
 *
 * API аукціону (va-rates.treeumapp.net) знайдено в runtimeConfig
 * Next.js-сторінки minfin.com.ua/ua/currency/auction/ — офіційного
 * публічного API «Мінфін» не має (платний, 403 без ключа).
 */

/** Валюти, які показуємо. Решту з відповідей джерел відкидаємо. */
export const CODES = ["USD", "EUR", "PLN"] as const;
export type Code = (typeof CODES)[number];

/**
 * Внутрішній курс «Будвік»: купівля + фіксована націнка.
 * База — купівля, бо власний курс привʼязується до того, за скільки
 * реально купується валюта. До цього поля надалі привʼязується
 * ціноутворення (перерахунок валютних прайсів у гривню).
 */
export const BUDVIK_MARKUP_UAH = 0.5;

/** Львів у довіднику міст аукціону «Мінфіну» (query cache сторінки). */
const AUCTION_CITY_LVIV = 3;

export type CurrencyRate = {
  code: Code;
  /** Офіційний курс НБУ, ₴ за одиницю. */
  official: number | null;
  /** Готівковий курс (аукціон Львів або резервні джерела): купівля і продаж. */
  buy: number | null;
  sell: number | null;
  /** Внутрішній курс «Будвік»: купівля + BUDVIK_MARKUP_UAH. */
  budvik: number | null;
  /** Зміна офіційного курсу до попереднього робочого дня, ₴. */
  delta: number | null;
};

export type CurrencyResponse = {
  rates: CurrencyRate[];
  /** Дата офіційного курсу НБУ (ISO). */
  officialDate: string | null;
  updatedAt: string;
  /** Які джерела реально відповіли — щоб віджет чесно підписав дані. */
  sources: { nbu: boolean; auction: boolean; minfin: boolean; privat: boolean; mono: boolean };
};

/** Числові коди ISO 4217 для відповіді Монобанку. */
const MONO_CODE: Record<number, Code> = { 840: "USD", 978: "EUR", 985: "PLN" };
const UAH = 980;

const TIMEOUT_MS = 6000;

const BROWSER_HEADERS = {
  // Без браузерного User-Agent «Мінфін» може відповісти захисною заглушкою.
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

/**
 * Зовнішнє джерело не має права покласти віджет: будь-яка помилка або
 * таймаут перетворюється на null, і віджет просто покаже менше даних.
 */
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json", ...BROWSER_HEADERS },
      // Кеш на боці Next: курс не змінюється частіше ніж раз на кілька хвилин.
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type NbuRow = { cc: string; rate: number; exchangedate: string };
type PrivatRow = { ccy: string; base_ccy: string; buy: string; sale: string };
type MonoRow = { currencyCodeA: number; currencyCodeB: number; rateBuy?: number; rateSell?: number; rateCross?: number };

type CashRates = Partial<Record<Code, { buy: number | null; sell: number | null }>>;

/** Погодинна точка агрегованих заявок аукціону. */
type AuctionPoint = { date: string; buy: number | null; sell: number | null };

/**
 * Валютний аукціон «Мінфіну», відфільтрований по Львову: медіана живих
 * заявок купівлі/продажу міста. Береться остання година, де є хоч одне
 * число — вночі та у вихідні заявок може не бути.
 */
async function fetchAuction(): Promise<CashRates | null> {
  const query = CODES.map((c) => `currency=${c.toLowerCase()}`).join("&");
  const data = await fetchJson<{ items?: Record<string, AuctionPoint[]> }>(
    `https://va-rates.treeumapp.net/api/v1/rates?city=${AUCTION_CITY_LVIV}&${query}`
  );
  if (!data?.items) return null;

  const out: CashRates = {};
  for (const code of CODES) {
    const series = data.items[code.toLowerCase()];
    const last = series?.findLast((p) => p.buy != null || p.sell != null);
    if (!last) continue;
    out[code] = {
      buy: last.buy != null && Number.isFinite(last.buy) ? Number(last.buy.toFixed(4)) : null,
      sell: last.sell != null && Number.isFinite(last.sell) ? Number(last.sell.toFixed(4)) : null,
    };
  }
  return Object.keys(out).length ? out : null;
}

type MinfinItem = {
  currency: string;
  /** «Курс НБУ» | «Середній курс валюти в банках» | «Середній готівковий курс». */
  name: string;
  /** «Курс купівлі» | «Курс продажу». */
  description: string;
  currentExchangeRate: { price: number | string };
};

/**
 * Резерв: курси зі сторінки «Мінфіну» — JSON-LD ItemList із
 * ExchangeRateSpecification. Пріоритет — «готівковий» (те, що великими
 * цифрами на сторінці); якщо його немає — середній банківський.
 */
async function fetchMinfinPage(): Promise<CashRates | null> {
  try {
    const res = await fetch("https://minfin.com.ua/ua/currency/", {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "text/html", ...BROWSER_HEADERS },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const match = html.match(/"mainEntity":\{"@type":"ItemList","itemListElement":(\[[\s\S]*?\])\}/);
    if (!match) return null;
    const items = JSON.parse(match[1]) as MinfinItem[];

    const out: CashRates = {};
    // Два проходи: банківський курс кладемо першим, готівковий його перекриває.
    for (const kind of ["в банках", "готівковий"]) {
      for (const it of items) {
        const code = CODES.find((c) => c === it.currency);
        if (!code || !it.name.includes(kind)) continue;
        const price = Number(it.currentExchangeRate.price);
        if (!Number.isFinite(price)) continue;
        const row = (out[code] ??= { buy: null, sell: null });
        if (it.description.includes("купівлі")) row.buy = price;
        if (it.description.includes("продажу")) row.sell = price;
      }
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** dd.mm.yyyy від НБУ → ISO yyyy-mm-dd. */
function nbuDateToIso(date: string | undefined): string | null {
  if (!date) return null;
  const [d, m, y] = date.split(".");
  return d && m && y ? `${y}-${m}-${d}` : null;
}

/** Дата попереднього дня у форматі, який чекає statdirectory (yyyymmdd). */
function prevDayParam(iso: string | null): string {
  const base = iso ? new Date(`${iso}T00:00:00Z`) : new Date();
  base.setUTCDate(base.getUTCDate() - 1);
  return base.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function getCurrencyRates(): Promise<CurrencyResponse> {
  const [nbu, auction, minfin, privat, mono] = await Promise.all([
    fetchJson<NbuRow[]>("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json"),
    fetchAuction(),
    fetchMinfinPage(),
    fetchJson<PrivatRow[]>("https://api.privatbank.ua/p24api/pubinfo?json&exchange&coursid=5"),
    fetchJson<MonoRow[]>("https://api.monobank.ua/bank/currency"),
  ]);

  const officialDate = nbuDateToIso(nbu?.find((r) => r.cc === "USD")?.exchangedate);

  // Другим кроком, бо дата попереднього дня береться з першої відповіді.
  const nbuPrev = nbu
    ? await fetchJson<NbuRow[]>(
        `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json&date=${prevDayParam(officialDate)}`
      )
    : null;

  const rates: CurrencyRate[] = CODES.map((code) => {
    const official = nbu?.find((r) => r.cc === code)?.rate ?? null;
    const prev = nbuPrev?.find((r) => r.cc === code)?.rate ?? null;

    // Аукціон Львова — головне джерело готівки; далі за спаданням довіри.
    const au = auction?.[code];
    const mf = minfin?.[code];
    const p = privat?.find((r) => r.ccy === code && r.base_ccy === "UAH");
    const m = mono?.find((r) => MONO_CODE[r.currencyCodeA] === code && r.currencyCodeB === UAH);

    // rateCross свідомо не беремо: це одне розрахункове число, і показане
    // як «купівля / продаж» воно давало б однакові значення в обох колонках,
    // тобто спред, якого насправді не існує (так виходило з PLN у Моно).
    const rawBuy = au?.buy ?? mf?.buy ?? (p ? Number(p.buy) : (m?.rateBuy ?? null));
    const rawSell = au?.sell ?? mf?.sell ?? (p ? Number(p.sale) : (m?.rateSell ?? null));
    const buy = rawBuy != null && Number.isFinite(rawBuy) ? rawBuy : null;
    const sell = rawSell != null && Number.isFinite(rawSell) ? rawSell : null;

    // База — купівля («+50 коп. від покупки валюти»), офіційний — резерв.
    const budvikBase = buy ?? official;

    return {
      code,
      official,
      buy,
      sell,
      budvik: budvikBase != null ? Number((budvikBase + BUDVIK_MARKUP_UAH).toFixed(2)) : null,
      delta: official != null && prev != null ? Number((official - prev).toFixed(4)) : null,
    };
  });

  return {
    rates,
    officialDate,
    updatedAt: new Date().toISOString(),
    sources: { nbu: !!nbu, auction: !!auction, minfin: !!minfin, privat: !!privat, mono: !!mono },
  };
}
