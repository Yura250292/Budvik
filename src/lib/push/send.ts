/**
 * Надсилання push-сповіщень у застосунок покупця.
 *
 * Ходимо в Expo Push Service, а не напряму в APNs і FCM: він сам тримає
 * зʼєднання з обома, і нам не треба ні сертифікатів Apple у змінних
 * середовища, ні service-account JSON від Google у коді сайту. Ключі
 * заливаються один раз в EAS і живуть там.
 *
 * Викликається поруч зі створенням рядка Notification — тобто там, де подія
 * і народжується. Окремий воркер чи cron тут були б зайвим контуром: це один
 * вихідний HTTP-запит, такий самий, як уже наявне сповіщення в Telegram.
 */

import { prisma } from "@/lib/prisma";

const EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Expo приймає до 100 повідомлень за раз. */
const CHUNK = 100;

export type PushMessage = {
  title: string;
  body: string;
  /** Куди відкрити застосунок покупця: розбирається як deep link budvik27://... */
  url?: string;
  /**
   * Куди вести в робочій збірці: `screen` із її білого списку маршрутів
   * (див. mobile/src/track/notification-taps.ts) плюс, для кабінету,
   * сторінка в `target`. Адресу зі схемою сюди класти не можна: у двох
   * збірок вони різні, і помилитися легше, ніж перевірити.
   */
  data?: Record<string, string>;
};

/**
 * Шле сповіщення на всі живі пристрої покупця.
 *
 * Нічого не кидає: сповіщення — це не частина транзакції замовлення, і
 * недоступний Expo не має ламати зміну статусу в адмінці.
 */
export async function sendPushToUser(userId: string, message: PushMessage): Promise<void> {
  try {
    const tokens = await prisma.pushToken.findMany({
      where: { userId, revokedAt: null },
      select: { token: true },
    });
    if (tokens.length === 0) return;

    for (let i = 0; i < tokens.length; i += CHUNK) {
      const batch = tokens.slice(i, i + CHUNK).map((t) => ({
        to: t.token,
        title: message.title,
        body: message.body,
        sound: "default",
        data:
          message.url || message.data
            ? { ...(message.url ? { url: message.url } : {}), ...message.data }
            : undefined,
      }));

      const res = await fetch(EXPO_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        console.error("[push] Expo відповів", res.status);
        continue;
      }

      const payload = (await res.json()) as {
        data?: { status: string; details?: { error?: string } }[];
      };

      /**
       * DeviceNotRegistered означає, що застосунок знесли або токен
       * протух. Гасимо рядок, інакше кожне наступне сповіщення знову
       * стукатиме в ту саму мертву адресу — і за рік таблиця перетвориться
       * на кладовище, яке уповільнює кожну розсилку.
       */
      payload.data?.forEach((result, idx) => {
        if (result.details?.error === "DeviceNotRegistered") {
          const dead = batch[idx]?.to;
          if (dead) {
            void prisma.pushToken
              .updateMany({ where: { token: dead }, data: { revokedAt: new Date() } })
              .catch(() => {});
          }
        }
      });
    }
  } catch (e) {
    console.error("[push] не вдалося надіслати:", e);
  }
}
