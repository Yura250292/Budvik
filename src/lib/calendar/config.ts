/**
 * Налаштування конектора календаря.
 *
 * Немає ключа — немає конектора: воркер пише один рядок попередження на
 * запуск, роути віддають 503, картка в кабінеті не показується. Так код
 * можна викотити на прод ДО того, як щось налаштовано в Google Cloud, і
 * він буде мертвим вантажем, який нічого не ламає. Той самий підхід, що в
 * нарадах (src/lib/meetings/process.ts, meetingsMissingEnv).
 *
 * Модуль без next/* — його збирає воркер.
 */

/**
 * Дозвіл, який просимо в людини.
 *
 * `calendar.app.created` — найвужчий, який узагалі є в Calendar API: доступ
 * ЛИШЕ до календарів, що їх застосунок створив сам. Особистих подій ми не
 * бачимо й зіпсувати не можемо — прав немає. Це рішення й робить конектор
 * безпечним, і тримає коротким текст на екрані згоди.
 *
 * `openid email` — базові дозволи, потрібні рівно для того, щоб показати
 * людині, ЯКИЙ з її акаунтів підключено: у більшості їх кілька, і без
 * пошти картка в кабінеті перетворюється на загадку.
 */
export const CALENDAR_SCOPE = "openid email https://www.googleapis.com/auth/calendar.app.created";

/** Назва календаря, який конектор створює в акаунті людини. */
export const CALENDAR_NAME = "Budvik";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** Кука з nonce — друга половина захисту state (перша це підпис). */
export const NONCE_COOKIE = "budvik_cal_nonce";

/**
 * Адреса, на яку Google поверне людину.
 *
 * Мусить збігатися з тим, що вписано в консолі Google, знак у знак. Беремо
 * її з адреси самого запиту, а НЕ з NEXTAUTH_URL: на проді там стоїть
 * `https://budvik27.com` без www, тоді як людина реально на www (Vercel
 * перекидає туди домен без www), і в консолі Google вписано саме www.
 * Адреса з NEXTAUTH_URL дала б redirect_uri_mismatch. До того ж кука з
 * nonce живе на тому хості, де почалося підключення, — туди й треба
 * повертатися.
 */
export function callbackUrl(req: Request): string {
  return `${new URL(req.url).origin}/api/calendar/google/callback`;
}

/**
 * Куди повернути людину після згоди.
 *
 * Лише шлях усередині сайту: інакше посилання «підключити календар» можна
 * було б підсунути так, щоб воно викинуло людину на чужий сайт.
 */
export function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/admin/profile";
  return raw;
}

/** Чого бракує, щоб конектор працював. Порожньо — усе на місці. */
export function calendarMissingEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.CALENDAR_TOKEN_KEY) missing.push("CALENDAR_TOKEN_KEY");
  if (!process.env.GOOGLE_CALENDAR_CLIENT_ID) missing.push("GOOGLE_CALENDAR_CLIENT_ID");
  if (!process.env.GOOGLE_CALENDAR_CLIENT_SECRET) missing.push("GOOGLE_CALENDAR_CLIENT_SECRET");
  return missing;
}
