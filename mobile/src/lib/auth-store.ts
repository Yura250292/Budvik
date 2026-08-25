/**
 * Токен застосунку: де лежить і хто його відмикає.
 *
 * Токен — це повний доступ до акаунта, тож він лежить у SecureStore (Keychain
 * на iOS, Keystore на Android), а не в звичайному сховищі.
 *
 * Біометрія тут — замок на цей запис, а не окремий фактор на сервері. Сервер
 * про Face ID нічого не знає і знати не повинен: відбитки не залишають
 * пристрою, і в анкеті App Privacy їх декларувати не треба.
 */

import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";

const TOKEN_KEY = "budvik_token";
const BIOMETRIC_KEY = "budvik_biometric";

/**
 * Копія в памʼяті — обовʼязкова, а не оптимізація.
 *
 * Без неї кожен запит до API читав би Keychain, а із увімкненою біометрією —
 * ще й питав би Face ID. Людина отримувала б запит на відбиток на кожну
 * прокрутку каталогу.
 */
let cached: string | null = null;
let loaded = false;

export async function isBiometricEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BIOMETRIC_KEY)) === "1";
}

/** Чи є на пристрої налаштована біометрія — пропонувати її інакше нема сенсу. */
export async function isBiometricAvailable(): Promise<boolean> {
  const [hardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hardware && enrolled;
}

export async function setToken(token: string, biometric = false): Promise<void> {
  cached = token;
  loaded = true;
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    requireAuthentication: biometric,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await SecureStore.setItemAsync(BIOMETRIC_KEY, biometric ? "1" : "0");
}

export async function getToken(): Promise<string | null> {
  if (loaded) return cached;

  try {
    cached = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    /**
     * Запис із requireAuthentication стає нечитабельним, коли на пристрої
     * змінили набір біометрії — додали новий відбиток, скинули Face ID. Це не
     * помилка, а «увійдіть заново»: інакше застосунок показував би незрозумілий
     * збій людині, яка просто налаштувала телефон.
     */
    cached = null;
  }
  loaded = true;
  return cached;
}

export async function clearToken(): Promise<void> {
  cached = null;
  loaded = true;
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
}

/**
 * Увімкнути або вимкнути вхід за біометрією.
 *
 * Перезаписує токен, бо requireAuthentication задається на момент запису —
 * змінити його в наявного запису неможливо.
 */
export async function setBiometric(enabled: boolean): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;

  if (enabled) {
    const ok = await LocalAuthentication.authenticateAsync({
      promptMessage: "Підтвердьте, щоб увімкнути швидкий вхід",
      cancelLabel: "Скасувати",
    });
    if (!ok.success) return false;
  }

  await setToken(token, enabled);
  return true;
}

/**
 * Розблокувати застосунок на холодному старті.
 *
 * Повертає true, якщо доступ є: або біометрія вимкнена, або її пройдено.
 * Провал ніколи не пускає далі тихо — падаємо на екран входу з паролем.
 */
export async function unlock(): Promise<boolean> {
  if (!(await isBiometricEnabled())) return true;

  const ok = await LocalAuthentication.authenticateAsync({
    promptMessage: "Вхід у Будвік27",
    cancelLabel: "Увійти паролем",
  });
  if (!ok.success) return false;

  return (await getToken()) !== null;
}
