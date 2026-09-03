/**
 * Чим водій їде: Google Maps чи Waze.
 *
 * Локально на пристрої, а не в профілі: це звичка конкретної людини за
 * конкретним кермом. Планшет у машині й телефон у кишені цілком можуть
 * мати різну відповідь, і синхронізувати їх немає навіщо.
 *
 * Значення читається один раз при відкритті дня. Помилка сховища не має
 * заважати їхати — тоді просто лишається Google.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NavApp } from "./google-links";

const KEY = "budvik.navApp";

export async function getNavApp(): Promise<NavApp> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    return saved === "waze" ? "waze" : "google";
  } catch {
    return "google";
  }
}

export async function setNavApp(app: NavApp): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, app);
  } catch {
    // Не збереглося — вибір діє до кінця сеансу, і цього досить.
  }
}
