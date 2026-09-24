/**
 * Шифрування refresh-токена Google.
 *
 * Це ПЕРШИЙ секрет у проєкті, який доводиться зберігати з можливістю
 * розшифрувати: решта (паролі, токени пристроїв) лягає в базу однобічним
 * хешем, бо звірити хеш достатньо. Тут же токен треба віддати Google
 * назад, тому AES-256-GCM: шифрує й одночасно ловить будь-яку підміну.
 *
 * AAD — це userId. Шифротекст, скопійований у чужий рядок (руками в psql,
 * кривою міграцією, відновленням з бекапу), просто не розшифрується.
 * Коштує нуль, а закриває цілий клас тихих помилок.
 *
 * Втрата ключа катастрофою не є: refresh-токен — це відкликуваний дозвіл,
 * а не унікальні дані. Усім ставиться NEEDS_RECONNECT, люди клацають
 * «Підключити» ще раз.
 *
 * Модуль без next/* — його збирає воркер.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
/** Версія формату рядка — на випадок, якщо колись зміниться алгоритм. */
const FORMAT = "v1";
/** Версія ключа. Ротація: новий ключ, старий у CALENDAR_TOKEN_KEY_PREV. */
const CURRENT_KEY_VERSION = 1;

function keyFor(version: number): Buffer {
  const raw =
    version === CURRENT_KEY_VERSION
      ? process.env.CALENDAR_TOKEN_KEY
      : process.env.CALENDAR_TOKEN_KEY_PREV;
  if (!raw) throw new Error(`CALENDAR_TOKEN_KEY${version === CURRENT_KEY_VERSION ? "" : "_PREV"} не налаштовано`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CALENDAR_TOKEN_KEY має бути 32 байти в base64");
  return key;
}

/** Токен → рядок для бази: v1.<версія ключа>.<iv>.<підпис>.<шифр>. */
export function encryptToken(plain: string, userId: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(CURRENT_KEY_VERSION), iv);
  cipher.setAAD(Buffer.from(userId, "utf8"));
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    FORMAT,
    String(CURRENT_KEY_VERSION),
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    enc.toString("base64url"),
  ].join(".");
}

/** Рядок з бази → токен. Кидає, якщо ключ не той, рядок зіпсовано або userId чужий. */
export function decryptToken(stored: string, userId: string): string {
  const [format, version, iv, tag, payload] = stored.split(".");
  if (format !== FORMAT || !version || !iv || !tag || !payload) {
    throw new Error("невідомий формат збереженого токена");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyFor(Number(version)), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(userId, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8");
}
