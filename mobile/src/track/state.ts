/**
 * Стан треку, який мусить пережити перезапуск процесу.
 *
 * Фонове завдання Android запускається в новому процесі: змінні в пам'яті там
 * порожні, і «чи відкрита зміна» доводиться читати зі сховища. Лежить у тій
 * самій SQLite, що й буфер точок — щоб стан і дані, яких він стосується, не
 * могли розійтися між двома сховищами.
 *
 * Роль тут не секрет (це не токен), тож SecureStore не потрібен — а от
 * доступність із фонового завдання без біометрії потрібна: інакше служба
 * питала б Face ID, щоб дізнатися, що вона водійська.
 */

import { getMeta, setMeta } from "./db";

/** SHIFT — робочий трек; AFTER_SHIFT — рідкий дозапис після закриття зміни. */
export type TrackMode = "SHIFT" | "AFTER_SHIFT";

export async function getRole(): Promise<string | null> {
  return getMeta("role");
}
export async function setRole(role: string | null): Promise<void> {
  await setMeta("role", role);
}

export async function getMode(): Promise<TrackMode | null> {
  const v = await getMeta("mode");
  return v === "SHIFT" || v === "AFTER_SHIFT" ? v : null;
}
export async function setMode(mode: TrackMode | null): Promise<void> {
  await setMeta("mode", mode);
}

export async function isShiftOpen(): Promise<boolean> {
  return (await getMeta("shiftOpen")) === "1";
}
export async function setShiftOpen(open: boolean): Promise<void> {
  await setMeta("shiftOpen", open ? "1" : "0");
}

/** Остання координата, від якої рахується «чи зрушили» — див. recorder.ts. */
export async function getLastWritten(): Promise<{ at: number; lat: number; lng: number } | null> {
  const raw = await getMeta("lastWritten");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { at: number; lat: number; lng: number };
  } catch {
    return null;
  }
}
export async function setLastWritten(at: number, lat: number, lng: number): Promise<void> {
  await setMeta("lastWritten", JSON.stringify({ at, lat, lng }));
}

export async function getLastFlushAt(): Promise<number> {
  return Number(await getMeta("lastFlushAt")) || 0;
}
export async function setLastFlushAt(ms: number): Promise<void> {
  await setMeta("lastFlushAt", String(ms));
}

export async function getLastHeartbeatAt(): Promise<number> {
  return Number(await getMeta("lastHeartbeatAt")) || 0;
}
export async function setLastHeartbeatAt(ms: number): Promise<void> {
  await setMeta("lastHeartbeatAt", String(ms));
}

export async function getLastFix(): Promise<{ at: number; accuracyM: number | null } | null> {
  const raw = await getMeta("lastFix");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { at: number; accuracyM: number | null };
  } catch {
    return null;
  }
}
export async function setLastFix(at: number, accuracyM: number | null): Promise<void> {
  await setMeta("lastFix", JSON.stringify({ at, accuracyM }));
}

/**
 * Коли приймач востаннє дав хоч щось — з ДВОХ джерел, а не з одного.
 *
 * Мітка `lastFix` пишеться на кожен фікс, зокрема на відкинутий фільтрами, і
 * саме тому вона цінна. Але 02.09 вона розійшлася з дійсністю: планшет Ігоря
 * дві години писав точки з похибкою 13 м, а пульс казав «приймач мовчав 118
 * хв» — і застосунок на цій підставі дарма перепідписувався, щоразу гублячи
 * кілька точок. Причину розбіжності (два контексти JS після оновлення
 * повітрям) я не довів, і саме тому не спираюся більше на одне джерело.
 *
 * `lastWritten` — час останньої ЗАПИСАНОЇ точки. Він не бреше за побудовою:
 * якщо точка лягла в буфер, приймач працював. Беремо пізніше з двох — тоді
 * тривога «мовчить» не може спрацювати там, де трек іде.
 */
export async function getLastFixAt(): Promise<number | null> {
  const [fix, written] = await Promise.all([getLastFix(), getLastWritten()]);
  const times = [fix?.at, written?.at].filter((t): t is number => typeof t === "number");
  return times.length > 0 ? Math.max(...times) : null;
}

export async function getLastError(): Promise<string | null> {
  return getMeta("lastError");
}
export async function setLastError(message: string | null): Promise<void> {
  await setMeta("lastError", message ? message.slice(0, 200) : null);
}

/**
 * Чому НЕ ВДАЛОСЯ підняти запис — окремо від помилок відправки.
 *
 * Обидві скарги жили в одному полі, і 01.09 це коштувало діагнозу: планшет не
 * зміг запустити службу локації, а в пульс поїхало «Network request failed» від
 * буфера, бо воно записалося пізніше. Найважливіше — «запису немає» — зникло
 * під випадковою мережевою дрібницею.
 */
export async function getStartError(): Promise<string | null> {
  return getMeta("startError");
}

export async function setStartError(message: string | null): Promise<void> {
  await setMeta("startError", message ? message.slice(0, 200) : null);
}

/** Скидання всього стану — на виході з акаунта. */
export async function resetState(): Promise<void> {
  await Promise.all([
    setRole(null),
    setMode(null),
    setShiftOpen(false),
    setMeta("lastWritten", null),
    setMeta("lastFix", null),
    setLastError(null),
    setStartError(null),
  ]);
}
