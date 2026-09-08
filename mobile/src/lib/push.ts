/**
 * Реєстрація пристрою для сповіщень.
 *
 * Покупцеві — про його замовлення, торговому — про рух у табло команди.
 * Контур перевірки різний (див. prefix у api-клієнті), а токен Expo і
 * таблиця спільні: телефон один, і два записи на нього означали б два
 * однакові сповіщення.
 *
 * Дозвіл питаємо не при першому запуску, а після входу: людина, у якої ще
 * немає жодного замовлення, не розуміє, про що їй хочуть сповіщати, і тисне
 * «Заборонити». На iOS повторно запитати вже не можна — доводиться відправляти
 * в системні налаштування, звідки повертаються одиниці.
 */

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { api } from "@/api/client";
import { IS_STAFF_BUILD } from "@/lib/flavor";

/** Сповіщення показуються й тоді, коли застосунок відкритий. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registered: string | null = null;

/**
 * Питає дозвіл і віддає токен серверу. Тихо нічого не робить, якщо дозволу
 * немає — це нормальний вибір людини, а не помилка.
 */
export async function registerForPush(): Promise<void> {
  try {
    await register();
  } catch (e) {
    await note(`помилка: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Чому реєстрація не вийшла — у журнал пристрою.
 *
 * Мовчазна вада найдорожча, і ця виявилася саме такою: 08.09 у базі не було
 * ЖОДНОГО push-токена — ні в торгових, ні у водіїв, ні в покупців, за весь
 * час. Тобто пуші не працювали ніколи, і дізнатися про це не міг ніхто:
 * `registerForPush` виходив тихо на кожному з чотирьох приводів, а всі три
 * виклики ще й загорнуті в `.catch(() => {})`.
 *
 * Та сама природа, що й у мікрофона того ж дня: одна тиша на кілька різних
 * станів. Тепер кожен привід називає себе, і рядок їде в журнал, який уже
 * доставляється разом із пульсом.
 *
 * Лише робоча збірка: у покупця журналу треку немає, та й діагностувати там
 * нічого — відмова від сповіщень для нього нормальний вибір.
 */
async function note(reason: string): Promise<void> {
  if (!IS_STAFF_BUILD) return;
  try {
    const { logEvent } = await import("@/track/db");
    await logEvent("push", reason.slice(0, 180));
  } catch {
    // Журнал — не робота: його відсутність не має ламати реєстрацію.
  }
}

async function register(): Promise<void> {
  // Симулятор пуші не отримує взагалі — просити там дозвіл безглуздо.
  if (!Device.isDevice) {
    await note("не пристрій (симулятор)");
    return;
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") {
    await note(`дозвіл на сповіщення: ${status}`);
    return;
  }

  if (Platform.OS === "android") {
    // Без каналу Android показує сповіщення без звуку й без важливості.
    await Notifications.setNotificationChannelAsync("orders", {
      name: IS_STAFF_BUILD ? "Робота" : "Замовлення",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  /**
   * projectId обовʼязковий: без нього Expo не знає, чиєму застосунку належить
   * токен, і видача мовчки падає саме в збірці, а не в розробці.
   */
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    await note("немає projectId — токен видати нічим");
    return;
  }

  /**
   * Найімовірніше місце мовчазного провалу.
   *
   * `getExpoPushTokenAsync` кидає, коли в проєкті EAS не заведені креденшели
   * FCM: сам виклик виглядає звичайним, а виняток гине у зовнішньому catch
   * виклику. Тому причину ловимо тут і називаємо окремо від решти.
   */
  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (e) {
    await note(`Expo не видав токен: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (!token) {
    await note("Expo повернув порожній токен");
    return;
  }
  if (token === registered) return;

  await api.pushRegister(token, Platform.OS === "ios" ? "ios" : "android", Constants.expoConfig?.version);
  registered = token;
  await note("токен зареєстровано");
}

/** Відписка при виході — щоб чужі замовлення не приходили на цей телефон. */
export async function unregisterPush(): Promise<void> {
  if (!registered) return;
  await api.pushUnregister(registered).catch(() => {});
  registered = null;
}
