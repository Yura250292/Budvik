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
import { WATCHDOG_TASK } from "./task-name";
import { getRole, isShiftOpen } from "./state";
import { heartbeat, maybeFlush } from "./uploader";
import { flushPendingShift } from "./pending-shift";
import { isTracking, startTracking } from "./controller";

export async function runWatchdog(): Promise<void> {
  /**
   * Відкладена зміна — найперша: поки вона не пройшла, сервер не знає, що
   * людина на маршруті, і трек лягає в день без зміни.
   */
  await flushPendingShift().catch(() => {});
  // Далі віддати те, що назбиралося: буфер важливіший за все інше.
  await maybeFlush().catch(() => {});
  await heartbeat().catch(() => {});

  const [role, shiftOpen, tracking] = await Promise.all([
    getRole(),
    isShiftOpen(),
    isTracking(),
  ]);

  // Водій пише трек від входу, торговий — поки відкрита зміна (див. controller.ts).
  const shouldTrack = shiftOpen || role === "DRIVER";
  if (shouldTrack && !tracking) {
    await startTracking("SHIFT");
  }
}

export async function registerWatchdog(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync().catch(() => null);
  if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;

  await BackgroundTask.registerTaskAsync(WATCHDOG_TASK, {
    // 15 хвилин — мінімум, який дозволяє Android; менше просто ігнорується.
    minimumInterval: 15,
  }).catch(() => {});
}

export async function unregisterWatchdog(): Promise<void> {
  await BackgroundTask.unregisterTaskAsync(WATCHDOG_TASK).catch(() => {});
}
