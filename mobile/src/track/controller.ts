/**
 * Вмикання і вимикання фонового запису.
 *
 * Два режими, і різниця між ними — не в економії батареї, а в тому, що саме
 * пишеться. SHIFT — робочий маршрут: точний приймач, фікс раз на 20 секунд,
 * картка служби на екрані. AFTER_SHIFT — рідкий дозапис після закриття зміни:
 * він потрібен, щоб дорога додому не обривалася на порозі складу, але це вже
 * не робота, тож і точність нижча, і фікс раз на три хвилини.
 */

import * as Location from "expo-location";
import { staffApi, setUnauthorizedHandler } from "@/api/staff";
import { TRACK_TASK } from "./task-name";
import { clearPoints } from "./db";
import { flush, heartbeat } from "./uploader";
import { getMode, getRole, resetState, setLastError, setMode, setRole } from "./state";
import { currentPermissions } from "./permissions";

export type TrackMode = "SHIFT" | "AFTER_SHIFT";

const OPTIONS: Record<TrackMode, Location.LocationTaskOptions> = {
  SHIFT: {
    accuracy: Location.Accuracy.High,
    timeInterval: 20_000,
    distanceInterval: 0,
    /**
     * Служба переднього плану обов'язкова: без неї Android присипляє процес за
     * кілька хвилин після згасання екрана, і трек уривається саме тоді, коли
     * людина їде. Картка заразом чесно каже, що запис триває.
     */
    foregroundService: {
      notificationTitle: "Будвік27 — зміна відкрита",
      notificationBody: "Маршрут пишеться, поки не закриєте зміну",
      notificationColor: "#FFD600",
      killServiceOnDestroy: false,
    },
  },
  AFTER_SHIFT: {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 180_000,
    distanceInterval: 0,
    foregroundService: {
      notificationTitle: "Будвік27 — зміна закрита",
      notificationBody: "Дописуємо дорогу додому",
      notificationColor: "#6B7280",
      killServiceOnDestroy: false,
    },
  },
};

export async function isTracking(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(TRACK_TASK).catch(() => false);
}

export async function startTracking(mode: TrackMode): Promise<boolean> {
  const perms = await currentPermissions();
  if (!perms.foreground) {
    await setLastError("Немає дозволу на геолокацію");
    return false;
  }

  /**
   * Зміна режиму — це зупинка й запуск наново.
   *
   * startLocationUpdatesAsync поверх уже запущеного завдання нові параметри не
   * підхоплює: служба лишилася б у попередньому режимі, і після закриття зміни
   * планшет далі писав би трек із точністю робочого дня.
   */
  if (await isTracking()) {
    const current = await getMode();
    if (current === mode) return true;
    await Location.stopLocationUpdatesAsync(TRACK_TASK).catch(() => {});
  }

  await setMode(mode);
  try {
    await Location.startLocationUpdatesAsync(TRACK_TASK, OPTIONS[mode]);
    await setLastError(null);
    return true;
  } catch (e) {
    await setMode(null);
    await setLastError(e instanceof Error ? e.message : String(e));
    return false;
  }
}

export async function stopTracking(): Promise<void> {
  await setMode(null);
  if (await isTracking()) {
    await Location.stopLocationUpdatesAsync(TRACK_TASK).catch(() => {});
  }
}

/**
 * Вихід із акаунта.
 *
 * Порядок важливий: спершу дописати те, що встигли, і аж потім гасити токен —
 * інакше день, який лежав у буфері, не доїде вже ніколи. Токен гасимо на
 * сервері, а не лише в пам'яті телефона: планшет, який передали іншій людині,
 * не має лишатися з правом лити трек.
 */
export async function logoutAndStop(): Promise<void> {
  await stopTracking();
  await flush().catch(() => {});
  await staffApi.logout().catch(() => {});
  await clearPoints().catch(() => {});
  await resetState();
}

/**
 * Відкликаний токен зупиняє службу.
 *
 * Без цього планшет із погашеним токеном довбав би сервер до кінця дня, а
 * людина бачила б картку «маршрут пишеться», хоч нічого не пишеться. Саме так
 * вимикається старий трекер, коли людина входить у нову збірку.
 */
setUnauthorizedHandler(async () => {
  await stopTracking();
  await resetState();
});

/**
 * Звести локальний стан із серверним після холодного старту.
 *
 * Планшет міг бути вимкнений, коли офіс закрив зміну, а водій — просто
 * перезавантажити пристрій. Джерело правди тут сервер, і застосунок питає його
 * першим, а не малює своє.
 */
export async function syncTrackingWithServer(role: string | null): Promise<void> {
  if (role) await setRole(role);

  const pulse = await heartbeat(true);
  const shouldTrack = pulse?.shouldTrack ?? false;

  if (shouldTrack) {
    await startTracking("SHIFT");
    return;
  }

  /**
   * Водій зміну не відкриває взагалі — його трек іде від входу.
   *
   * Механіка змін написана під торгових (фото одометра, каса), і якби трек
   * чекав на зміну, у водія він не стартував би ніколи. Ця вада вже була в
   * Kotlin-трекері й лікувалася там саме роллю.
   */
  const effectiveRole = role ?? (await getRole());
  if (effectiveRole === "DRIVER") {
    await startTracking("SHIFT");
    return;
  }

  await stopTracking();
}

/**
 * Що робить застосунок одразу після входу працівника.
 *
 * Роль зберігається локально, бо фонове завдання не має ні сесії, ні мережі, а
 * знати, кого воно обслуговує, мусить: водій пише трек від входу, торговий —
 * лише поки відкрита зміна.
 *
 * Чому водієві трек стартує від входу, а не від зміни: механіка змін написана
 * під торгових (фото одометра, каса), і водій зміну не відкриває взагалі. Якби
 * трек чекав на неї, у водія він не стартував би ніколи — саме ця вада вже була
 * в Kotlin-трекері й лікувалася там так само, роллю.
 */
export async function onStaffLogin(role: string | null): Promise<void> {
  await setRole(role);
  const { registerWatchdog } = await import("./watchdog");
  await registerWatchdog().catch(() => {});

  if (role === "DRIVER") {
    const perms = await currentPermissions();
    // Дозволів ще немає — не сваримося: їх попросить екран зміни, коли
    // людина туди зайде. Мовчазний провал тут краще за діалог одразу після входу.
    if (perms.foreground) await startTracking("SHIFT");
    return;
  }

  // Торговий: якщо зміна вже відкрита (перевстановив застосунок серед дня) —
  // трек має продовжитися сам, а не чекати, поки він це помітить.
  await syncTrackingWithServer(role);
}
