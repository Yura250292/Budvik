/**
 * Токени застосунку покупця.
 *
 * Та сама таблиця DeviceToken, що й у планшетів торгових, але інша область
 * дії. Спільна таблиця — свідомо: зберігання лише SHA-256, відкликання через
 * revokedAt і lastUsedAt для діагностики вже написані й обжиті, а головне —
 * адмін гасить загублений пристрій в одному місці, а не шукає, у якій із двох
 * таблиць лежить саме цей телефон.
 *
 * Розділяє їх поле scope, і перевіряють його обидві сторони явно
 * (див. verifyDeviceToken). Роль для цього не годиться: ADMIN і MANAGER
 * присутні в обох списках ролей, тож адмін, який відкрив застосунок покупця,
 * отримав би токеном право писати чужий трек.
 */

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/track/device-token";

/** Область дії токенів магазину. Дзеркало TRACK_SCOPE із трекінгового контуру. */
export const SHOP_SCOPE = "shop";

/**
 * Кому взагалі можна видати токен застосунку.
 *
 * Персоналу — ні, і це не формальність: у застосунку покупця немає екранів,
 * де роль ADMIN щось означає, зате токен із такою роллю в базі виглядав би
 * як привілейований, якби колись зʼявився роут, що дивиться на роль, а не на
 * область. Персонал користується сайтом і трекером.
 */
export const SHOP_ROLES = ["CLIENT", "WHOLESALE"];

/**
 * Префікс токена магазину.
 *
 * Інший, ніж bdvk_ у планшетів: у логах і в розборі інциденту одразу видно,
 * з якого контуру прийшов запит, ще до походу в базу.
 */
const PREFIX = "bdvks_";

const TOKEN_BYTES = 32;

export type ShopIdentity = {
  userId: string;
  role: string;
  tokenId: string;
};

/**
 * Видає токен застосунку. Відкритий токен існує поза пристроєм лише в цю мить
 * — у базу лягає тільки хеш.
 *
 * Строку придатності свідомо немає, як і в планшетів. Застосунок магазину —
 * це те, куди заходять раз на кілька тижнів по нову коробку саморізів;
 * протухлий токен означав би повторний вхід рівно тоді, коли людина вже стоїть
 * у кошику. Захист — відкликання: вихід із застосунку, зміна пароля й
 * видалення акаунта гасять токени негайно.
 */
export async function issueShopToken(
  userId: string,
  deviceName?: string | null
): Promise<string> {
  const token = PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
  await prisma.deviceToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      deviceName: deviceName?.slice(0, 100) ?? null,
      scope: SHOP_SCOPE,
    },
  });
  return token;
}

/**
 * Перевіряє заголовок `Authorization: Bearer <token>`.
 *
 * Повертає null на будь-якій проблемі — виклик має відповісти 401 і не
 * пояснювати, що саме не так: різні відповіді на «немає токена» і «токен
 * відкликано» дали б підказку тому, хто підбирає.
 */
export async function verifyShopToken(
  authHeader: string | null
): Promise<ShopIdentity | null> {
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
  if (row.scope !== SHOP_SCOPE) return null;
  if (!SHOP_ROLES.includes(row.user.role)) return null;

  /**
   * lastUsedAt пишемо без await: поле для ока адміна, і зайвий UPDATE перед
   * кожною відповіддю каталогу коштував би дорожче за користь. Помилку
   * гасимо — впасти через необовʼязкове поле гірше, ніж не оновити його.
   */
  void prisma.deviceToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { userId: row.user.id, role: row.user.role, tokenId: row.id };
}

/** Вихід із застосунку на цьому пристрої. */
export async function revokeShopToken(tokenId: string): Promise<void> {
  await prisma.deviceToken.updateMany({
    where: { id: tokenId, scope: SHOP_SCOPE, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Гасить усі застосунки цього покупця.
 *
 * Викликається при зміні пароля й видаленні акаунта: інакше телефон, який
 * забрали разом із сумкою, лишався б у базі живим токеном попри те, що
 * людина вже змінила пароль і вважає себе в безпеці.
 *
 * Трекінгові токени не чіпає — вони в іншій області, і торговий, що змінив
 * собі пароль на сайті, не має через це втратити зміну посеред дня.
 */
export async function revokeAllShopTokens(userId: string): Promise<void> {
  await prisma.deviceToken.updateMany({
    where: { userId, scope: SHOP_SCOPE, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
