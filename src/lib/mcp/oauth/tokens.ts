/**
 * Токени й коди MCP-конектора: як виглядають і скільки живуть.
 *
 * Непрозорі випадкові рядки, а не JWT: сервер один, база під рукою, а
 * відкликання мусить діяти одразу («Відключити» в профілі адміна). JWT
 * жив би до кінця строку навіть після відкликання.
 *
 * У базі — лише SHA-256, як у DeviceToken: дамп таблиці не дає ключів
 * від даних фірми.
 */

import { createHash, randomBytes } from "crypto";

/** Година: коротко, бо відкликання однаково йде родиною, а Claude сам оновлює. */
export const ACCESS_TTL_S = 3600;
/** 30 днів: стільки конектор живе без повторного входу, якщо ним не користуються. */
export const REFRESH_TTL_S = 30 * 86400;
/** 5 хвилин: код потрібен лише на один редирект. */
export const CODE_TTL_S = 300;

export type TokenPrefix = "bmcp_at" | "bmcp_rt" | "bmcp_code";

/** Префікс — щоб токен упізнавався в логах і не плутався з bdvk_ пристроїв. */
export function newToken(prefix: TokenPrefix): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

/** SHA-256, а не bcrypt: це 256 біт випадковості, перебирати нічого. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
