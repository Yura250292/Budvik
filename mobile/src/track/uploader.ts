/**
 * Відправка буфера на сервер і пульс пристрою.
 *
 * Порт логіки з Kotlin-служби — з тими самими числами й тими самими
 * запобіжниками, бо кожен із них з'явився після конкретної втрати даних.
 */

import { staffApi, StaffApiError, APP_VERSION } from "@/api/staff";
import { readDeviceState } from "./device-state";
import {
  bufferedCount,
  dropPoints,
  oldestPoints,
  type BufferedPoint,
} from "./db";
import {
  getLastError,
  getLastFix,
  getLastFlushAt,
  getLastHeartbeatAt,
  getMode,
  isShiftOpen,
  setLastError,
  setLastFlushAt,
  setLastHeartbeatAt,
  setShiftOpen,
} from "./state";

/**
 * Стеля пачки. Сервер відхиляє понад 500 одним 400, і колись через це поїхав
 * увесь буфер разом — а з ним і день маршруту. 200 — те саме число, що в
 * Kotlin-службі.
 */
const MAX_BATCH = 200;

/** Скільки чекати між відправками, якщо точок мало. */
const FLUSH_INTERVAL_MS = 120_000;
/** Стільки точок — і відправляємо, не чекаючи інтервалу. */
const FLUSH_AT_POINTS = 10;
const HEARTBEAT_INTERVAL_MS = 180_000;

let flushing = false;

/**
 * Віддає буфер пачками, доки він не спорожніє.
 *
 * Видаляє РІВНО те, що сервер підтвердив, і аж після відповіді: у цю мить трек
 * пишеться далі, і зріз «перші N» зніс би свіжі точки, яких сервер не бачив.
 */
export async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const batch = await oldestPoints(MAX_BATCH);
      if (batch.length === 0) break;

      const phase = batch[0]?.phase ?? undefined;
      try {
        await staffApi.trackPoints({
          points: batch.map((p: BufferedPoint) => ({
            lat: p.lat,
            lng: p.lng,
            accuracyM: p.accuracyM ?? undefined,
            speedKmh: p.speedKmh ?? undefined,
            headingDeg: p.headingDeg ?? undefined,
            // Час пристрою, а не час відправки: на ньому тримається і дедуп на
            // сервері, і сам порядок точок у дні.
            recordedAt: p.recordedAt,
          })),
          phase: phase ?? undefined,
        });
        await dropPoints(batch);
        await setLastError(null);
      } catch (e) {
        const status = e instanceof StaffApiError ? e.status : 0;

        /**
         * 401 обробляє сам клієнт (стирає токен і зупиняє службу) — тут лишаємо
         * буфер недоторканим: людина увійде знову, і день доїде.
         */
        if (status === 401) throw e;

        /**
         * Решта 4xx, крім 403 і 429, — це «сервер ніколи не прийме цю пачку».
         * Тримати її означало б забити буфер назавжди і втратити все, що після
         * неї. 403 віддає захист хостингу, 429 — стеля частоти: обидва минають.
         */
        if (status >= 400 && status < 500 && status !== 403 && status !== 429) {
          await dropPoints(batch);
          await setLastError(`Пачку відхилено (${status})`);
          continue;
        }

        await setLastError(e instanceof Error ? e.message : String(e));
        return; // мережа або сервер — спробуємо наступного разу
      }
    }
    await setLastFlushAt(Date.now());
  } finally {
    flushing = false;
  }
}

/** Чи час відправляти: або назбиралося, або минув інтервал. */
export async function maybeFlush(): Promise<void> {
  const [count, last] = await Promise.all([bufferedCount(), getLastFlushAt()]);
  if (count === 0) return;
  if (count >= FLUSH_AT_POINTS || Date.now() - last >= FLUSH_INTERVAL_MS) {
    await flush();
  }
}

/**
 * Пульс: сервер має бачити живий пристрій навіть тоді, коли точок немає.
 *
 * Без нього мовчання планшета неможливо відрізнити від «людина не виїхала».
 * Відповідь заразом звіряє локальний стан із серверним: зміну міг закрити офіс,
 * і застосунок мусить дізнатися про це, а не малювати своє.
 */
export async function heartbeat(force = false): Promise<{ shouldTrack: boolean } | null> {
  const last = await getLastHeartbeatAt();
  if (!force && Date.now() - last < HEARTBEAT_INTERVAL_MS) return null;

  const [buffered, mode, shiftOpen, fix, lastError, lastSync, device] = await Promise.all([
    bufferedCount(),
    getMode(),
    isShiftOpen(),
    getLastFix(),
    getLastError(),
    getLastFlushAt(),
    readDeviceState(),
  ]);

  try {
    const pulse = await staffApi.heartbeat({
      reportedAt: new Date().toISOString(),
      tracking: mode !== null,
      mode: mode ?? "NONE",
      shiftOpen,
      buffered,
      lastFixAt: fix ? new Date(fix.at).toISOString() : undefined,
      lastFixAccuracyM: fix?.accuracyM ?? undefined,
      lastSyncAt: lastSync ? new Date(lastSync).toISOString() : undefined,
      lastError: lastError ?? undefined,
      /**
       * Стан пристрою — заради відповіді на питання «чому трек обірвався».
       * Ті самі значення, що шле Kotlin-трекер, щоб адмінка не мала двох шкал.
       */
      locationPermission: device.locationPermission,
      locationMode: device.locationMode,
      batteryPct: device.batteryPct ?? undefined,
      appVersion: APP_VERSION,
    });
    await setLastHeartbeatAt(Date.now());

    // Правда про зміну — серверна: її міг закрити офіс, поки планшет був поза мережею.
    if (typeof pulse?.shiftOpen === "boolean" && pulse.shiftOpen !== shiftOpen) {
      await setShiftOpen(pulse.shiftOpen);
    }
    return { shouldTrack: pulse?.shouldTrack ?? false };
  } catch {
    // Пульс — довідка, а не робота: його втрата не має нічого ламати.
    return null;
  }
}
