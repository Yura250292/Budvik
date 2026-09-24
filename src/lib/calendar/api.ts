/**
 * Клієнт Google Calendar v3 — рівно ті виклики, які потрібні конектору.
 *
 * Голий fetch зі своїм таймаутом: воркер збирається одним бандлом, і
 * googleapis туди не поміщається (див. oauth.ts). Усі відповіді проходять
 * через classifyGoogle, тож рушій вище має справу не з кодами HTTP, а з
 * рішеннями: повторити, здатися, перепідключити.
 *
 * Модуль без next/* — його збирає воркер.
 */

import { CALENDAR_API } from "@/lib/calendar/config";
import { classifyGoogle, type GoogleVerdict } from "@/lib/calendar/errors";
import type { GoogleEventBody } from "@/lib/calendar/render";

const TIMEOUT_MS = 15_000;

export class CalendarApiError extends Error {
  constructor(
    message: string,
    readonly verdict: GoogleVerdict
  ) {
    super(message);
  }
}

async function call(
  accessToken: string,
  path: string,
  init: { method: string; body?: unknown; query?: Record<string, string> } = { method: "GET" }
): Promise<{ verdict: GoogleVerdict; data: Record<string, unknown> }> {
  const url = new URL(`${CALENDAR_API}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);

  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Обрив чи таймаут — це «спробуємо пізніше», а не поломка конектора.
    throw new CalendarApiError(`Google недоступний: ${e instanceof Error ? e.message : String(e)}`, "retry");
  }

  const text = await res.text();
  const verdict = classifyGoogle(res.status, text);

  if (verdict === "ok") {
    return { verdict, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  }
  // «Вже є» і «вже немає» — це не збої, а стани, які рушій уміє відпрацювати.
  if (verdict === "exists" || verdict === "gone") return { verdict, data: {} };

  throw new CalendarApiError(`${init.method} ${path} → ${res.status}: ${text.slice(0, 200)}`, verdict);
}

/** Створює календар «Budvik» в акаунті людини. Повертає його id. */
export async function createCalendar(accessToken: string, name: string): Promise<string> {
  const { data } = await call(accessToken, "/calendars", {
    method: "POST",
    body: { summary: name, description: "Робочий день із сайту Budvik", timeZone: "Europe/Kyiv" },
  });
  const id = String(data.id ?? "");
  if (!id) throw new CalendarApiError("Google не повернув id календаря", "retry");
  return id;
}

/**
 * Вставка події.
 *
 * `exists` замість помилки — це і є захист від дублів: id ми задаємо самі,
 * тож повтор після обірваного запису впирається в 409, і рушій просто
 * переходить до виправлення.
 */
export async function insertEvent(
  accessToken: string,
  calendarId: string,
  body: GoogleEventBody
): Promise<GoogleVerdict> {
  const { verdict } = await call(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body,
  });
  return verdict;
}

/** Виправлення події. `gone` — подію видалили руками, рушій вставить її наново. */
export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: GoogleEventBody
): Promise<GoogleVerdict> {
  const { verdict } = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body }
  );
  return verdict;
}

/** Видалення. `gone` — мета вже досягнута. */
export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<GoogleVerdict> {
  const { verdict } = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" }
  );
  return verdict;
}

/**
 * Які події справді лежать у календарі.
 *
 * Потрібно раз на добу, а не щотіку: це єдиний спосіб помітити, що подію
 * видалили руками в телефоні, і повернути її на місце.
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<Array<{ id: string; status: string }>> {
  const { data } = await call(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "GET",
    query: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      maxResults: "2500",
      fields: "items(id,status)",
    },
  });
  const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : [];
  return items.map((i) => ({ id: String(i.id ?? ""), status: String(i.status ?? "") }));
}
