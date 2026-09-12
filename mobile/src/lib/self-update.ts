/**
 * Самооновлення робочої збірки.
 *
 * Два різні механізми, і плутати їх не можна:
 *
 * • EAS Update — зміни в JS. Приїжджають самі, застосовуються на наступному
 *   холодному старті. Саме ними доїжджають щотижневі правки кабінету, і саме
 *   тому робочу збірку взагалі можна вести нативно, не роздаючи APK щоразу.
 *
 * • Новий APK — коли додався нативний модуль, дозвіл або оновився SDK. Такі
 *   зміни «повітрям» не приїжджають у принципі: runtimeVersion не збігається,
 *   і оновлення просто не застосовується.
 *
 * У Play робоча збірка не публікується (фонова геолокація), тож перевірка
 * версії — єдиний спосіб для людини в полі дізнатися, що вийшла нова.
 */

import * as Updates from "expo-updates";
/**
 * Свідомо legacy-API файлової системи, а не новий File/Paths.
 *
 * Новий не має `getContentUriAsync`, а без нього встановлювач Android не
 * прочитає завантажений файл: передати йому file:// від чужого застосунку
 * не можна, і встановлення падає з «пошкодженим пакетом». Поки заміни немає,
 * цей імпорт залишається — не модернізувати без перевірки на пристрої.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Application from "expo-application";
import { Platform } from "react-native";
import { API_BASE } from "@/api/client";
import { staffApi, APP_HEADER } from "@/api/staff";
import { getToken } from "@/lib/auth-store";
import { trackProbeParam } from "@/track/self-probe";
import { getMeta, setMeta } from "@/track/db";
import { getMode } from "@/track/state";

/** Номер збірки, яка реально встановлена (не той, що приїхав з оновленням JS). */
export function installedVersionCode(): number {
  return Number(Application.nativeBuildVersion ?? 0) || 0;
}

export type UpdateStatus = {
  /** Є новіший APK. */
  apkAvailable: boolean;
  /** Встановлена збірка застаріла настільки, що працювати нею не можна. */
  blocking: boolean;
  versionName: string | null;
  sizeBytes: number | null;
};

/**
 * Питає сервер, чи є новіший APK.
 *
 * Мовчить на будь-якій помилці: недоступний сервер не привід лякати людину
 * посеред зміни, а перевірка повториться при наступному запуску.
 */
export async function checkApkUpdate(): Promise<UpdateStatus | null> {
  try {
    /**
     * Проба шару треку їде разом із перевіркою версії.
     *
     * Не тому, що їм по дорозі, а тому, що це ЄДИНИЙ запит, який доходить із
     * планшета, де база треку не відкрилася. Проба сама себе гасить і не
     * кидає — інакше вона забрала б у такого планшета останній живий канал.
     */
    const probe = await trackProbeParam().catch(() => undefined);
    const info = await staffApi.staffVersion(probe);
    const installed = installedVersionCode();
    return {
      apkAvailable: info.versionCode > installed,
      blocking: installed > 0 && installed < info.minVersionCode,
      versionName: info.versionName,
      sizeBytes: info.sizeBytes,
    };
  } catch {
    return null;
  }
}

/**
 * Завантажує APK і віддає його системному встановлювачу.
 *
 * Через FileSystem, а не через посилання в браузері: файл віддається лише за
 * Bearer-токеном, а браузер його не має. Тому качаємо самі й передаємо готовий
 * файл через content:// — Android не приймає file:// від чужого застосунку.
 */
export async function downloadAndInstallApk(
  onProgress?: (fraction: number) => void
): Promise<void> {
  if (Platform.OS !== "android") return;

  const token = await getToken();
  const target = `${FileSystem.cacheDirectory}BudvikStaff.apk`;

  // Старий файл прибираємо: недокачаний залишок Android встановить як
  // «пошкоджений пакет», і людина вирішить, що зламалася збірка.
  await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});

  const resumable = FileSystem.createDownloadResumable(
    `${API_BASE}/api/app/staff/download`,
    target,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "x-budvik-app": APP_HEADER,
      },
    },
    (p) => {
      if (p.totalBytesExpectedToWrite > 0) {
        onProgress?.(p.totalBytesWritten / p.totalBytesExpectedToWrite);
      }
    }
  );

  const result = await resumable.downloadAsync();
  if (!result?.uri) throw new Error("Не вдалося завантажити збірку");

  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  await IntentLauncher.startActivityAsync("android.intent.action.INSTALL_PACKAGE", {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION — без нього встановлювач не прочитає файл
  });
}

/**
 * Перевіряє оновлення JS і застосовує його на наступному запуску.
 *
 * Перезавантажувати застосунок одразу не можна: людина може бути посеред
 * заповнення візиту, і раптовий рестарт стер би незбережене.
 */
export async function checkJsUpdate(): Promise<string | null> {
  if (!Updates.isEnabled) return null;
  try {
    const res = await Updates.checkForUpdateAsync();
    if (!res.isAvailable) return null;
    const fetched = await Updates.fetchUpdateAsync();
    return fetched.isNew ? (fetched.manifest?.id ?? "невідоме") : null;
  } catch {
    return null;
  }
}

/**
 * Ключ у сховищі: яке саме оновлення ми вже пробували застосувати самі.
 *
 * Спільний із `use-auto-update.ts` навмисно. Два лічильники означали б, що
 * планшет, у якого оновлення не піднімається, крутить рестарт по колу: один
 * шлях уже спробував, другий про це не знає.
 */
export const AUTO_RELOAD_TRIED_KEY = "autoReloadTried";

/**
 * Застосувати завантажене оновлення — з ФОНУ, без людини.
 *
 * ЧОМУ ЦЕ ПОТРІБНО ОКРЕМО ВІД ХУКА. `use-auto-update.ts` слухає AppState, тобто
 * працює лише поки живий інтерфейс. А торговий відкриває цей застосунок двічі
 * на день — вранці відкрити зміну й ввечері закрити; решту дня він в іншій
 * програмі, а ми у фоні. Сторож тим часом справно ЗАВАНТАЖУЄ нове JS і ніколи
 * його не застосовує: переходу AppState немає, бо немає екрана. Виправлення
 * лежало в планшеті завантаженим і чекало випадковості — холодного старту,
 * коли Android приб'є процес.
 *
 * ЧОМУ ЛИШЕ ПРИ ЗУПИНЕНОМУ ЗАПИСІ. Перезавантаження піднімає новий контекст
 * JS, і той мусить наново підписатися на локацію — а підписка тягне службу
 * переднього плану, яку Android від 12-ї версії з фону запускати забороняє.
 * Тобто оновлення посеред зміни вбило б саме те, заради чого воно їде. Умова
 * та сама, що й у хука, і саме вона врятувала 04.09.
 */
export async function applyJsUpdateIfIdle(updateId: string | null): Promise<boolean> {
  if (!updateId) return false;
  // Запис іде — чекаємо кінця зміни. Планшет усе одно стоїть у машині ніч.
  if ((await getMode().catch(() => null)) !== null) return false;
  // Одне оновлення — одна спроба: якщо воно не піднімається, expo-updates
  // відкотиться, а прапорець лишиться, і без цієї мітки був би вічний рестарт.
  if ((await getMeta(AUTO_RELOAD_TRIED_KEY).catch(() => null)) === updateId) return false;
  await setMeta(AUTO_RELOAD_TRIED_KEY, updateId).catch(() => {});
  await Updates.reloadAsync().catch(() => {});
  return true;
}
