/**
 * Клієнт стандартного OData-інтерфейсу 1С.
 *
 * ВАЖЛИВО: клієнт виконує ВИКЛЮЧНО GET-запити. Жодного методу для запису тут
 * немає й бути не повинно — це кодова гарантія режиму «тільки читання» на
 * додачу до прав користувача 1С.
 */

import type { Logger } from "../log.js";
import type { OdataConfig } from "../config.js";

interface ODataPage<T> {
  value: T[];
  "odata.nextLink"?: string;
  "@odata.nextLink"?: string;
}

export class ODataClient {
  private readonly authHeader: string;

  constructor(
    private readonly config: OdataConfig,
    private readonly log: Logger
  ) {
    this.authHeader =
      "Basic " + Buffer.from(`${config.username}:${config.password}`).toString("base64");
  }

  /** Один GET із повторами. Мережеві збої на локальному IIS — звична річ. */
  private async get<T>(url: string, attempt = 1): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        // 401/403 — це конфігурація, повторювати марно.
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `1С відхилила запит (${res.status}). Перевірте логін/пароль користувача ` +
              `та його права на читання. ${text.slice(0, 200)}`
          );
        }
        throw new Error(`OData ${res.status}: ${text.slice(0, 300)}`);
      }

      return (await res.json()) as T;
    } catch (e) {
      const isLastAttempt = attempt >= 3;
      const message = e instanceof Error ? e.message : String(e);

      if (isLastAttempt || message.includes("Перевірте логін")) throw e;

      const delayMs = attempt * 2000;
      this.log.warn({ url, attempt, message }, "Запит до 1С не вдався, повтор");
      await new Promise((r) => setTimeout(r, delayMs));
      return this.get<T>(url, attempt + 1);
    } finally {
      // Без цього таймер лишається активним після відповіді: він тримає
      // процес живим до кінця таймауту й обриває наступні запити.
      clearTimeout(timer);
    }
  }

  /**
   * Читає сутність повністю, посторінково.
   *
   * 1С повертає nextLink не завжди; там, де його немає, доводиться гортати
   * через $skip, доки сторінка не прийде неповною.
   */
  async fetchAll<T>(
    entity: string,
    options: { select?: string[]; filter?: string; expand?: string } = {}
  ): Promise<T[]> {
    const params = new URLSearchParams({ $format: "json" });
    if (options.select?.length) params.set("$select", options.select.join(","));
    if (options.filter) params.set("$filter", options.filter);
    if (options.expand) params.set("$expand", options.expand);

    const pageSize = this.config.pageSize;
    const results: T[] = [];
    let skip = 0;

    for (;;) {
      const pageParams = new URLSearchParams(params);
      pageParams.set("$top", String(pageSize));
      pageParams.set("$skip", String(skip));

      const url = `${this.config.baseUrl}/${entity}?${pageParams.toString()}`;
      const page = await this.get<ODataPage<T>>(url);
      const rows = page.value ?? [];

      results.push(...rows);
      this.log.debug({ entity, skip, got: rows.length }, "Сторінка OData прочитана");

      if (rows.length < pageSize) break;
      skip += pageSize;

      // Запобіжник від нескінченного циклу на дивній відповіді 1С.
      if (skip > 5_000_000) {
        this.log.error({ entity }, "Перевищено ліміт сторінок — читання зупинено");
        break;
      }
    }

    return results;
  }

  /**
   * Виклик функції регістра (Balance, SliceLast) — синтаксис відрізняється
   * від звичайних сутностей: параметри йдуть у дужках.
   */
  async fetchFunction<T>(
    entityWithFunction: string,
    functionParams: Record<string, string> = {},
    options: { filter?: string } = {}
  ): Promise<T[]> {
    const params = new URLSearchParams({ $format: "json" });
    if (options.filter) params.set("$filter", options.filter);

    const args = Object.entries(functionParams)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    const suffix = args ? `(${args})` : "()";

    const url = `${this.config.baseUrl}/${entityWithFunction}${suffix}?${params.toString()}`;
    const page = await this.get<ODataPage<T>>(url);
    return page.value ?? [];
  }

  /** Перевірка зв'язку з 1С на старті — падаємо швидко й зрозуміло. */
  async ping(): Promise<void> {
    await this.get<unknown>(`${this.config.baseUrl}/?$format=json`);
  }
}
