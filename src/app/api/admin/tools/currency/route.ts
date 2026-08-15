/**
 * Курси валют для віджета дашборду.
 *
 * Джерела свідомо різні за призначенням:
 *  - НБУ — офіційний курс, за яким рахують документи й переоцінку;
 *  - «Мінфін» — середній готівковий купівля-продаж, головне джерело;
 *  - ПриватБанк і Монобанк — підстраховка, якщо «Мінфін» не відповів.
 *
 * API «Мінфіну» платний (публічний ендпоінт віддає 403 без ключа), тому
 * курс береться зі schema.org-розмітки їхньої сторінки /ua/currency/:
 * блок ExchangeRateSpecification — це SEO-дані для Google, вони стабільніші
 * за верстку і містять готівковий, банківський і офіційний курси.
 *
 * Проксі на сервері, а не fetch із браузера: сторонні API не віддають
 * CORS-заголовки, а ще так курс кешується один раз на всіх користувачів.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["ADMIN", "MANAGER", "SALES"];

/** Валюти, які показуємо. Решту з відповіді НБУ відкидаємо. */
const CODES = ["USD", "EUR", "PLN"] as const;
type Code = (typeof CODES)[number];

/**
 * Внутрішній курс «Будвік»: продаж + фіксована націнка.
 * Поки що просто показується у віджеті; надалі до нього можна
 * привʼязати ціноутворення (перерахунок валютних прайсів у гривню).
 */
const BUDVIK_MARKUP_UAH = 0.55;

export type CurrencyRate = {
  code: Code;
  /** Офіційний курс НБУ, ₴ за одиницю. */
  official: number | null;
  /** Готівковий курс («Мінфін», або банки як резерв): купівля і продаж. */
  buy: number | null;
  sell: number | null;
  /** Внутрішній курс «Будвік»: продаж + BUDVIK_MARKUP_UAH. */
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
  sources: { nbu: boolean; minfin: boolean; privat: boolean; mono: boolean };
};

/** Числові коди ISO 4217 для відповіді Монобанку. */
const MONO_CODE: Record<number, Code> = { 840: "USD", 978: "EUR", 985: "PLN" };
const UAH = 980;

const TIMEOUT_MS = 6000;

/**
 * Зовнішнє джерело не має права покласти віджет: будь-яка помилка або
 * таймаут перетворюється на null, і віджет просто покаже менше даних.
 */
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
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

type MinfinItem = {
  currency: string;
  /** «Курс НБУ» | «Середній курс валюти в банках» | «Середній готівковий курс». */
  name: string;
  /** «Курс купівлі» | «Курс продажу». */
  description: string;
  currentExchangeRate: { price: number | string };
};

type MinfinRates = Partial<Record<Code, { buy: number | null; sell: number | null }>>;

/**
 * Курси зі сторінки «Мінфіну»: JSON-LD ItemList із ExchangeRateSpecification.
 * Пріоритет — «готівковий» (те, що великими цифрами на сторінці);
 * якщо для валюти його немає — середній банківський із того ж блоку.
 */
async function fetchMinfin(): Promise<MinfinRates | null> {
  try {
    const res = await fetch("https://minfin.com.ua/ua/currency/", {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Без браузерного User-Agent сторінка може відповісти захисною заглушкою.
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const match = html.match(/"mainEntity":\{"@type":"ItemList","itemListElement":(\[[\s\S]*?\])\}/);
    if (!match) return null;
    const items = JSON.parse(match[1]) as MinfinItem[];

    const out: MinfinRates = {};
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

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const [nbu, minfin, privat, mono] = await Promise.all([
    fetchJson<NbuRow[]>("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json"),
    fetchMinfin(),
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

    // «Мінфін» — головне джерело готівки; Приват і Моно підстраховують.
    const mf = minfin?.[code];
    const p = privat?.find((r) => r.ccy === code && r.base_ccy === "UAH");
    const m = mono?.find((r) => MONO_CODE[r.currencyCodeA] === code && r.currencyCodeB === UAH);

    // rateCross свідомо не беремо: це одне розрахункове число, і показане
    // як «купівля / продаж» воно давало б однакові значення в обох колонках,
    // тобто спред, якого насправді не існує (так виходило з PLN у Моно).
    const rawBuy = mf?.buy ?? (p ? Number(p.buy) : (m?.rateBuy ?? null));
    const rawSell = mf?.sell ?? (p ? Number(p.sale) : (m?.rateSell ?? null));
    const buy = Number.isFinite(rawBuy) ? (rawBuy as number) : null;
    const sell = Number.isFinite(rawSell) ? (rawSell as number) : null;

    // База — продаж (за ним купують валюту під закупівлі), офіційний — резерв.
    const budvikBase = sell ?? official;

    return {
      code,
      official,
      buy,
      sell,
      budvik: budvikBase != null ? Number((budvikBase + BUDVIK_MARKUP_UAH).toFixed(2)) : null,
      delta: official != null && prev != null ? Number((official - prev).toFixed(4)) : null,
    };
  });

  const body: CurrencyResponse = {
    rates,
    officialDate,
    updatedAt: new Date().toISOString(),
    sources: { nbu: !!nbu, minfin: !!minfin, privat: !!privat, mono: !!mono },
  };

  return NextResponse.json(body);
}
