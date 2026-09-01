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
import { bufferedCount, clearPoints, getMeta, setMeta } from "./db";
import { flush, heartbeat } from "./uploader";
import {
  getMode,
  getRole,
  isShiftOpen,
  resetState,
  setLastError,
  setMode,
  setRole,
  setStartError,
} from "./state";
import { currentPermissions } from "./permissions";
import { armAfterShift, disarmAfterShift } from "./after-shift";
import { notifyNow } from "./notify";

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
    await setStartError("Немає дозволу на геолокацію");
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

  /**
   * Нова зміна знімає коло попередньої: інакше воно спрацювало б посеред
   * робочого дня й перевело б запис у розріджений режим.
   */
  if (mode === "SHIFT") await disarmAfterShift();

  await setMode(mode);
  try {
    await Location.startLocationUpdatesAsync(TRACK_TASK, OPTIONS[mode]);
    await setStartError(null);
    return true;
  } catch (e) {
    /**
     * Режим обнуляємо навмисно: служби немає, і `tracking: true` у пульсі був
     * би брехнею. А причину пишемо у ВЛАСНИЙ канал — інакше її затре перша ж
     * скарга буфера, і з сервера це виглядатиме як проблема з мережею.
     */
    await setMode(null);
    await setStartError(e instanceof Error ? e.message : String(e));
    return false;
  }
}

/**
 * «Мусить писати — то пиши»: єдине правило відновлення запису.
 *
 * Живе в одному місці навмисно, бо кличуть його двоє: мережевий сторож
 * (watchdog.ts) і перевірка на передньому плані (health.ts). Дві копії
 * розійшлися б, і тоді відповідь на «чому не пишеться» залежала б від того,
 * хто саме перевіряв.
 *
 * Виклик із переднього плану цінніший, ніж здається: Android не дозволяє
 * піднімати службу переднього плану з фону, тож сторож на заблокованому
 * планшеті може лише спробувати й записати помилку. А коли людина відкрила
 * застосунок — запуск дозволений, і саме тоді запис зобов'язаний ожити сам.
 */
export async function ensureRecording(): Promise<boolean> {
  const [role, shiftOpen, tracking] = await Promise.all([getRole(), isShiftOpen(), isTracking()]);
  if (tracking) return false;
  if (!(shiftOpen || role === "DRIVER")) return false;
  return startTracking("SHIFT");
}

export async function stopTracking(): Promise<void> {
  await setMode(null);
  if (await isTracking()) {
    await Location.stopLocationUpdatesAsync(TRACK_TASK).catch(() => {});
  }
}

/**
 * Зміна закінчилася: перестаємо писати й ставимо коло навколо місця фінішу.
 *
 * Саме коло, а не розріджений запис. Запис «про всяк випадок» до півночі дав би
 * ту саму відповідь про поїздки після роботи, але ціною нічного розряду батареї
 * й кілометрів дрейфу на стоянці, які потім не відрізниш від справжньої дороги.
 * Поки машина стоїть — процес спить; виїхала — геозона нас розбудить.
 */
export async function endShiftTracking(): Promise<void> {
  const last = await Location.getLastKnownPositionAsync().catch(() => null);
  await stopTracking();
  await armAfterShift(
    last ? { lat: last.coords.latitude, lng: last.coords.longitude } : null
  );
}

/** Людина вдома і дописувати нічого — глушимо все, включно з колом. */
export async function stopEverything(): Promise<void> {
  await stopTracking();
  await disarmAfterShift();
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
  await stopEverything();
  // Планшет передають з рук у руки: нагадування, поставлені попередньою
  // людиною, не мають будити наступну.
  const { cancelCloseReminders } = await import("./reminder");
  await cancelCloseReminders();
  /**
   * Відправка через `force`: звичайний виклик тихо повернувся б, якби замок
   * тримала зависла спроба, — і рядок нижче стер би день, якого сервер не
   * бачив. 01.09 такий замок висів у трьох планшетах одночасно, і один
   * випадковий «Вийти» коштував би 361 точки.
   */
  await flush(true).catch(() => {});
  await staffApi.logout().catch(() => {});

  /**
   * Стираємо буфер, ЛИШЕ якщо він справді порожній.
   *
   * Стирання тут не примха: планшет передають з рук у руки, і чужі точки
   * поїхали б у день наступної людини. Але ціна помилки в двох напрямках
   * різна — неправильно приписаний трек видно й можна виправити, а видалений
   * не повертається нізвідки. Тому те, що не доїхало, лишається чекати, а
   * право на нього тримає мітка власника (див. onStaffLogin): увійде та сама
   * людина — день доїде, увійде інша — буфер піде під ніж там.
   */
  const left = await bufferedCount().catch(() => 0);
  if (left === 0) {
    await clearPoints().catch(() => {});
  } else {
    await notifyNow(
      "Маршрут ще не відправлено",
      `${left} точок за сьогодні лишилися в планшеті. Вони поїдуть самі при першому зв'язку — не видаляйте застосунок.`
    );
  }

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
  await stopEverything();
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

  /**
   * Зміни немає — але це ще не привід глушити запис.
   *
   * Якщо ми в режимі «після зміни», людина зараз їде додому (або не додому), і
   * саме цей відрізок і треба дописати. Заглушити його на холодному старті
   * означало б втратити відповідь на питання, заради якого режим існує.
   */
  if ((await getMode()) === "AFTER_SHIFT") return;

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
export async function onStaffLogin(role: string | null, userId?: string | null): Promise<void> {
  await setRole(role);

  /**
   * Чий буфер лежить у планшеті.
   *
   * Вихід більше не стирає невідправлені точки (див. logoutAndStop), тож
   * рішення про чужий день ухвалюється тут — у мить, коли вже видно, ХТО
   * увійшов. Та сама людина забирає свій день; інша застає порожній буфер,
   * як і раніше.
   *
   * Немає мітки — буфер лишили збірки до 1.4.0, і чий він, невідомо. Тоді
   * зберігаємо: помилково приписаний трек видно в звірці з одометром, а
   * видалений не повертається.
   */
  if (userId) {
    const owner = await getMeta("bufferOwner").catch(() => null);
    if (owner && owner !== userId) await clearPoints().catch(() => {});
    await setMeta("bufferOwner", userId).catch(() => {});
  }

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
