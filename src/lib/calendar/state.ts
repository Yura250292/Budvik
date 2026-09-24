/**
 * Підписаний state для рукостискання з Google.
 *
 * Навіщо. Без нього чужа сторінка може відправити людину назад на наш
 * callback зі СВОЇМ кодом авторизації — і до профілю співробітника
 * прив'яжеться чужий Google-акаунт. Підпис доводить, що запит почали ми;
 * nonce, збережений у куці, доводить, що його почав цей самий браузер;
 * строк життя не дає використати перехоплену адресу через тиждень.
 *
 * Свій HMAC, а не бібліотека: у проєкті так само підписується обмін з
 * агентом 1С (src/lib/sync-ingest/auth.ts), і тягнути залежність заради
 * трьох полів немає за що.
 *
 * Модуль без next/* — його збирає воркер.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Десять хвилин — стільки живе незавершене підключення. */
const TTL_MS = 10 * 60_000;

export type CalendarState = {
  userId: string;
  /** Той самий рядок лежить у HttpOnly-куці й звіряється в callback. */
  nonce: string;
  /** Куди повернути людину після згоди. */
  returnTo: string;
};

function secret(): string {
  const value = process.env.CALENDAR_STATE_SECRET || process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("немає CALENDAR_STATE_SECRET (або NEXTAUTH_SECRET)");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signState(state: CalendarState, now: Date = new Date()): string {
  const payload = Buffer.from(
    JSON.stringify({ ...state, exp: now.getTime() + TTL_MS }),
    "utf8"
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Розбирає state. Будь-яка підозра — null, без подробиць назовні. */
export function verifyState(raw: string, now: Date = new Date()): CalendarState | null {
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload), "utf8");
  const got = Buffer.from(signature, "utf8");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CalendarState & { exp: number };
    if (!data.userId || !data.nonce || typeof data.exp !== "number") return null;
    if (data.exp < now.getTime()) return null;
    return { userId: data.userId, nonce: data.nonce, returnTo: data.returnTo || "/" };
  } catch {
    return null;
  }
}
