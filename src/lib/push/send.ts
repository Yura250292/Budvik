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
  /**
   * Текст для людини. Необовʼязковий: без нього сповіщення стає ТИХИМ —
   * і саме тихе вміє будити застосунок (див. `silent`).
   */
  title?: string;
  body?: string;
  /** Куди відкрити застосунок покупця: розбирається як deep link budvik27://... */
  url?: string;
  /**
   * Куди вести в робочій збірці: `screen` із її білого списку маршрутів
   * (див. mobile/src/track/notification-taps.ts) плюс, для кабінету,
   * сторінка в `target`. Адресу зі схемою сюди класти не можна: у двох
   * збірок вони різні, і помилитися легше, ніж перевірити.
   */
  data?: Record<string, string>;
  /**
   * Високий пріоритет — щоб сповіщення пробило режим сну.
   *
   * Це не «терміновість для людини», а технічний режим доставки. Звичайне
   * сповіщення система має право притримати до наступного пробудження
   * пристрою — для новини про табло це нормально. Але для сигналу «підніми
   * трек» затримка на годину знищує весь сенс: саме в цю годину маршрут і
   * не пишеться.
   *
   * Друга, важливіша властивість: доставка сповіщення заносить застосунок у
   * ТИМЧАСОВИЙ білий список системи, і лише в цьому вікні Android дозволяє
   * підняти службу переднього плану з фону. Тобто це єдиний спосіб оживити
   * вбитий запис без людини — див. mobile/src/track/wake.ts.
   */
  urgent?: boolean;
  /**
   * Тихе сповіщення: без тексту, без звуку, людина його не бачить.
   *
   * Не косметика, а ЄДИНИЙ спосіб розбудити застосунок. Правило Google
   * (docs/cloud-messaging/android/receive): повідомлення З ТЕКСТОМ Android
   * віддає одразу в шторку, а застосунок при цьому не запускає взагалі —
   * тож фонове завдання не спрацьовує. Будить лише повідомлення БЕЗ тексту,
   * самими даними.
   *
   * Спіймано 08.09 на живому планшеті: Expo двічі віддав квитанцію
   * «доставлено», сповіщення на екрані було, а в журналі пристрою — тиша.
   * Ми надсилали не той тип і перевіряли не те.
   *
   * Тому текст для людини тепер малює САМ застосунок — і лише тоді, коли
   * тихе підняття не вдалося. Якщо вдалося, людину взагалі не турбуємо: вона
   * й не мала знати, що трек падав.
   */
  silent?: boolean;
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
        ...(message.silent
          ? {
              /**
               * Ні тексту, ні звуку — інакше Android перехопить повідомлення
               * у шторку й не розбудить застосунок. `_contentAvailable`
               * потрібен iOS, щоб він теж підняв фонову обробку.
               */
              _contentAvailable: true,
            }
          : { title: message.title, body: message.body, sound: "default" }),
        ...(message.urgent
          ? {
              priority: "high" as const,
              /**
               * Канал той самий, що створює застосунок при реєстрації
               * (mobile/src/lib/push.ts). Без збігу імені Android покаже
               * сповіщення без звуку й найнижчою важливістю — тобто людина
               * його не помітить, а нам потрібне саме пробудження.
               */
              channelId: "orders",
            }
          : {}),
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
