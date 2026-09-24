/**
 * Побудова події Google з бажаного стану.
 *
 * Тут живуть три речі, кожна з яких закриває окремий клас помилок:
 * сталий ідентифікатор (проти дублів), київський настінний час (проти
 * зсуву на годину взимку) і відбиток змісту (проти зайвих викликів API).
 *
 * Модуль без next/* — його збирає воркер.
 */

import { createHash } from "node:crypto";
import { kyivOffsetMs } from "@/lib/date/kyiv";
import type { CalendarEntity, DesiredEvent } from "@/lib/calendar/types";

/**
 * Ідентифікатор події, який задаємо самі.
 *
 * Google дозволяє клієнту призначати id, і це не дрібниця: інакше
 * лишається дірка «вставили в Google → воркер помер до запису id →
 * наступний тік вставив дубль». Зі сталим id повторна вставка віддає 409,
 * який ми читаємо як «вже є». На Railway під час `railway up` дві копії
 * воркера живуть одночасно, тож це не оптимізація, а необхідність.
 *
 * Google вимагає алфавіт base32hex (a-v і 0-9). Шістнадцятковий рядок
 * користується лише 0-9a-f, тобто гарантовано вкладається в дозволене —
 * писати власний кодувальник base32 немає за що.
 */
export function eventIdFor(entity: CalendarEntity, entityId: string, userId: string): string {
  return "bdvk" + createHash("sha1").update(`${entity}:${entityId}:${userId}`).digest("hex");
}

/** "2026-09-24" → наступна доба. Рахунок в UTC, тому перехід на зимовий час не заважає. */
function nextDay(day: string): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Подія на весь день.
 *
 * Кінець у Google — доба, ДО якої подія триває, не включно. Поставити той
 * самий день означає подію нульової довжини, якої не видно в календарі.
 */
export function allDayEvent(day: string): { start: { date: string }; end: { date: string } } {
  return { start: { date: day }, end: { date: nextDay(day) } };
}

/** Момент → київський настінний час "2026-09-24T15:30:00". */
function kyivWallClock(at: Date): string {
  return new Date(at.getTime() + kyivOffsetMs(at)).toISOString().slice(0, 19);
}

/**
 * Подія з часом.
 *
 * Віддаємо настінний час плюс назву поясу, а не UTC-мить: так подія
 * читається в телефоні рівно так, як її назвала людина, і не їде на
 * годину в день переходу на зимовий час. Зсув рахується окремо для
 * початку й кінця — саме тому подія, що перетинає переведення стрілок,
 * лишається правильної довжини.
 */
export function timedEvent(
  at: Date,
  minutes: number
): { start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } } {
  const end = new Date(at.getTime() + minutes * 60_000);
  return {
    start: { dateTime: kyivWallClock(at), timeZone: "Europe/Kyiv" },
    end: { dateTime: kyivWallClock(end), timeZone: "Europe/Kyiv" },
  };
}

/**
 * Відбиток змісту події.
 *
 * Збігся з тим, що лежить у CalendarEventLink, — жодного виклику API.
 * Це те, завдяки чому звірення всього вікна щодві хвилини коштує один
 * запит до Postgres і нуль запитів до Google.
 *
 * Рахується від УЖЕ обрізаних рядків: інакше правка в хвості довгого
 * опису, яка до Google однаково не доїде, щоразу вважалася б зміною.
 */
export function contentHash(e: DesiredEvent): string {
  const parts = [
    cut(e.summary, SUMMARY_MAX),
    cut(e.description ?? "", DESCRIPTION_MAX),
    e.location ?? "",
    e.day ?? "",
    e.at ? e.at.toISOString() : "",
    e.minutes === null ? "" : String(e.minutes),
  ];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
}

/** Межі Google із запасом: заголовок і опис у події не безмежні. */
const SUMMARY_MAX = 200;
const DESCRIPTION_MAX = 8000;

function cut(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

/** Подія в тому вигляді, в якому її приймає Calendar API. */
export type GoogleEventBody = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
};

/**
 * Бажана подія → тіло запиту.
 *
 * `extendedProperties` тримає слід, з якого запису на сайті зроблено подію.
 * Календар у нас окремий і весь наш, тож для звичайної роботи це зайве —
 * але коли доведеться розбиратися, звідки взялася дивна подія, або
 * прибирати сирітки після зміни правил, цей слід єдиний, що лишається на
 * боці Google.
 */
export function googleEventBody(e: DesiredEvent, userId: string): GoogleEventBody {
  const when = e.day ? allDayEvent(e.day) : timedEvent(e.at ?? new Date(), e.minutes ?? 30);

  return {
    id: eventIdFor(e.entity, e.entityId, userId),
    summary: cut(e.summary, SUMMARY_MAX),
    ...(e.description ? { description: cut(e.description, DESCRIPTION_MAX) } : {}),
    ...(e.location ? { location: e.location } : {}),
    ...when,
    extendedProperties: { private: { budvikEntity: e.entity, budvikId: e.entityId } },
  };
}
