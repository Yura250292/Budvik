/**
 * Спільні правила логіна й пароля.
 *
 * Раніше ці три константи жили копіями в api/register, api/admin/sales-reps
 * і api/admin/sales-reps/[id]/credentials. Копії — це не дрібниця: якщо
 * підняти мінімальну довжину в одному місці, решта тихо лишиться слабшою.
 */

/** Той самий cost, що й у публічній реєстрації (api/register/route.ts). */
export const BCRYPT_COST = 10;

/** Коротший пароль не варто заводити навіть тимчасово. */
export const MIN_PASSWORD_LENGTH = 6;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Технічна пошта seed-скрипта (rep-*@budvik.local). На неї нічого не
 * надсилається, і поки email такий — у людини немає робочого логіна.
 */
export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith("@budvik.local");
}
