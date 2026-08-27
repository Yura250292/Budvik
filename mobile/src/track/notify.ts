/**
 * Локальні сповіщення застосунку.
 *
 * Окремий канал від того, яким користується служба треку: якщо людина вимкне
 * настирливу картку «маршрут пишеться», разом із нею не мають зникнути
 * повідомлення про зміну — вони саме те, заради чого сповіщення й потрібні.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const SHIFT_CHANNEL = "shift";

let ensured = false;

async function ensureChannel(): Promise<void> {
  if (ensured || Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(SHIFT_CHANNEL, {
    name: "Зміна",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
  }).catch(() => {});
  ensured = true;
}

/**
 * Показує сповіщення просто зараз.
 *
 * Помилку гасимо: сповіщення — це підказка, а не робота. Якщо дозволу немає
 * або система відмовила, зміна від цього не зіпсується.
 */
export async function notifyNow(title: string, body: string): Promise<void> {
  try {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      content: { title, body, ...(Platform.OS === "android" ? { channelId: SHIFT_CHANNEL } : {}) },
      trigger: null,
    });
  } catch {
    // мовчки
  }
}
