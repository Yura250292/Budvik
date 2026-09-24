/**
 * Підключення людини: збереження, токени, календар «Budvik».
 *
 * Access-токен живе В ПАМ'ЯТІ процесу, а не в базі. Він дійсний годину,
 * а перезапуск воркера просто візьме новий із refresh-токена — тож класти
 * його в Postgres означало б завести другий секрет, який доведеться
 * шифрувати, ротувати й чистити, заради нуля користі.
 *
 * Модуль без next/* — його збирає воркер.
 */

import { prisma } from "@/lib/prisma";
import { CALENDAR_NAME } from "@/lib/calendar/config";
import { encryptToken, decryptToken } from "@/lib/calendar/crypto";
import { createCalendar } from "@/lib/calendar/api";
import { refreshAccessToken, CalendarOAuthError } from "@/lib/calendar/oauth";

export type Connection = {
  userId: string;
  googleEmail: string;
  refreshTokenEnc: string;
  calendarId: string | null;
  status: string;
  scope: string;
};

/** Дозвіл відкликано або протух — синк цієї людини стоїть до перепідключення. */
export class CalendarNotConnected extends Error {}
export class CalendarLinkExpired extends Error {}

const cache = new Map<string, { token: string; expiresAt: number }>();
/** Хвилина запасу: краще оновити трохи раніше, ніж отримати 401 посеред пачки. */
const EXPIRY_MARGIN_MS = 60_000;

export async function getConnection(userId: string): Promise<Connection | null> {
  return prisma.calendarConnection.findUnique({
    where: { userId },
    select: { userId: true, googleEmail: true, refreshTokenEnc: true, calendarId: true, status: true, scope: true },
  });
}

/** Підключення після згоди в Google. Повторне підключення переписує старе. */
export async function saveConnection(input: {
  userId: string;
  googleEmail: string;
  refreshToken: string;
  scope: string;
}): Promise<void> {
  const enc = encryptToken(input.refreshToken, input.userId);
  const data = {
    googleEmail: input.googleEmail,
    refreshTokenEnc: enc,
    keyVersion: 1,
    scope: input.scope,
    status: "ACTIVE",
    lastError: null,
    lastErrorAt: null,
    disconnectedAt: null,
  };

  await prisma.calendarConnection.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId, ...data },
    update: data,
  });
  cache.delete(input.userId);
}

/**
 * Позначити, що дозвіл відпав.
 *
 * Це стан, а не аварія: людина забрала доступ у себе в акаунті Google, або
 * дозвіл пролежав без діла пів року. Токен затирається одразу — тримати
 * недійсний секрет немає сенсу, а рядок лишається, щоб кабінет міг сказати
 * «підключіть ще раз».
 *
 * Зміна пароля Google дозвіл НЕ відкликає: це правило діє лише для дозволів
 * Gmail, яких конектор не просить.
 */
export async function markReconnect(userId: string, error: string): Promise<void> {
  cache.delete(userId);
  await prisma.calendarConnection.updateMany({
    where: { userId, status: { not: "DISABLED" } },
    data: { status: "NEEDS_RECONNECT", lastError: error.slice(0, 500), lastErrorAt: new Date() },
  });
}

/** Свіжий access-токен. Кидає CalendarLinkExpired, якщо Google уже не визнає дозвіл. */
export async function accessTokenFor(conn: Connection): Promise<string> {
  const hit = cache.get(conn.userId);
  if (hit && hit.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return hit.token;

  const refreshToken = decryptToken(conn.refreshTokenEnc, conn.userId);

  try {
    const { accessToken, expiresInS } = await refreshAccessToken(refreshToken);
    cache.set(conn.userId, { token: accessToken, expiresAt: Date.now() + expiresInS * 1000 });
    return accessToken;
  } catch (e) {
    if (e instanceof CalendarOAuthError && e.verdict === "reconnect") {
      await markReconnect(conn.userId, e.message);
      throw new CalendarLinkExpired(e.message);
    }
    throw e;
  }
}

/**
 * Календар «Budvik» в акаунті людини — створюємо лінивo, у першому тіку.
 *
 * Не в момент згоди: рукостискання має бути коротким і про одне. Збій
 * мережі при створенні календаря не повинен виглядати як «підключення не
 * вдалося», коли токен уже отримано.
 *
 * Календар видалили руками — наступний прохід отримає 404 і створить новий
 * (це розбирає рушій), тож стан самолікується.
 */
export async function ensureCalendar(conn: Connection, accessToken: string): Promise<string> {
  if (conn.calendarId) return conn.calendarId;

  const calendarId = await createCalendar(accessToken, CALENDAR_NAME);
  await prisma.calendarConnection.update({ where: { userId: conn.userId }, data: { calendarId } });
  return calendarId;
}

/** Календар зник у Google — забути id, щоб наступний прохід створив новий. */
export async function forgetCalendar(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.calendarConnection.update({ where: { userId }, data: { calendarId: null } }),
    prisma.calendarEventLink.deleteMany({ where: { userId } }),
  ]);
}

/** Людина натиснула «Відключити». Календар у Google лишається — це її дані. */
export async function disconnect(userId: string): Promise<void> {
  cache.delete(userId);
  await prisma.$transaction([
    prisma.calendarConnection.updateMany({
      where: { userId },
      data: {
        status: "DISABLED",
        refreshTokenEnc: "",
        calendarId: null,
        disconnectedAt: new Date(),
        lastError: null,
      },
    }),
    prisma.calendarEventLink.deleteMany({ where: { userId } }),
  ]);
}
