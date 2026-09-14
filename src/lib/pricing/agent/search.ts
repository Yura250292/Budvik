/**
 * Пошуковий API для агента цін.
 *
 * DeepSeek сам шукати в інтернеті не вміє, тож результати пошуку дає окремий
 * сервіс, а модель лише вибирає з них сторінки товару (discover.ts).
 *
 *   SERPER_API_KEY        — serper.dev, результати Google; 2500 запитів
 *                           безкоштовно, далі близько $1 за тисячу;
 *   BRAVE_SEARCH_API_KEY  — Brave Search API, $5 за тисячу з місячним
 *                           кредитом $5.
 *
 * Обидва ключі — перший знайдений. Без жодного пошук нових сторінок
 * пропускається, а пропозиції складаються з уже відомих джерел.
 */

export type SearchResult = { title: string; url: string; snippet: string };

export type SearchProvider = {
  name: "serper" | "brave";
  usdPerQuery: number;
  search: (query: string) => Promise<SearchResult[]>;
};

const TIMEOUT_MS = 20_000;

const stripTags = (s: string | undefined) => (s ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();

/**
 * Прибрати трекінгові параметри з адреси. Google (і Serper за ним) дописує
 * до карток магазинів ?srsltid=… — щоразу новий, тож та сама сторінка мала б
 * нову адресу при кожному пошуку і не зливалася б між двома запитами.
 */
function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(srsltid|utm_[a-z]+|gclid|fbclid)$/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return raw;
  }
}

async function serperSearch(key: string, q: string): Promise<SearchResult[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q, gl: "ua", hl: "uk", num: 10 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { organic?: { title?: string; link?: string; snippet?: string }[] };
  return (body.organic ?? [])
    .filter((r) => typeof r.link === "string")
    .map((r) => ({ title: stripTags(r.title), url: cleanUrl(r.link!), snippet: stripTags(r.snippet) }));
}

async function braveSearch(key: string, q: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q, count: "10" })}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Brave ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  return (body.web?.results ?? [])
    .filter((r) => typeof r.url === "string")
    .map((r) => ({ title: stripTags(r.title), url: cleanUrl(r.url!), snippet: stripTags(r.description) }));
}

export function searchProvider(): SearchProvider | null {
  const serper = process.env.SERPER_API_KEY;
  if (serper) return { name: "serper", usdPerQuery: 0.001, search: (q) => serperSearch(serper, q) };
  const brave = process.env.BRAVE_SEARCH_API_KEY;
  if (brave) return { name: "brave", usdPerQuery: 0.005, search: (q) => braveSearch(brave, q) };
  return null;
}
