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
const AUTO_NEXT_KEY = "budvik.autoNext";

/**
 * Скільки наступних точок заряджаємо в навігатор за раз.
 *
 * Одна — це «веди мене туди»; три-пʼять — погляд на найближчу годину:
 * видно, в який бік день і чи не доведеться вертатися. Десять — увесь
 * ранок одним посиланням, і це стеля не наша, а Google: api=1 приймає
 * девʼять проміжних точок плюс призначення.
 *
 * Одинадцяту він відкидає МОВЧКИ — саме тому список тут скінченний, а не
 * поле для будь-якого числа.
 */
export type NavBatch = 1 | 3 | 5 | 10;
export const NAV_BATCHES: NavBatch[] = [1, 3, 5, 10];

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
    return NAV_BATCHES.includes(raw as NavBatch) ? (raw as NavBatch) : 1;
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

/**
 * Чи вести до наступної точки одразу після відмітки.
 *
 * Увімкнено за замовчуванням, і саме це знімає ліміт Google на девʼять
 * проміжних точок: наступну пачку підставляє застосунок, водієві не треба
 * повертатися сюди й тиснути «Їхати». Порожнє сховище й будь-яка помилка
 * читання означають «увімкнено» — єдине значення для «ні» це рядок «0».
 */
export async function getAutoNext(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(AUTO_NEXT_KEY)) !== "0";
  } catch {
    return true;
  }
}

export async function setAutoNext(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(AUTO_NEXT_KEY, on ? "1" : "0");
  } catch {
    // Не збереглося — вибір діє до кінця сеансу, і цього досить.
  }
}
