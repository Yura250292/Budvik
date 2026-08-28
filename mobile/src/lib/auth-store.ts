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
 * Область токена лежить поруч із ним, а не виводиться з ролі на клієнті:
 * рішення про область ухвалює сервер у місці видачі, і застосунок не має
 * права його переоцінювати.
 */
const SCOPE_KEY = "budvik_scope";

/**
 * Копія в памʼяті — обовʼязкова, а не оптимізація.
 *
 * Без неї кожен запит до API читав би Keychain, а із увімкненою біометрією —
 * ще й питав би Face ID. Людина отримувала б запит на відбиток на кожну
 * прокрутку каталогу.
 */
let cached: string | null = null;
let loaded = false;

/**
 * Читання зі сховища ніде не має валити застосунок.
 *
 * SecureStore відмовляє не лише в теорії: у вебі його немає взагалі, а на
 * пристрої Keychain повертає помилку, коли змінили набір біометрії. Виняток
 * звідси піднімається аж у кореневий layout — тобто людина отримує червоний
 * екран замість екрана входу. Тиха відмова тут чесніша: не змогли прочитати
 * означає «немає», а далі спрацює звичайний вхід паролем.
 */
async function readSecure(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  return (await readSecure(BIOMETRIC_KEY)) === "1";
}

/** Чи є на пристрої налаштована біометрія — пропонувати її інакше нема сенсу. */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hardware && enrolled;
  } catch {
    // Модуля немає (веб) або система відмовила — просто не пропонуємо біометрію.
    return false;
  }
}

/**
 * Копія області в памʼяті — дзеркало кеша токена вище.
 *
 * Область питають на кожному холодному старті, і саме на ній стоїть розвилка
 * «вітрина чи кабінет»: доки вона не прочитана, екран порожній. Друге й третє
 * читання Keychain у цьому місці — це затримка рівно там, де людина дивиться на
 * білий екран. На відміну від токена, область пишеться без requireAuthentication,
 * тож її прогрів нічим не загрожує.
 */
let scopeCached: "shop" | "track" | null = null;
let scopeLoaded = false;

export async function getScope(): Promise<"shop" | "track" | null> {
  if (scopeLoaded) return scopeCached;
  const v = await readSecure(SCOPE_KEY);
  scopeCached = v === "shop" || v === "track" ? v : null;
  scopeLoaded = true;
  return scopeCached;
}

export async function setScope(scope: "shop" | "track"): Promise<void> {
  scopeCached = scope;
  scopeLoaded = true;
  await SecureStore.setItemAsync(SCOPE_KEY, scope).catch(() => {});
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
  // Копію області теж на нуль: інакше після виходу застосунок і далі вів би
  // людину в кабінет за областю, якої у сховищі вже немає.
  scopeCached = null;
  scopeLoaded = true;
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(SCOPE_KEY).catch(() => {});
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

  try {
    const ok = await LocalAuthentication.authenticateAsync({
      promptMessage: "Вхід у Будвік27",
      cancelLabel: "Увійти паролем",
    });
    if (!ok.success) return false;
  } catch {
    // Система відмовила в перевірці — не замикаємо людину назовсім.
    return false;
  }

  return (await getToken()) !== null;
}
