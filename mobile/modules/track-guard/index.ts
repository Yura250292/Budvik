/**
 * Сторож треку без вимоги мережі.
 *
 * Обгортка над власним нативним модулем. Навіщо він узагалі — докладно в
 * android/src/main/java/expo/modules/trackguard/TrackGuardModule.kt; коротко:
 * `expo-background-task` ставить WorkManager-обмеження `NetworkType.CONNECTED`
 * намертво, тож єдиний системний будильник застосунку не спрацьовує в селі без
 * зв'язку — саме там, де служба треку й гине.
 *
 * Модуль лише для Android: робоча збірка існує тільки там. На інших
 * платформах виклики нічого не роблять і не падають — щоб код, який ними
 * користується, не мусив знати про платформу.
 */

import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

type TrackGuardModule = {
  scheduleOfflineGuard(intervalMinutes: number): boolean;
  cancelOfflineGuard(): boolean;
};

/**
 * requireOptional, а не require: у середовищі без нативної частини (Expo Go,
 * веб, тести) відсутність модуля не має валити застосунок — вона лише означає,
 * що офлайн-сторожа немає, і лишається мережевий.
 */
const native = requireOptionalNativeModule<TrackGuardModule>("TrackGuard");

/** Чи є нативна частина в цій збірці. */
export const hasOfflineGuard = Platform.OS === "android" && native !== null;

export function scheduleOfflineGuard(intervalMinutes = 15): boolean {
  if (!hasOfflineGuard) return false;
  try {
    return native!.scheduleOfflineGuard(intervalMinutes);
  } catch {
    return false;
  }
}

export function cancelOfflineGuard(): boolean {
  if (!hasOfflineGuard) return false;
  try {
    return native!.cancelOfflineGuard();
  } catch {
    return false;
  }
}
