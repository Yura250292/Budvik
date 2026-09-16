/**
 * Перевірка пропозицій у воркері й стрічці без бази: тексти, ключі, вікна
 * часу, посилання, перемикачі в профілі, відбір тижневого списку.
 *
 *   npx tsx scripts/check-outreach-worker.mts
 *
 * Падає (код 1), якщо хоч один рядок ✗. Живий прогін закриття пропозицій —
 * scripts/outreach-settle-dry.mts.
 */
import {
  describeOutreachList,
  describeOutreachResult,
  inDigestWindow,
  inPushHours,
  isKyivFriday,
  isOutreachListTime,
  kyivWeekday,
  OUTREACH_LIST_HOUR,
  TYPE_LABELS,
  uah,
  weekStart,
} from "../src/lib/rep-feed/format";
import { PUSH_CATEGORIES } from "../src/lib/rep-feed/prefs";
import { FEED_FILTERS, feedHref, isRepFeedType, REP_FEED_TYPES } from "../src/lib/rep-feed/types";
import { isInternalCounterparty } from "../src/lib/rep-feed/internal";
import { kyivDaysBetween, outreachResultDedupKey } from "../src/lib/rep-feed/outreach-results";
import {
  outreachListDedupKey,
  refusesMessages,
  selectOutreachTargets,
  type OutreachContactInfo,
} from "../src/lib/rep-feed/outreach-list";
import { isOutreachTableMissing, kyivWallClock } from "../src/lib/outreach/settle";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

// ---- «Пропозиція спрацювала» ----
const res = describeOutreachResult({ name: "Заяць", kind: "Повернути", sentDaysAgo: 6, amount: 12400 });
check("спрацювала: заголовок", res.title === "Пропозиція спрацювала: Заяць", res);
check("спрацювала: вид · коли · сума", res.body === `Повернути · написали 6 днів тому · взяв на ${uah(12400)} ₴`, res);
const resNoSum = describeOutreachResult({ name: "Заяць", kind: "Акція", sentDaysAgo: 1, amount: null });
check("спрацювала: без суми — без «взяв на», «вчора»", resNoSum.body === "Акція · написали вчора", resNoSum);
const resToday = describeOutreachResult({ name: null, kind: "Борг", sentDaysAgo: 0, amount: 0 });
check("спрацювала: без імені → Клієнт, сума 0 не пишеться", resToday.title === "Пропозиція спрацювала: Клієнт" && resToday.body === "Борг · написали сьогодні", resToday);
const resLong = describeOutreachResult({ name: "ФОП Заяць Іван Петрович (магазин Будматеріали, Стрий)", kind: "Повернути", sentDaysAgo: 3, amount: 1 });
check("спрацювала: довге ім'я обрізано, заголовок ≤ 48", resLong.title.length <= 48 && resLong.title.endsWith("…"), resLong.title);

// ---- «Кому написати» ----
const one = describeOutreachList([{ name: "Заяць", daysSinceLast: 75 }]);
check("список 1: заголовок", one.title === "Кому написати цього тижня: 1", one);
check("список 1: тіло без «і ще»", one.body === "Заяць (75 дн)", one);
const three = describeOutreachList([
  { name: "Заяць", daysSinceLast: 75 },
  { name: "Химич", daysSinceLast: 64.4 },
  { name: "Галан", daysSinceLast: 41 },
]);
check("список 3: усі три в тілі, дні округлено", three.title === "Кому написати цього тижня: 3" && three.body === "Заяць (75 дн) · Химич (64 дн) · Галан (41 дн)", three);
const five = describeOutreachList(
  ["Заяць", "Химич", "Галан", "Кунанець", "Дзюба"].map((name, i) => ({ name, daysSinceLast: 90 - i }))
);
check("список 5: три в тілі і «ще 2»", five.title === "Кому написати цього тижня: 5" && five.body === "Заяць (90 дн) · Химич (89 дн) · Галан (88 дн) і ще 2", five);

// ---- ключі ----
check("ключ результату", outreachResultDedupKey("o1") === "REP_OUTREACH_RESULT:o1");
check("ключ списку: понеділок тижня", outreachListDedupKey(weekStart("2026-09-15"), "u1") === "REP_OUTREACH_LIST:2026-09-14:u1");
check("ключ списку однаковий увесь тиждень", outreachListDedupKey(weekStart("2026-09-17"), "u1") === outreachListDedupKey(weekStart("2026-09-14"), "u1"));

// ---- вівторок і година ----
const tue = (hhmm: string) => new Date(`2026-09-15T${hhmm}:00+03:00`);
check("вівторок за Києвом = 2", kyivWeekday(tue("12:00")) === 2);
check("вт 13:59 — ще ні", !isOutreachListTime(tue("13:59")));
check("вт 14:00 — так", isOutreachListTime(tue("14:00")));
check("вт 16:59 — так (запізнення до трьох годин)", isOutreachListTime(tue("16:59")));
check("вт 17:00 — вже ні", !isOutreachListTime(tue("17:00")));
check("пн 14:00 — ні", !isOutreachListTime(new Date("2026-09-14T14:00:00+03:00")));
check("ср 15:00 — ні", !isOutreachListTime(new Date("2026-09-16T15:00:00+03:00")));
// 21:30Z понеділка = 00:30 вівторка за Києвом: день уже вівторок, а година не та
const monNightUtc = new Date("2026-09-14T21:30:00Z");
check("пн 21:30Z = вт 00:30 Києва: вівторок, але поза годиною", kyivWeekday(monNightUtc) === 2 && !isOutreachListTime(monNightUtc));
// 11:30Z вівторка = 14:30 Києва — у UTC ще 11-та, рахуємо за Києвом
check("вт 11:30Z = 14:30 Києва — так", isOutreachListTime(new Date("2026-09-15T11:30:00Z")));
check("вт 23:30 Києва (20:30Z) — вівторок, поза годиною", kyivWeekday(new Date("2026-09-15T20:30:00Z")) === 2 && !isOutreachListTime(new Date("2026-09-15T20:30:00Z")));
// зимовий час: 27.10.2026 — вівторок, UTC+2
check("зима: вт 27.10 12:00Z = 14:00 Києва — так", isOutreachListTime(new Date("2026-10-27T12:00:00Z")));
check("зима: вт 27.10 11:59Z = 13:59 Києва — ні", !isOutreachListTime(new Date("2026-10-27T11:59:00Z")));
check("вікно списку = inDigestWindow від 14", OUTREACH_LIST_HOUR === 14 && inDigestWindow(tue("15:00"), OUTREACH_LIST_HOUR));
check("п'ятниця не зламалась: пт 23:30 Києва — так, сб 00:30 — ні", isKyivFriday(new Date("2026-09-18T20:30:00Z")) && !isKyivFriday(new Date("2026-09-18T21:30:00Z")));

// ---- тихі години ----
check("усе вікно списку всередині годин пушів (14:00–16:59)", ["14:00", "15:30", "16:59"].every((t) => inPushHours(tue(t))));
check("результат уночі чекає: 02:00 — тихо, 07:59 — тихо, 08:00 — можна", !inPushHours(tue("02:00")) && !inPushHours(tue("07:59")) && inPushHours(tue("08:00")));

// ---- дні між відправкою й покупкою ----
check("київські дні: пн 23:30 → вт 00:30 — це вже «вчора»", kyivDaysBetween(new Date("2026-09-14T20:30:00Z"), new Date("2026-09-14T21:30:00Z")) === 1);
check("київські дні: вт 00:30 → вт 23:00 — «сьогодні»", kyivDaysBetween(new Date("2026-09-14T21:30:00Z"), new Date("2026-09-15T20:00:00Z")) === 0);
check("стінний час: літо +3", kyivWallClock(new Date("2026-09-15T07:30:00Z")).toISOString() === "2026-09-15T10:30:00.000Z", kyivWallClock(new Date("2026-09-15T07:30:00Z")));
check("стінний час: зима +2", kyivWallClock(new Date("2026-10-27T08:30:00Z")).toISOString() === "2026-10-27T10:30:00.000Z", kyivWallClock(new Date("2026-10-27T08:30:00Z")));

// ---- посилання ----
check("результат → картка клієнта", feedHref(REP_FEED_TYPES.OUTREACH_RESULT, "c1") === "/sales/clients/c1");
check("результат без клієнта → null", feedHref(REP_FEED_TYPES.OUTREACH_RESULT, null) === null);
check("список → сторінка пропозицій, без relatedId", feedHref(REP_FEED_TYPES.OUTREACH_LIST, null) === "/sales/outreach");
check("дзвінки → сторінка пропозицій", feedHref(REP_FEED_TYPES.CALL_LIST, null) === "/sales/outreach");
const TAP = /^\/(sales|driver|warehouse)(\/[\w\-/]*)?$/;
check("обидві цілі проходять білий список тапів", TAP.test("/sales/outreach") && TAP.test("/sales/clients/cmf3x0abc0001"));
check("нові типи — типи стрічки", isRepFeedType("REP_OUTREACH_RESULT") && isRepFeedType("REP_OUTREACH_LIST"));

// ---- реєстрація ----
for (const t of [REP_FEED_TYPES.OUTREACH_RESULT, REP_FEED_TYPES.OUTREACH_LIST]) {
  check(`${t}: є перемикач у профілі`, PUSH_CATEGORIES.some((c) => c.type === t));
  check(`${t}: є назва в журналі`, !!TYPE_LABELS[t]);
  check(`${t}: у фільтрі «Підказки»`, (FEED_FILTERS.find((f) => f.key === "tips")?.types as readonly string[] | null)?.includes(t) === true);
}
check("перемикачі: підписи «Кому написати» і «Пропозиції спрацювали»", PUSH_CATEGORIES.some((c) => c.label === "Кому написати") && PUSH_CATEGORIES.some((c) => c.label === "Пропозиції спрацювали"));

// ---- відбір тижневого списку ----
const ok: OutreachContactInfo = { primaryPhoneE164: "+380671234567", phone: null, marketingOptOutAt: null, marketingConsent: "UNKNOWN", preferredChannel: null };
const info = new Map<string, OutreachContactInfo>([
  ["a", ok],
  ["b", ok],
  ["c", ok],
  ["d", ok],
  ["e", { ...ok, primaryPhoneE164: null, phone: null }],
  ["f", { ...ok, marketingOptOutAt: new Date("2026-09-01T00:00:00Z") }],
  ["g", { ...ok, marketingConsent: "REFUSED" }],
  ["h", ok],
  ["i", ok],
  ["j", { ...ok, primaryPhoneE164: null, phone: "067-765-43-21" }],
  ["k", ok],
  ["l", { ...ok, preferredChannel: "NONE" }],
  ["m", ok],
]);
const cand = (id: string, kind: "REACTIVATE" | "CHURN_RISK" | "COLLECT_DEBT" | "DEVELOP", amountPeriod: number, daysSinceLast: number, name = `Клієнт ${id}`) => ({ counterpartyId: id, name, kind, amountPeriod, daysSinceLast });
const picked = selectOutreachTargets(
  [
    cand("a", "REACTIVATE", 0, 70),
    cand("b", "CHURN_RISK", 5000, 20),
    cand("c", "COLLECT_DEBT", 90000, 70),
    cand("d", "REACTIVATE", 0, 80, "Склад ( Дубляни)"),
    cand("e", "REACTIVATE", 0, 61),
    cand("f", "REACTIVATE", 0, 62),
    cand("g", "REACTIVATE", 0, 63),
    cand("h", "REACTIVATE", 0, 64),
    cand("i", "REACTIVATE", 0, 65),
    cand("j", "REACTIVATE", 0, 95),
    cand("k", "DEVELOP", 20000, 3),
    cand("l", "REACTIVATE", 0, 66),
    cand("m", "CHURN_RISK", 1200, 30),
  ],
  info,
  new Set(["h"]),
  (c) => isInternalCounterparty(c.name, new Set())
);
check(
  "відбір: лише REACTIVATE/CHURN_RISK, без своїх, без телефону, відписаних і тих, кому писали; оборот, потім недавніші",
  picked.map((p) => p.counterpartyId).join() === "b,m,i,a,j",
  picked.map((p) => p.counterpartyId)
);
check("відбір: мобільний із сирого phone годиться", picked.some((p) => p.counterpartyId === "j"));
check("відбір: не більше п'яти", selectOutreachTargets(Array.from({ length: 9 }, (_, i) => cand(`z${i}`, "REACTIVATE", 0, 60 + i)), new Map(Array.from({ length: 9 }, (_, i) => [`z${i}`, ok])), new Set(), () => false).length === 5);
check("відмова писати: відписка / REFUSED / «не турбувати» / звичайний", refusesMessages({ ...ok, marketingOptOutAt: new Date() }) && refusesMessages({ ...ok, marketingConsent: "REFUSED" }) && refusesMessages({ ...ok, preferredChannel: "NONE" }) && !refusesMessages(ok));

// ---- немає таблиці ----
check("немає таблиці: сирий запит 42P01", isOutreachTableMissing(new Error('Raw query failed. Code: `42P01`. Message: `relation "ClientOutreach" does not exist`')));
check("немає таблиці: P2021 моделі", isOutreachTableMissing(Object.assign(new Error("The table `public.ClientOutreach` does not exist in the current database."), { code: "P2021" })));
check("чужа таблиця — не наш випадок", !isOutreachTableMissing(new Error('relation "Counterparty" does not exist')));
check("таймаут — не наш випадок", !isOutreachTableMissing(new Error("timeout")));

console.log(failed ? `\n✗ помилок: ${failed}` : "\n✓ усе гаразд");
process.exit(failed ? 1 : 0);
