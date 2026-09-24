/**
 * Обмін із Google: згода, токени, відкликання.
 *
 * Голий fetch, без googleapis: потрібно рівно чотири виклики, а бібліотека
 * важить десятки мегабайт і тягне динамічні require — воркер збирається
 * одним бандлом через esbuild, і такий пакунок його або роздує, або зламає.
 * Так само зроблено з усіма іншими службами проєкту (AssemblyAI, OpenAI,
 * Expo, Telegram).
 *
 * Модуль без next/* — його збирає воркер.
 */

import {
  CALENDAR_SCOPE,
  GOOGLE_AUTH_URL,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
} from "@/lib/calendar/config";
import { classifyGoogle } from "@/lib/calendar/errors";

const TIMEOUT_MS = 15_000;

export class CalendarOAuthError extends Error {
  constructor(
    message: string,
    readonly verdict: ReturnType<typeof classifyGoogle>
  ) {
    super(message);
  }
}

/**
 * Адреса екрана згоди.
 *
 * `access_type=offline` разом із `prompt=consent` — єдиний спосіб отримати
 * refresh_token: без другого Google вирішить, що дозвіл уже давали, і
 * віддасть лише годинний access_token, після якого конектор мовчки помре
 * за годину. `include_granted_scopes=false` тримає дозвіл рівно тим, про
 * який ми просили, навіть якщо людина колись давала застосунку більше.
 */
export function authorizeUrl(state: string, redirectUri: string, loginHint?: string | null): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CALENDAR_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await res.text();
  const verdict = classifyGoogle(res.status, text);
  if (verdict !== "ok") {
    throw new CalendarOAuthError(`Google відповів ${res.status}: ${text.slice(0, 200)}`, verdict);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** Пошта акаунта з id_token. Підпис не перевіряємо: токен приїхав прямо від Google по TLS. */
function emailFromIdToken(idToken: unknown): string {
  if (typeof idToken !== "string") return "";
  const payload = idToken.split(".")[1];
  if (!payload) return "";
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string };
    return data.email ?? "";
  } catch {
    return "";
  }
}

export type ExchangeResult = {
  refreshToken: string;
  accessToken: string;
  expiresInS: number;
  scope: string;
  email: string;
};

/** Код зі сторінки згоди → токени. */
export async function exchangeCode(code: string, redirectUri: string): Promise<ExchangeResult> {
  const data = await postForm(GOOGLE_TOKEN_URL, {
    code,
    client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  return {
    refreshToken: String(data.refresh_token ?? ""),
    accessToken: String(data.access_token ?? ""),
    expiresInS: Number(data.expires_in ?? 3600),
    scope: String(data.scope ?? ""),
    email: emailFromIdToken(data.id_token),
  };
}

/** Постійний дозвіл → свіжий годинний токен. */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresInS: number }> {
  const data = await postForm(GOOGLE_TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
  });
  return { accessToken: String(data.access_token ?? ""), expiresInS: Number(data.expires_in ?? 3600) };
}

/**
 * Відкликати дозвіл у Google.
 *
 * Невдача тут не фатальна: людина натиснула «Відключити», і головне —
 * прибрати токен у нас. Google свій бік підчистить, коли токен протухне.
 */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
