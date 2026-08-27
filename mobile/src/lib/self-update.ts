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
    const info = await staffApi.staffVersion();
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
export async function checkJsUpdate(): Promise<boolean> {
  if (!Updates.isEnabled) return false;
  try {
    const res = await Updates.checkForUpdateAsync();
    if (!res.isAvailable) return false;
    await Updates.fetchUpdateAsync();
    return true;
  } catch {
    return false;
  }
}
