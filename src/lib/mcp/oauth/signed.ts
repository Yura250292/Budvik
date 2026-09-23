/**
 * Параметри /authorize, перенесені через форму входу з підписом.
 *
 * SDK перевіряє клієнта й редирект на GET /authorize і віддає нам уже чисті
 * параметри, а людина вводить пароль окремим POST /login. Між ними параметри
 * їдуть у прихованому полі — і без підпису їх можна було б підмінити (інший
 * редирект, інший challenge). HMAC із терміном 10 хвилин закриває обидва:
 * підмінене не пройде, а забута вкладка з формою не спрацює через день.
 */

import { createHmac, timingSafeEqual } from "crypto";

export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: string[];
  resource?: string;
};

const TTL_MS = 10 * 60_000;

function secret(): string {
  const s = process.env.MCP_STATE_SECRET;
  if (!s) throw new Error("MCP_STATE_SECRET не задано");
  return s;
}

function mac(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function signParams(p: AuthorizeParams, now: Date = new Date()): string {
  const body = Buffer.from(JSON.stringify({ ...p, exp: now.getTime() + TTL_MS })).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function verifyParams(signed: string, now: Date = new Date()): AuthorizeParams | null {
  const [body, sig, extra] = signed.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;

  let data: AuthorizeParams & { exp?: unknown };
  try {
    data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof data.exp !== "number" || data.exp < now.getTime()) return null;
  if (typeof data.clientId !== "string" || typeof data.redirectUri !== "string" || typeof data.codeChallenge !== "string") return null;
  return {
    clientId: data.clientId,
    redirectUri: data.redirectUri,
    codeChallenge: data.codeChallenge,
    state: typeof data.state === "string" ? data.state : undefined,
    scopes: Array.isArray(data.scopes) ? data.scopes.filter((s): s is string => typeof s === "string") : [],
    resource: typeof data.resource === "string" ? data.resource : undefined,
  };
}
