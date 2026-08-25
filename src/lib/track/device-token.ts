/**
 * Токени пристроїв для нативного застосунку трекінгу.
 *
 * Веб-планшет ходить під cookie NextAuth, і поки браузер відкритий, це
 * працює. Фоновій службі Android cookie не годиться: вона мовчки шле
 * координати тижнями, а протухлу сесію нікому помітити — трек просто
 * зникає з дня, коли ніхто не дивився на екран.
 *
 * Тому пристрій отримує окремий довгий токен. У базі тільки SHA-256:
 * дамп таблиці не дає можливості заливати чужі координати.
 */

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

/** Хто возить планшет. Решті ролей трек ні до чого. */
export const TRACK_ROLES = ["DRIVER", "SALES", "ADMIN", "MANAGER"];

/**
 * Префікс, щоб токен упізнавався з першого погляду в логах і в
 * налаштуваннях застосунку — і щоб випадково не сплутати його з чимось
 * іншим при розборі інциденту.
 */
const PREFIX = "bdvk_";

/** 32 байти — стільки ж, скільки в типовому session id, вистачає з запасом. */
const TOKEN_BYTES = 32;

/**
 * Область дії токенів цього контуру.
 *
 * Та сама таблиця обслуговує ще й застосунок покупця (src/lib/shop/app-token.ts):
 * процедура відкликання, lastUsedAt і зберігання лише хеша написані один раз,
 * і адмін гасить загублений пристрій в одному місці. Але перевіряти область
 * мусить кожна сторона явно — інакше токен покупця ходив би в /api/track/points
 * і /api/shift/*, тобто заливав би чужі координати й закривав чужі зміни.
 */
export const TRACK_SCOPE = "track";

/**
 * SHA-256, а не bcrypt: токен — це 256 біт випадковості, а не пароль
 * людини. Перебирати нічого, зате перевірка йде на кожній пачці точок,
 * і bcrypt тут коштував би сотні мілісекунд на порожньому місці.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Видає новий токен пристрою. Повертає відкритий токен — це єдиний
 * момент, коли він існує поза пристроєм; у базу лягає тільки хеш.
 */
export async function issueDeviceToken(
  userId: string,
  deviceName?: string | null
): Promise<string> {
  const token = PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
  await prisma.deviceToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      deviceName: deviceName ?? null,
      scope: TRACK_SCOPE,
    },
  });
  return token;
}

export type DeviceIdentity = { userId: string; role: string; tokenId: string };

/**
 * Перевіряє заголовок Authorization: Bearer <token>.
 *
 * Повертає null на будь-якій проблемі — виклик має відповісти 401 і не
 * пояснювати, що саме не так: різні відповіді на «немає токена» і
 * «токен відкликано» дали б підказку тому, хто підбирає.
 */
export async function verifyDeviceToken(
  authHeader: string | null
): Promise<DeviceIdentity | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const row = await prisma.deviceToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      revokedAt: true,
      scope: true,
      user: { select: { id: true, role: true } },
    },
  });

  if (!row || row.revokedAt) return null;
  /**
   * Область — перша перевірка, і саме до ролі.
   *
   * Роль сама по собі не рятує: ADMIN і MANAGER є в обох списках, тож
   * адмін, який увійшов у застосунок покупця, отримав би токеном право
   * писати трек. Область цю двозначність знімає.
   */
  if (row.scope !== TRACK_SCOPE) return null;
  if (!TRACK_ROLES.includes(row.user.role)) return null;

  /**
   * lastUsedAt оновлюємо без await: це поле для ока адміна («планшет
   * мовчить третій день»), і чекати на зайвий UPDATE перед прийомом
   * координат немає сенсу. Помилку гасимо — впасти через необов'язкове
   * поле було б гірше, ніж не оновити його.
   */
  void prisma.deviceToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { userId: row.user.id, role: row.user.role, tokenId: row.id };
}
