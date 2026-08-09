/**
 * Автентифікація агента 1С для маршрутів /api/sync-ingest/*.
 *
 * Сесія NextAuth тут не підходить: агент — це служба на сервері клієнта без
 * браузера. Використовуємо спільний секрет і HMAC-підпис тіла запиту.
 *
 * Підпис: hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)).
 * Часове вікно ±5 хв відсікає повторне відтворення перехопленого запиту.
 */

import crypto from "crypto";
import { SIGNATURE_WINDOW_SECONDS } from "./types";

export const SYNC_HEADERS = {
  agent: "x-sync-agent",
  timestamp: "x-sync-timestamp",
  signature: "x-sync-signature",
} as const;

export interface AuthSuccess {
  ok: true;
  /** Сире тіло запиту — вже прочитане для перевірки підпису, читати повторно не можна. */
  rawBody: string;
  agentId: string;
}

export interface AuthFailure {
  ok: false;
  status: 401 | 403 | 500;
  error: string;
}

export type AuthResult = AuthSuccess | AuthFailure;

/** Обчислює підпис. Використовується і сервером, і агентом. */
export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/** Порівняння за сталий час — щоб підпис не можна було підібрати по таймінгу. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Перевіряє підпис запиту й повертає сире тіло.
 *
 * Тіло читається тут один раз: `Request.text()` можна викликати лише раз,
 * тому маршрути мають брати `rawBody` з результату, а не з `req.json()`.
 */
export async function authenticateAgent(req: Request): Promise<AuthResult> {
  const expectedAgentId = process.env.SYNC_AGENT_ID;
  const secret = process.env.SYNC_AGENT_SECRET;

  if (!expectedAgentId || !secret) {
    console.error("sync-ingest: SYNC_AGENT_ID / SYNC_AGENT_SECRET не налаштовані");
    return { ok: false, status: 500, error: "Синхронізацію не налаштовано на сервері" };
  }

  const agentId = req.headers.get(SYNC_HEADERS.agent);
  const timestamp = req.headers.get(SYNC_HEADERS.timestamp);
  const signature = req.headers.get(SYNC_HEADERS.signature);

  if (!agentId || !timestamp || !signature) {
    return { ok: false, status: 401, error: "Відсутні заголовки автентифікації" };
  }

  if (!safeEqual(agentId, expectedAgentId)) {
    return { ok: false, status: 403, error: "Невідомий агент" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, status: 401, error: "Некоректна мітка часу" };
  }

  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (skew > SIGNATURE_WINDOW_SECONDS) {
    return {
      ok: false,
      status: 401,
      error: `Мітка часу поза допустимим вікном (розбіжність ${skew}с)`,
    };
  }

  const rawBody = await req.text();
  const expected = signPayload(secret, timestamp, rawBody);

  if (!safeEqual(signature, expected)) {
    return { ok: false, status: 403, error: "Невірний підпис" };
  }

  return { ok: true, rawBody, agentId };
}
