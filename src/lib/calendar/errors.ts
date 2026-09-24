/**
 * Як читати відповідь Google.
 *
 * Головна вимога: тимчасовий збій не повинен перетворюватися на «підключіть
 * календар ще раз». Людина, яку раз на місяць просять перепідключитися через
 * чужий 503, перестає підключатися взагалі.
 *
 * Друга вимога — 404 і 409 це не помилки, а досягнута мета: подію вже
 * видалили (нам того й треба) або вона вже є (сталий id спрацював).
 *
 * Модуль без next/* — його збирає воркер.
 */

export type GoogleVerdict =
  /** Усе добре. */
  | "ok"
  /** Дозвіл відкликано або протух — синк цієї людини стоїть до перепідключення. */
  | "reconnect"
  /** Тимчасове: ліміт, збій, обрив. Беклоф, спроба не рахується. */
  | "retry"
  /** Наш баг або відсутні права: повтори не допоможуть. */
  | "fatal"
  /** Події вже немає — для видалення це успіх. */
  | "gone"
  /** Подія вже є — вставка перетворюється на виправлення. */
  | "exists";

/** Причина відмови з тіла відповіді Google, якщо вона там є. */
function reasonOf(body: string): string {
  try {
    const json = JSON.parse(body) as {
      error?: string | { errors?: Array<{ reason?: string }> };
    };
    if (typeof json.error === "string") return json.error;
    return json.error?.errors?.[0]?.reason ?? "";
  } catch {
    return "";
  }
}

/** Ліміти Google приходять під виглядом 403 — і це єдиний 403, який варто повторювати. */
const RATE_LIMITS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "backendError"]);

export function classifyGoogle(status: number, body: string): GoogleVerdict {
  if (status >= 200 && status < 300) return "ok";

  const reason = reasonOf(body);

  // Відкликаний дозвіл приходить як 400 invalid_grant — саме так Google
  // відповідає, коли людина забрала доступ у себе в акаунті.
  if (reason === "invalid_grant" || status === 401) return "reconnect";
  if (status === 403) return RATE_LIMITS.has(reason) ? "retry" : "fatal";
  if (status === 404) return "gone";
  if (status === 409) return "exists";
  if (status === 429 || status >= 500) return "retry";
  return "fatal";
}
