/**
 * Ядро конектора календаря: шифрування токена й побудова події.
 *
 * Бази й мережі тут немає навмисно — це чисті функції, і саме тому їхню
 * поведінку можна закріпити випадками, які в житті трапляються раз на рік:
 * зіпсований шифротекст, подія на межі доби, той самий запис у двох людей.
 *
 *   npx tsx scripts/check-calendar-core.mts
 *
 * Бази не торкається, у Google не ходить.
 */

process.env.CALENDAR_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");

import { encryptToken, decryptToken } from "../src/lib/calendar/crypto";
import { calendarMissingEnv } from "../src/lib/calendar/config";
import { eventIdFor, allDayEvent, timedEvent, contentHash, googleEventBody } from "../src/lib/calendar/render";
import type { DesiredEvent } from "../src/lib/calendar/types";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got)}`);
  if (!ok) fails.push(name);
}

function threw(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

/* ── Шифрування токена ──────────────────────────────────────────────── */

const TOKEN = "1//0cRefreshTokenВідGoogle-abc_123";
const USER = "usr_kavetskyi";

const enc = encryptToken(TOKEN, USER);
check("розшифровується назад", decryptToken(enc, USER) === TOKEN, decryptToken(enc, USER).slice(0, 12) + "…");
check("формат v1.<ключ>.<iv>.<tag>.<шифр>", /^v1\.1\.[\w-]+\.[\w-]+\.[\w-]+$/.test(enc), enc.slice(0, 24) + "…");
check("той самий токен щоразу інший рядок", encryptToken(TOKEN, USER) !== enc, "різні IV");
check("чужий userId не розшифровує", threw(() => decryptToken(enc, "usr_хтось")), "кинуло");
check("зіпсований шифротекст не розшифровує", threw(() => decryptToken(enc.slice(0, -4) + "AAAA", USER)), "кинуло");

/* ── Вимкнений конектор ─────────────────────────────────────────────── */

const keep = process.env.CALENDAR_TOKEN_KEY;
delete process.env.CALENDAR_TOKEN_KEY;
check("без ключа конектор вимкнений", calendarMissingEnv().includes("CALENDAR_TOKEN_KEY"), calendarMissingEnv().join(", "));
process.env.CALENDAR_TOKEN_KEY = keep;
process.env.GOOGLE_CALENDAR_CLIENT_ID = "id";
process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "secret";
check("з усіма змінними — нічого не бракує", calendarMissingEnv().length === 0, calendarMissingEnv().join(", ") || "порожньо");

/* ── Ідентифікатор події ────────────────────────────────────────────── */

const idA = eventIdFor("STAFF_TASK", "task_1", USER);
check("id той самий при повторі", idA === eventIdFor("STAFF_TASK", "task_1", USER), idA);
check("алфавіт Google (a-v, 0-9)", /^[a-v0-9]{5,1024}$/.test(idA), idA);
check("інша задача — інший id", idA !== eventIdFor("STAFF_TASK", "task_2", USER), eventIdFor("STAFF_TASK", "task_2", USER));
check("інша людина — інший id", idA !== eventIdFor("STAFF_TASK", "task_1", "usr_інший"), eventIdFor("STAFF_TASK", "task_1", "usr_інший"));
check("інша сутність — інший id", idA !== eventIdFor("DELIVERY_ROUTE", "task_1", USER), eventIdFor("DELIVERY_ROUTE", "task_1", USER));

/* ── Подія на весь день ─────────────────────────────────────────────── */

const day = allDayEvent("2026-09-24");
check("початок — та сама доба", day.start.date === "2026-09-24", day.start.date);
check("кінець — наступна доба (Google рахує до, не включно)", day.end.date === "2026-09-25", day.end.date);
check("кінець місяця не ламається", allDayEvent("2026-09-30").end.date === "2026-10-01", allDayEvent("2026-09-30").end.date);
check("високосний лютий", allDayEvent("2028-02-28").end.date === "2028-02-29", allDayEvent("2028-02-28").end.date);

/* ── Подія з часом ──────────────────────────────────────────────────── */

// 15:30 за Києвом улітку — це 12:30 UTC.
const summer = timedEvent(new Date("2026-07-15T12:30:00Z"), 30);
check("літній настінний час київський", summer.start.dateTime === "2026-07-15T15:30:00", summer.start.dateTime);
check("пояс названо явно", summer.start.timeZone === "Europe/Kyiv", summer.start.timeZone);
check("кінець через 30 хвилин", summer.end.dateTime === "2026-07-15T16:00:00", summer.end.dateTime);

// Взимку Київ на дві години попереду UTC — саме тут гинуть наївні +3.
const winter = timedEvent(new Date("2026-12-15T08:00:00Z"), 30);
check("зимовий настінний час київський", winter.start.dateTime === "2026-12-15T10:00:00", winter.start.dateTime);

// Через північ: 23:50 + 30 хв.
const night = timedEvent(new Date("2026-07-15T20:50:00Z"), 30);
check("перехід через північ", night.end.dateTime === "2026-07-16T00:20:00", night.end.dateTime);

/* ── Відбиток змісту ────────────────────────────────────────────────── */

const base: DesiredEvent = {
  entity: "STAFF_TASK",
  entityId: "task_1",
  summary: "Забрати документи в Кунанця",
  description: "до 24.09",
  location: null,
  day: "2026-09-24",
  at: null,
  minutes: null,
};

check("однаковий зміст — однаковий відбиток", contentHash(base) === contentHash({ ...base }), contentHash(base).slice(0, 12));
check("довгий заголовок обрізається", contentHash({ ...base, summary: "я".repeat(400) }).length === 32, "32 знаки хеша");
check("змінився заголовок — інший відбиток", contentHash(base) !== contentHash({ ...base, summary: "Інше" }), "інший");
check("змінився день — інший відбиток", contentHash(base) !== contentHash({ ...base, day: "2026-09-25" }), "інший");
check("змінився опис — інший відбиток", contentHash(base) !== contentHash({ ...base, description: "до 25.09" }), "інший");

/* ── Тіло події для Google ──────────────────────────────────────────── */

const body = googleEventBody(base, USER);
check("id той самий, що рахує eventIdFor", body.id === eventIdFor("STAFF_TASK", "task_1", USER), body.id);
check("подія на весь день", body.start.date === "2026-09-24", JSON.stringify(body.start));
check("заголовок на місці", body.summary === base.summary, body.summary);
check("видно, з чого подія зроблена", body.extendedProperties?.private?.budvikEntity === "STAFF_TASK", JSON.stringify(body.extendedProperties));
check("ключ запису на сайті теж", body.extendedProperties?.private?.budvikId === "task_1", "task_1");

const timedBody = googleEventBody(
  { ...base, day: null, at: new Date("2026-07-15T12:30:00Z"), minutes: 30, location: "Львів, Городоцька 1" },
  USER
);
check("подія з часом", timedBody.start.dateTime === "2026-07-15T15:30:00", JSON.stringify(timedBody.start));
check("місце передається", timedBody.location === "Львів, Городоцька 1", timedBody.location);

const long = googleEventBody({ ...base, summary: "я".repeat(400), description: "о".repeat(9000) }, USER);
check("довгий заголовок обрізано", (long.summary?.length ?? 0) <= 200, long.summary?.length);
check("довгий опис обрізано", (long.description?.length ?? 0) <= 8000, long.description?.length);

/* ── Підсумок ───────────────────────────────────────────────────────── */

console.log();
if (fails.length > 0) {
  console.log(`✖ провалено ${fails.length}: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("✔ усе зійшлося");
