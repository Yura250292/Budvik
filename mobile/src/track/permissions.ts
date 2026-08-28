/**
 * Дозволи, без яких трек не пишеться.
 *
 * Порядок обов'язковий: Android не дає попросити фонову локацію, доки не
 * видано звичайну — запит просто відхиляється без діалогу. А «Дозволяти
 * завжди» на Android 11+ узагалі не показується в діалозі: система відкриває
 * свій екран налаштувань, тож людині треба сказати, що там натиснути.
 */

import { Platform } from "react-native";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as IntentLauncher from "expo-intent-launcher";
import * as Application from "expo-application";
import * as Battery from "expo-battery";

export type PermissionState = {
  foreground: boolean;
  background: boolean;
  notifications: boolean;
};

export async function currentPermissions(): Promise<PermissionState> {
  const [fg, bg, notif] = await Promise.all([
    Location.getForegroundPermissionsAsync().catch(() => null),
    Location.getBackgroundPermissionsAsync().catch(() => null),
    Notifications.getPermissionsAsync().catch(() => null),
  ]);
  return {
    foreground: fg?.granted ?? false,
    background: bg?.granted ?? false,
    notifications: notif?.granted ?? false,
  };
}

export async function requestTrackingPermissions(): Promise<PermissionState> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) {
    return { foreground: false, background: false, notifications: false };
  }

  /**
   * Сповіщення просимо ДО фонової локації.
   *
   * Служба переднього плану без дозволу на сповіщення на Android 13+ працює,
   * але її картку не видно — а саме ця картка й пояснює людині, чому
   * застосунок тримає GPS. Без неї запис виглядає як стеження нишком.
   */
  const notif = await Notifications.requestPermissionsAsync().catch(() => null);
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => null);

  return {
    foreground: true,
    background: bg?.granted ?? false,
    notifications: notif?.granted ?? false,
  };
}

/**
 * Відкриває налаштування батареї САМОГО застосунку.
 *
 * Без цього виробничі оболонки (Xiaomi, Huawei, Samsung, Lenovo) присипляють
 * службу через кілька годин, і трек уривається серед дня — найгірший з
 * можливих варіантів, бо виглядає як «людина припинила працювати».
 *
 * Раніше тут відкривався ЗАГАЛЬНИЙ список оптимізації
 * (IGNORE_BATTERY_OPTIMIZATION_SETTINGS). На планшетах Lenovo у ньому стоїть
 * перемикач, який на вигляд рухається, а насправді нічого не змінює: людина
 * тицяла його щодня, поверталася — і бачила те саме попередження. Перевірено
 * на живому планшеті: прапорець `batteryOptimized` після цього лишався true.
 *
 * Екран самого застосунку надійніший: у ньому пункт «Батарея» → «Без
 * обмежень» — радіокнопка, яка застосовується одразу і на стоковому Android,
 * і на оболонках. Загальний список лишається запасним шляхом, якщо цього
 * екрана на пристрої немає.
 *
 * Повертає стан ПІСЛЯ повернення з налаштувань — щоб застосунок міг сказати,
 * спрацювало чи ні, а не лишати людину гадати.
 */
export async function askIgnoreBatteryOptimizations(): Promise<boolean | null> {
  if (Platform.OS !== "android") return null;

  const pkg = Application.applicationId;
  const opened = pkg
    ? await IntentLauncher.startActivityAsync("android.settings.APPLICATION_DETAILS_SETTINGS", {
        data: `package:${pkg}`,
      })
        .then(() => true)
        .catch(() => false)
    : false;

  if (!opened) {
    await IntentLauncher.startActivityAsync(
      "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS"
    ).catch(() => {});
  }

  // Питаємо систему, а не віримо на слово: полярність та сама, що в Kotlin —
  // true означає «система МОЖЕ приспати застосунок».
  return Battery.isBatteryOptimizationEnabledAsync().catch(() => null);
}
