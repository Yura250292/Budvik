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
  // Симулятор пуші не отримує взагалі — просити там дозвіл безглуздо.
  if (!Device.isDevice) return;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") return;

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
  if (!projectId) return;

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  if (!token || token === registered) return;

  await api.pushRegister(token, Platform.OS === "ios" ? "ios" : "android", Constants.expoConfig?.version);
  registered = token;
}

/** Відписка при виході — щоб чужі замовлення не приходили на цей телефон. */
export async function unregisterPush(): Promise<void> {
  if (!registered) return;
  await api.pushUnregister(registered).catch(() => {});
  registered = null;
}
