/**
 * Періодична перевірка, що трек живий.
 *
 * Служба переднього плану стійка, але не безсмертна: виробничі оболонки її
 * прибивають, а після перезавантаження планшета система не відновлює доставку
 * координат сама. WorkManager же переживає і перезавантаження, і вбивство
 * процесу — тому саме він тут за сторожа.
 *
 * Це не заміна службі, а страховка: він прокидається не частіше ніж раз на 15
 * хвилин (жорстке обмеження Android), тож у найгіршому випадку втрачається
 * чверть години треку, а не день.
 */

import * as BackgroundTask from "expo-background-task";
import { hasOfflineGuard, scheduleOfflineGuard, cancelOfflineGuard } from "@modules/track-guard";
import { WATCHDOG_TASK } from "./task-name";
import { getMode, getRole, isShiftOpen } from "./state";
import { heartbeat, maybeFlush } from "./uploader";
import { flushPendingShift } from "./pending-shift";
import { flushPendingVisits } from "./pending-visits";
import { isTracking, startTracking } from "./controller";
import { ensureFreshFixes } from "./health";

export async function runWatchdog(): Promise<void> {
  /**
   * Відкладена зміна — найперша: поки вона не пройшла, сервер не знає, що
   * людина на маршруті, і трек лягає в день без зміни.
   */
  await flushPendingShift().catch(() => {});
  // Відмітки візитів — теж наперед: із них складається день і каса.
  await flushPendingVisits().catch(() => {});
  // Далі віддати те, що назбиралося: буфер важливіший за все інше.
  await maybeFlush().catch(() => {});
  await heartbeat().catch(() => {});

  // Підписка може бути формально живою, а фіксів не бути — це окремий збій.
  await ensureFreshFixes().catch(() => {});

  const [role, shiftOpen, tracking, mode] = await Promise.all([
    getRole(),
    isShiftOpen(),
    isTracking(),
    getMode(),
  ]);

  // Водій пише трек від входу, торговий — поки відкрита зміна (див. controller.ts).
  const shouldTrack = shiftOpen || role === "DRIVER";
  if (shouldTrack && !tracking) {
    await startTracking("SHIFT");
    return;
  }

  /**
   * Дорога додому теж не має обриватися.
   *
   * Режим «після зміни» вмикає геозона, і якщо систему після цього щось
   * прибило, відновити запис немає кому: геозона вже спрацювала й знята.
   * Тому сторож піднімає і його — інакше поїздка після роботи обірвалася б на
   * першому ж прибитті процесу, і саме та відповідь, заради якої все це
   * робиться, загубилася б.
   */
  if (!shouldTrack && mode === "AFTER_SHIFT" && !tracking) {
    await startTracking("AFTER_SHIFT");
  }
}

export async function registerWatchdog(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync().catch(() => null);
  if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;

  await BackgroundTask.registerTaskAsync(WATCHDOG_TASK, {
    // 15 хвилин — мінімум, який дозволяє Android; менше просто ігнорується.
    minimumInterval: 15,
  }).catch(() => {});

  /**
   * Другий будильник — без вимоги мережі.
   *
   * Реєстрація вище ставить роботу з обмеженням `NetworkType.CONNECTED`, яке
   * expo-background-task зашиває намертво. Тобто в селі без зв'язку вона не
   * спрацьовує — саме там, де служба треку й гине. Власний нативний модуль
   * ставить те саме завдання ще раз, але без жодних обмежень.
   *
   * Два запуски замість одного нешкідливі: тіло завдання ідемпотентне.
   */
  scheduleOfflineGuard(15);
}

export async function unregisterWatchdog(): Promise<void> {
  await BackgroundTask.unregisterTaskAsync(WATCHDOG_TASK).catch(() => {});
  cancelOfflineGuard();
}

/** Чи є в цій збірці сторож, що працює без мережі. */
export { hasOfflineGuard };
