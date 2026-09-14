/**
 * Помилки зовнішніх служб нарад — з відповіддю на одне питання: що робити далі.
 *
 * - transient: мережа, тайм-аут, 429, 5xx. Служба лежить, а запис ні в чому не
 *   винен — пробуємо пізніше й спробу не рахуємо.
 * - retry: служба відповіла по суті, але невдало (не скачала файл, обірвала
 *   відповідь). Рахуємо спробу; після третьої — FAILED.
 * - fatal: повтор нічого не змінить (у записі немає мовлення, ключ відкликано,
 *   вичерпано баланс). Одразу FAILED із поясненням людською мовою.
 *
 * Модуль без next/* — його збирає воркер.
 */

export type ProviderErrorKind = "transient" | "retry" | "fatal";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly status?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function classifyHttp(status: number, message: string): ProviderErrorKind {
  // OpenAI віддає 429 і на «забагато запитів», і на «скінчились гроші» —
  // друге чеканням не лікується.
  if (status === 429 && /quota|billing|insufficient|credit/i.test(message)) return "fatal";
  if (status === 408 || status === 409 || status === 429 || status >= 500) return "transient";
  if (status === 401 || status === 403) return "fatal";
  return "retry";
}

export function asProviderError(e: unknown, service: string): ProviderError {
  if (e instanceof ProviderError) return e;
  const name = e instanceof Error ? e.name : "";
  if (name === "AbortError" || name === "TimeoutError") {
    return new ProviderError(`${service}: не відповів вчасно`, "transient");
  }
  // Node кидає TypeError("fetch failed") на розрив з'єднання і DNS.
  if (e instanceof TypeError) return new ProviderError(`${service}: немає зв'язку (${e.message})`, "transient");
  return new ProviderError(`${service}: ${e instanceof Error ? e.message : String(e)}`, "retry");
}
