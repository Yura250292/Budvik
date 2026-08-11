/**
 * Курси валют для віджета дашборду.
 *
 * Джерела свідомо різні за призначенням:
 *  - НБУ — офіційний курс, за яким рахують документи й переоцінку;
 *  - ПриватБанк і Монобанк — готівковий/картковий купівля-продаж, тобто
 *    те, що люди насправді бачать у житті й шукають на «Мінфіні».
 *
 * Сам API «Мінфіну» не використовується: публічний ендпоінт віддає 403
 * без комерційного ключа. Приват і Моно — це ті самі котирування, які
 * «Мінфін» агрегує, тільки з першоджерела й без ключа.
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

export type CurrencyRate = {
  code: Code;
  /** Офіційний курс НБУ, ₴ за одиницю. */
  official: number | null;
  /** Готівковий/картковий курс банків: купівля і продаж. */
  buy: number | null;
  sell: number | null;
  /** Зміна офіційного курсу до попереднього робочого дня, ₴. */
  delta: number | null;
};

export type CurrencyResponse = {
  rates: CurrencyRate[];
  /** Дата офіційного курсу НБУ (ISO). */
  officialDate: string | null;
  updatedAt: string;
  /** Які джерела реально відповіли — щоб віджет чесно підписав дані. */
  sources: { nbu: boolean; privat: boolean; mono: boolean };
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

  const [nbu, privat, mono] = await Promise.all([
    fetchJson<NbuRow[]>("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json"),
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

    // Приват — пріоритетне джерело готівки; Моно підстраховує, якщо Приват мовчить.
    const p = privat?.find((r) => r.ccy === code && r.base_ccy === "UAH");
    const m = mono?.find((r) => MONO_CODE[r.currencyCodeA] === code && r.currencyCodeB === UAH);

    // rateCross свідомо не беремо: це одне розрахункове число, і показане
    // як «купівля / продаж» воно давало б однакові значення в обох колонках,
    // тобто спред, якого насправді не існує (так виходило з PLN у Моно).
    const buy = p ? Number(p.buy) : (m?.rateBuy ?? null);
    const sell = p ? Number(p.sale) : (m?.rateSell ?? null);

    return {
      code,
      official,
      buy: Number.isFinite(buy) ? (buy as number) : null,
      sell: Number.isFinite(sell) ? (sell as number) : null,
      delta: official != null && prev != null ? Number((official - prev).toFixed(4)) : null,
    };
  });

  const body: CurrencyResponse = {
    rates,
    officialDate,
    updatedAt: new Date().toISOString(),
    sources: { nbu: !!nbu, privat: !!privat, mono: !!mono },
  };

  return NextResponse.json(body);
}
