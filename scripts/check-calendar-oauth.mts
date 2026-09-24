/**
 * Рукостискання з Google: підписаний state і адреса згоди.
 *
 * State тут — не формальність: без нього чужа сторінка могла б підсунути
 * людині свій код авторизації й прив'язати ЧУЖИЙ Google-акаунт до її
 * профілю. Тому підпис, строк життя й звірка з кукою перевіряються окремо.
 *
 *   npx tsx scripts/check-calendar-oauth.mts
 *
 * Бази не торкається, у Google не ходить.
 */

process.env.CALENDAR_STATE_SECRET = "секрет-для-проби";
process.env.GOOGLE_CALENDAR_CLIENT_ID = "123.apps.googleusercontent.com";
process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "secret";

import { signState, verifyState } from "../src/lib/calendar/state";
import { authorizeUrl } from "../src/lib/calendar/oauth";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got)}`);
  if (!ok) fails.push(name);
}

const NOW = new Date("2026-09-23T10:00:00Z");
const state = signState({ userId: "usr_1", nonce: "n1", returnTo: "/admin/profile" }, NOW);

/* ── Підписаний state ───────────────────────────────────────────────── */

const back = verifyState(state, NOW);
check("розбирається назад", back?.userId === "usr_1", back?.userId);
check("nonce на місці", back?.nonce === "n1", back?.nonce);
check("куди повертати — теж", back?.returnTo === "/admin/profile", back?.returnTo);

check("підроблений підпис не проходить", verifyState(state.slice(0, -3) + "aaa", NOW) === null, "null");
check("сміття не проходить", verifyState("казна-що", NOW) === null, "null");

const later = new Date(NOW.getTime() + 11 * 60_000);
check("через 11 хвилин протух", verifyState(state, later) === null, "null");
check("через 5 хвилин ще живий", verifyState(state, new Date(NOW.getTime() + 5 * 60_000))?.userId === "usr_1", "живий");

/* ── Адреса екрана згоди ────────────────────────────────────────────── */

const url = new URL(authorizeUrl(state, "https://www.budvik27.com/api/calendar/google/callback", "ivan@gmail.com"));

check("просимо постійний дозвіл", url.searchParams.get("access_type") === "offline", url.searchParams.get("access_type"));
check(
  "питаємо згоду щоразу — інакше Google не віддасть refresh_token",
  url.searchParams.get("prompt") === "consent",
  url.searchParams.get("prompt")
);
const scope = url.searchParams.get("scope") ?? "";
const parts = scope.split(" ").filter(Boolean);
const calendarParts = parts.filter((p) => p.includes("/auth/calendar"));

check(
  "просимо лише власні календарі застосунку",
  calendarParts.length === 1 && calendarParts[0] === "https://www.googleapis.com/auth/calendar.app.created",
  calendarParts.join(", ")
);
check("просимо пошту — щоб показати, який акаунт підключено", parts.includes("email"), scope);
check("state передано", url.searchParams.get("state") === state, "так");
check("підказка, який акаунт підключати", url.searchParams.get("login_hint") === "ivan@gmail.com", url.searchParams.get("login_hint"));
check("чужих дозволів не підмішуємо", url.searchParams.get("include_granted_scopes") === "false", url.searchParams.get("include_granted_scopes"));

/* ── Підсумок ───────────────────────────────────────────────────────── */

console.log();
if (fails.length > 0) {
  console.log(`✖ провалено ${fails.length}: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("✔ усе зійшлося");
