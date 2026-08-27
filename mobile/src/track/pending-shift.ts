/**
 * Відкладене відкриття/закриття зміни, коли немає зв'язку.
 *
 * Зміну відкривають о сьомій ранку на складі, де мережа буває гіршою, ніж у
 * полі. Якщо запит не пройшов, людина не має стояти й тикати кнопку: намір
 * зберігається тут, а сторож (watchdog.ts) відправляє його, щойно з'явиться
 * мережа. Сервер дедупить за clientRequestId, тож повтор нічого не задвоює.
 *
 * Фото одометра в чергу НЕ кладемо навмисно. Розпізнавання — це виклик до
 * сервера, тобто офлайн воно неможливе в принципі; тягнути ще й файл через
 * буфер означало б складність заради того, що все одно не спрацює. Замість
 * цього офлайн людина вводить число руками, і джерело чесно позначається як
 * MANUAL — офіс бачить, що ці показання ніхто не звіряв із фото.
 */

import { staffApi, StaffApiError } from "@/api/staff";
import { getMeta, setMeta } from "./db";
import { setShiftOpen } from "./state";

const KEY = "pendingShift";

export type PendingShift = {
  action: "open" | "close";
  odometer: number;
  source: "MANUAL";
  clientRequestId: string;
  lat?: number;
  lng?: number;
  createdAt: number;
};

export async function getPendingShift(): Promise<PendingShift | null> {
  const raw = await getMeta(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingShift;
  } catch {
    return null;
  }
}

export async function setPendingShift(p: PendingShift | null): Promise<void> {
  await setMeta(KEY, p ? JSON.stringify(p) : null);
}

/**
 * Пробує відправити відкладену зміну.
 *
 * 4xx (крім 429) означає, що сервер цей запит не прийме ніколи — наприклад,
 * показання менші за попередні. Тримати його в черзі означало б довічні спроби
 * й, головне, блокування наступної спроби відкрити зміну по-людськи.
 */
export async function flushPendingShift(): Promise<void> {
  const pending = await getPendingShift();
  if (!pending) return;

  const body = {
    odometer: pending.odometer,
    source: pending.source,
    clientRequestId: pending.clientRequestId,
    lat: pending.lat,
    lng: pending.lng,
  };

  try {
    const { cancelCloseReminders, scheduleCloseReminders } = await import("./reminder");
    if (pending.action === "open") {
      await staffApi.shiftOpen(body);
      await setShiftOpen(true);
      /**
       * Офлайнове відкриття доїхало лише зараз — можливо, вже під вечір.
       * Нагадування все одно ставимо: `scheduleCloseReminders` сама
       * пропускає години, що минули, тож пізній прогін не додасть нічого
       * зайвого.
       */
      await scheduleCloseReminders();
    } else {
      await staffApi.shiftClose(body);
      await setShiftOpen(false);
      await cancelCloseReminders();
    }
    await setPendingShift(null);
  } catch (e) {
    const status = e instanceof StaffApiError ? e.status : 0;
    if (status >= 400 && status < 500 && status !== 429) {
      await setPendingShift(null);
    }
    // Мережа або сервер — лишаємо в черзі до наступної спроби.
  }
}
