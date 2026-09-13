/**
 * Перенесення query-параметрів у редіректах зі старих адрес логістики.
 *
 * Старі сторінки розійшлися закладками разом із параметрами (?day=, ?routeId=,
 * ?from=&to=): редірект без них відкривав би правильний розділ, але не той
 * день і не той маршрут.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

/** `keys` — які параметри переносити; без нього переносяться всі. */
export function forwardQuery(path: string, sp: SearchParams, keys?: string[]): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (keys && !keys.includes(key)) continue;
    if (typeof value === "string" && value !== "") q.set(key, value);
  }
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}
