import { randomBytes } from "crypto";
import { prisma } from "./prisma";

/**
 * Код торгового в QR-лінку каталогу (/r/[code]).
 *
 * Алфавіт без I, L, O, 0, 1: код друкують на візитці й диктують по
 * телефону, а сплутані символи означають клієнта, який пішов не туди.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/** Назва куки з кодом торгового, що привів клієнта. */
export const REF_COOKIE = "budvik_ref";

/** 90 днів: клієнт може дивитись каталог не один тиждень, поки дозріє до замовлення. */
export const REF_COOKIE_MAX_AGE = 90 * 24 * 60 * 60;

function randomCode(): string {
  // rejection sampling: 256 не ділиться на 31 націло, і взяття остачі
  // від усього байта зробило б перші символи алфавіту частішими
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

/**
 * Повертає код торгового, створюючи його при першому зверненні.
 *
 * Ліниво, а не міграцією для всіх SALES: код потрібен рівно тим, хто
 * відкрив QR, і одразу видимий у кабінеті.
 */
export async function ensureRefCode(userId: string): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { refCode: true },
  });
  if (existing?.refCode) return existing.refCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      await prisma.user.update({ where: { id: userId }, data: { refCode: code } });
      return code;
    } catch (e) {
      // P2002 — код уже зайнятий іншим торговим; пробуємо наступний
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  throw new Error("Не вдалося згенерувати унікальний код торгового");
}

/**
 * Торговий за кодом з QR, або null. Перевіряє роль: код, власник якого
 * більше не SALES, не має нікого ні до кого прив'язувати.
 */
export async function findSalesRepByRefCode(code: string | undefined | null) {
  const normalized = code?.trim().toUpperCase();
  if (!normalized) return null;

  const rep = await prisma.user.findUnique({
    where: { refCode: normalized },
    select: { id: true, name: true, role: true },
  });
  return rep?.role === "SALES" ? rep : null;
}
