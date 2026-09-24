/**
 * Звірення календарів: що на сайті — те й у Google.
 *
 * Прохід не слухає зміни в базі, а раз на дві хвилини дивиться на
 * результат: бере бажаний стан вікна (проєктори), порівнює з тим, що вже
 * відправлено (CalendarEventLink), і доводить одне до одного. Хуки в
 * місцях запису тут не годяться — StaffTask і DeliveryRoute пишуться з
 * десятків місць, і забуте місце дало б тихий розсинхрон.
 *
 * Дорога частина (дифф) винесена в diff.ts і перевіряється пробою без
 * бази. Тут лишилася механіка: замки, беклоф, стани.
 *
 * Модуль без next/* — його збирає воркер.
 */

import { prisma } from "@/lib/prisma";
import { calendarMissingEnv } from "@/lib/calendar/config";
import { planChanges, type Action, type LinkRow } from "@/lib/calendar/diff";
import { googleEventBody, eventIdFor, contentHash } from "@/lib/calendar/render";
import { CALLS_PER_TICK, nextAttempt, windowFor, type SyncWindow } from "@/lib/calendar/policy";
import { deleteEvent, insertEvent, patchEvent, CalendarApiError } from "@/lib/calendar/api";
import {
  accessTokenFor,
  ensureCalendar,
  forgetCalendar,
  markReconnect,
  CalendarLinkExpired,
  type Connection,
} from "@/lib/calendar/connection";
import { notifyReconnect } from "@/lib/calendar/notify";
import { taskEventsFor } from "@/lib/calendar/projectors/tasks";
import { CALENDAR_TICK_KEY, type CalendarEntity, type DesiredEvent } from "@/lib/calendar/types";

/** Мітка «конектор живий» — щоб було видно, коли прохід востаннє дихав. */
const TICK_WRITE_EVERY_MS = 60_000;

let warnedMissing = false;
let lastTickWrite = 0;

async function markTick(now: Date, missing: string[]): Promise<void> {
  if (now.getTime() - lastTickWrite < TICK_WRITE_EVERY_MS) return;
  lastTickWrite = now.getTime();
  const value = JSON.stringify({ at: now.toISOString(), missing });
  await prisma.syncState.upsert({
    where: { key: CALENDAR_TICK_KEY },
    create: { key: CALENDAR_TICK_KEY, value },
    update: { value },
  });
}

/**
 * Бажаний стан людини на вікні.
 *
 * Додати сутність — це дописати рядок сюди й покласти поруч файл
 * проєктора. Рушій нижче про предметну область не знає нічого.
 */
async function desiredFor(userId: string, window: SyncWindow): Promise<DesiredEvent[]> {
  return taskEventsFor(userId, window);
}

/** Результат однієї дії, як його бачить рушій. */
type Outcome = "done" | "retry" | "failed" | "reconnect" | "calendar-gone";

async function applyAction(
  action: Action,
  ctx: { userId: string; accessToken: string; calendarId: string }
): Promise<Outcome> {
  try {
    if (action.kind === "delete") {
      await deleteEvent(ctx.accessToken, ctx.calendarId, action.googleEventId);
      return "done";
    }

    const body = googleEventBody(action.event, ctx.userId);

    if (action.kind === "patch") {
      const verdict = await patchEvent(ctx.accessToken, ctx.calendarId, action.googleEventId, body);
      // Подію видалили руками в телефоні — вставляємо наново, а не здаємось.
      if (verdict === "gone") await insertEvent(ctx.accessToken, ctx.calendarId, body);
      return "done";
    }

    const verdict = await insertEvent(ctx.accessToken, ctx.calendarId, body);
    // Сталий id: подія вже є (обірваний запис, друга копія воркера) — виправляємо.
    if (verdict === "exists") await patchEvent(ctx.accessToken, ctx.calendarId, body.id, body);
    return "done";
  } catch (e) {
    if (e instanceof CalendarApiError) {
      if (e.verdict === "reconnect") return "reconnect";
      if (e.verdict === "retry") return "retry";
      // 404 на сам календар означає, що його видалили в Google цілком.
      if (e.verdict === "gone") return "calendar-gone";
      return "failed";
    }
    throw e;
  }
}

/** Записати наслідок дії в мапінг. */
async function recordOutcome(
  action: Action,
  outcome: Outcome,
  ctx: { userId: string; calendarId: string; now: Date; error?: string }
): Promise<void> {
  const where = {
    userId_entity_entityId: {
      userId: ctx.userId,
      entity: action.entity,
      entityId: action.entityId,
    },
  };

  if (action.kind === "delete") {
    if (outcome === "done") {
      await prisma.calendarEventLink.deleteMany({
        where: { userId: ctx.userId, entity: action.entity, entityId: action.entityId },
      });
    }
    return;
  }

  if (outcome === "done") {
    const data = {
      googleEventId: eventIdFor(action.entity as CalendarEntity, action.entityId, ctx.userId),
      calendarId: ctx.calendarId,
      contentHash: contentHash(action.event),
      state: "SYNCED",
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      lockedAt: null,
    };
    await prisma.calendarEventLink.upsert({
      where,
      create: { userId: ctx.userId, entity: action.entity, entityId: action.entityId, ...data },
      update: data,
    });
    return;
  }

  // Невдача: лишаємо слід і відкладаємо наступну спробу.
  const existing = await prisma.calendarEventLink.findUnique({ where, select: { attempts: true } });
  const attempts = (existing?.attempts ?? 0) + 1;
  const data = {
    googleEventId: eventIdFor(action.entity as CalendarEntity, action.entityId, ctx.userId),
    calendarId: ctx.calendarId,
    contentHash: "",
    state: outcome === "failed" ? "FAILED" : "PENDING",
    attempts,
    nextAttemptAt: nextAttempt(ctx.now, attempts),
    lastError: (ctx.error ?? "").slice(0, 500),
  };
  await prisma.calendarEventLink.upsert({
    where,
    create: { userId: ctx.userId, entity: action.entity, entityId: action.entityId, ...data },
    update: data,
  });
}

/** Один прохід по одній людині. Повертає рядки для журналу воркера. */
async function syncOne(conn: Connection, now: Date, dry: boolean): Promise<string[]> {
  const log: string[] = [];
  const window = windowFor(now);

  const desired = await desiredFor(conn.userId, window);
  const links = (await prisma.calendarEventLink.findMany({
    where: { userId: conn.userId },
    select: { entity: true, entityId: true, googleEventId: true, contentHash: true, state: true, nextAttemptAt: true },
  })) as LinkRow[];

  const actions = planChanges(desired, links, now, CALLS_PER_TICK);
  if (actions.length === 0) return log;

  if (dry) {
    for (const a of actions) log.push(`${conn.googleEmail}: ${a.kind} ${a.entity} ${a.entityId}`);
    return log;
  }

  let accessToken: string;
  try {
    accessToken = await accessTokenFor(conn);
  } catch (e) {
    if (e instanceof CalendarLinkExpired) {
      await notifyReconnect(conn.userId);
      return [`${conn.googleEmail}: дозвіл відпав — попросили підключити ще раз`];
    }
    throw e;
  }

  let calendarId: string;
  try {
    calendarId = await ensureCalendar(conn, accessToken);
  } catch (e) {
    return [`${conn.googleEmail}: календар не створено — ${e instanceof Error ? e.message : String(e)}`];
  }

  let done = 0;
  for (const action of actions) {
    const outcome = await applyAction(action, { userId: conn.userId, accessToken, calendarId });

    if (outcome === "reconnect") {
      await markReconnect(conn.userId, "Google відкликав дозвіл");
      await notifyReconnect(conn.userId);
      log.push(`${conn.googleEmail}: дозвіл відпав — попросили підключити ще раз`);
      return log;
    }
    if (outcome === "calendar-gone") {
      await forgetCalendar(conn.userId);
      log.push(`${conn.googleEmail}: календар видалено в Google — створимо наступним проходом`);
      return log;
    }

    await recordOutcome(action, outcome, { userId: conn.userId, calendarId, now });
    if (outcome === "done") done += 1;
    else log.push(`${conn.googleEmail}: ${action.kind} ${action.entity} ${action.entityId} — ${outcome}`);
  }

  if (done > 0) {
    await prisma.calendarConnection.update({ where: { userId: conn.userId }, data: { lastSyncAt: now } });
    log.push(`${conn.googleEmail}: ${done} подій оновлено`);
  }
  return log;
}

/**
 * Прохід по всіх підключеннях.
 *
 * Немає ключа шифрування — конектор мовчить: один рядок попередження на
 * запуск процесу, і таймер крутиться вхолосту. Так код живе на проді ще до
 * того, як щось налаштовано в Google Cloud.
 */
export async function syncCalendars(
  opts: { dry?: boolean; now?: Date; onlyUserId?: string } = {}
): Promise<string[]> {
  const now = opts.now ?? new Date();
  const missing = calendarMissingEnv();

  await markTick(now, missing);

  if (missing.length > 0) {
    if (!warnedMissing) {
      console.warn(`календар: конектор вимкнено — немає ${missing.join(", ")}`);
      warnedMissing = true;
    }
    return [];
  }

  const connections = (await prisma.calendarConnection.findMany({
    where: { status: "ACTIVE", ...(opts.onlyUserId ? { userId: opts.onlyUserId } : {}) },
    select: { userId: true, googleEmail: true, refreshTokenEnc: true, calendarId: true, status: true, scope: true },
  })) as Connection[];

  const log: string[] = [];
  for (const conn of connections) {
    try {
      log.push(...(await syncOne(conn, now, opts.dry ?? false)));
    } catch (e) {
      // Одна людина не повинна зупиняти решту: чужий збій — не наша аварія.
      log.push(`${conn.googleEmail}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return log;
}
