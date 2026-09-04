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
const BATCH_KEY = "budvik.navBatch";

/**
 * Скільки наступних точок заряджаємо в навігатор за раз.
 *
 * Одна — це «веди мене туди»; три-пʼять — погляд на найближчу годину:
 * видно, в який бік день і чи не доведеться вертатися. Більше не
 * пропонуємо свідомо: посилання Google бере девʼять проміжних точок, але
 * лише коли відкривається в самому Google Maps; у мобільному браузері
 * ліміт падає до трьох, і зайві точки зникають МОВЧКИ.
 */
export type NavBatch = 1 | 3 | 5;
export const NAV_BATCHES: NavBatch[] = [1, 3, 5];

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

export async function getNavBatch(): Promise<NavBatch> {
  try {
    const raw = Number(await AsyncStorage.getItem(BATCH_KEY));
    return raw === 3 || raw === 5 ? raw : 1;
  } catch {
    return 1;
  }
}

export async function setNavBatch(n: NavBatch): Promise<void> {
  try {
    await AsyncStorage.setItem(BATCH_KEY, String(n));
  } catch {
    // Не збереглося — вибір діє до кінця сеансу, і цього досить.
  }
}
