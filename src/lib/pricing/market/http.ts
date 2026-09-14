/**
 * Читання сторінки чужого сайту — з куками, ручними редиректами й JS-перевіркою.
 *
 * Та сама механіка, що в scripts/vendor-catalog/fetch.mts, і з тих самих причин:
 * частина сайтів водить клієнта без кук по колу редиректів, gradient.ua і
 * revolt-tools.com.ua віддають заглушку з готовою кукою challenge_passed, а
 * dnipro-m.ua роздуває куку переглядів, поки сервер не почне відповідати 400.
 *
 * Без next/*: модуль викликає воркер.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const COOKIE_MAX = 1024;
const MAX_HOPS = 8;

export class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} ${url}`);
  }
}

const jars = new Map<string, Map<string, string>>();

function remember(host: string, res: Response): void {
  const cookies = res.headers.getSetCookie?.() ?? [];
  if (!cookies.length) return;
  const bag = jars.get(host) ?? new Map<string, string>();
  for (const raw of cookies) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value.length > COOKIE_MAX) bag.delete(name);
    else bag.set(name, value);
  }
  jars.set(host, bag);
}

async function request(url: string, timeoutMs: number, hop = 0): Promise<Response> {
  if (hop > MAX_HOPS) throw new Error(`забагато перенаправлень: ${url}`);
  const host = new URL(url).host;
  const bag = jars.get(host);
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      "accept-language": "uk-UA,uk;q=0.9,ru;q=0.8",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...(bag?.size ? { cookie: [...bag].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  remember(host, res);
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (location) return request(new URL(location, url).toString(), timeoutMs, hop + 1);
  }
  return res;
}

export async function fetchPage(url: string, opts: { challenge?: boolean; timeoutMs?: number } = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let res = await request(url, timeoutMs);
  if (!res.ok) throw new HttpError(res.status, url);
  let html = await res.text();
  if (opts.challenge && html.includes("challenge_passed")) {
    const hash = html.match(/defaultHash\s*=\s*"([a-f0-9]{16,})"/i)?.[1];
    if (hash) {
      const host = new URL(url).host;
      const bag = jars.get(host) ?? new Map<string, string>();
      bag.set("challenge_passed", hash);
      jars.set(host, bag);
      res = await request(url, timeoutMs);
      if (!res.ok) throw new HttpError(res.status, url);
      html = await res.text();
    }
  }
  return html;
}
