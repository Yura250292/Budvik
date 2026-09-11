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

/** Що нативна частина знає про будильник — для пульсу й розбору. */
export type ExactGuardStatus = {
  /** Чи є нативна частина взагалі (стара збірка — немає). */
  available: boolean;
  /** Чи дозволено ставити ТОЧНИЙ будильник; false — стоїть приблизний. */
  exact?: boolean;
  /** Коли будильник справді спрацював останній раз, мс. 0 — жодного разу. */
  lastFiredAt?: number;
  /** На коли поставлено наступний, мс. */
  armedFor?: number;
};

/**
 * Що система думає про наш застосунок — її словами, не нашими.
 *
 * Усе інше в пульсі ми звітуємо ПРО СЕБЕ: чи ми вважаємо, що пишемо; чи ми
 * вважаємо, що підписані. Саме тому розбір і впирався в бездоганні прапорці
 * при мертвому треку. Ці два поля — навпаки, відповідь Android.
 */
export type SystemProbe = {
  available: boolean;
  /** ACTIVE | WORKING_SET | FREQUENT | RARE | RESTRICTED — кошик застосунку. */
  standbyBucket?: string;
  /** Власні служби, які система тримає зараз. Зірочка — у передньому плані. */
  services?: string[];
};

type TrackGuardModule = {
  scheduleOfflineGuard(intervalMinutes: number): boolean;
  cancelOfflineGuard(): boolean;
  scheduleExactGuard(intervalMinutes: number): boolean;
  cancelExactGuard(): boolean;
  exactGuardStatus(): ExactGuardStatus;
  systemProbe(): SystemProbe;
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

/**
 * Будильник — другий сторож, поверх WorkManager.
 *
 * Ставиться поруч, а не замість: два незалежні приводи прокинутись кращі за
 * один, і жоден із них не безкоштовно надійний. WorkManager дешевший для
 * батареї, будильник — не залежить від настрою оболонки.
 *
 * `scheduleExactGuard` існує лише у збірках від 1.6.1. У старіших виклик
 * тихо поверне false, і в полі лишиться мережевий сторож — рівно як було.
 */
export function scheduleExactGuard(intervalMinutes = 15): boolean {
  if (!hasOfflineGuard || typeof native?.scheduleExactGuard !== "function") return false;
  try {
    return native.scheduleExactGuard(intervalMinutes);
  } catch {
    return false;
  }
}

export function cancelExactGuard(): boolean {
  if (!hasOfflineGuard || typeof native?.cancelExactGuard !== "function") return false;
  try {
    return native.cancelExactGuard();
  } catch {
    return false;
  }
}

/**
 * Проба системи. У збірці без нативної частини — `available: false`, і це не
 * помилка: старий APK просто не вміє про це спитати.
 */
export function systemProbe(): SystemProbe {
  if (!hasOfflineGuard || typeof native?.systemProbe !== "function") {
    return { available: false };
  }
  try {
    return native.systemProbe();
  } catch {
    return { available: false };
  }
}

export function exactGuardStatus(): ExactGuardStatus {
  if (!hasOfflineGuard || typeof native?.exactGuardStatus !== "function") {
    return { available: false };
  }
  try {
    return native.exactGuardStatus();
  } catch {
    return { available: false };
  }
}
