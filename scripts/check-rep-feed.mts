/**
 * Перевірка стрічки торгового без бази: тексти, групування, межі часу.
 *
 *   npx tsx scripts/check-rep-feed.mts
 *
 * Падає (код 1), якщо хоч один рядок ✗. Живий прогін по базі — в
 * scripts/rep-feed-notify.mts.
 */
import {
  daysAgo,
  describe,
  describeCallList,
  describeVisit,
  docDayBounds,
  docDayFloor,
  eventsWord,
  groupPush,
  inPushHours,
  shortName,
  uah,
} from "../src/lib/rep-feed/format";
import { isPushMuted, parsePushPrefs, PUSH_CATEGORIES } from "../src/lib/rep-feed/prefs";
import { isWeekend } from "../src/lib/rep-feed/call-list";
import { isInternalCounterparty, nameKey } from "../src/lib/rep-feed/internal";
import { feedHref, isRepFeedType, REP_FEED_TYPES } from "../src/lib/rep-feed/types";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

// ---- числа й слова ----
check("uah без копійок і з пробілом", uah(8400.49) === "8 400", uah(8400.49));
check("uah від'ємне тримає мінус", uah(-1200) === "-1 200", uah(-1200));
check("eventsWord 1/2/5/11/21", [1, 2, 5, 11, 21].map(eventsWord).join() === "подія,події,подій,подій,подія");
check("shortName ріже довге", shortName("ФОП Химич Іван Петрович (магазин на Стрийській)").length <= 32);
check("shortName порожнє → Клієнт", shortName("  ") === "Клієнт");

// ---- тексти ----
const pay = describe({ type: REP_FEED_TYPES.PAYMENT, name: "Химич", amount: 8400, balance: 11600 });
check("оплата: заголовок", pay.title === "Химич заплатив 8 400 ₴", pay);
check("оплата: борг ≈ сальдо − оплата", pay.body === "Борг клієнта тепер ≈ 3 200 ₴", pay);
const payZero = describe({ type: REP_FEED_TYPES.PAYMENT, name: "Химич", amount: 8400, balance: 8400 });
check("оплата: борг закрито → ≈ 0", payZero.body === "Борг клієнта тепер ≈ 0 ₴", payZero);
const payOver = describe({ type: REP_FEED_TYPES.PAYMENT, name: "Химич", amount: 9000, balance: 8400 });
check("оплата: переплата не йде в мінус", payOver.body === "Борг клієнта тепер ≈ 0 ₴", payOver);
const payNoBal = describe({ type: REP_FEED_TYPES.PAYMENT, name: "Химич", amount: 100, balance: null });
check("оплата: без сальдо", payNoBal.body === "Оплата в касу", payNoBal);

const posted = describe({ type: REP_FEED_TYPES.DOC_POSTED, name: "Химич", number: "1234", amount: 12400 });
check("проведено", posted.title === "Проведено №1234" && posted.body === "Химич · 12 400 ₴", posted);
const picked = describe({ type: REP_FEED_TYPES.DOC_PICKED, name: "Химич", number: "1234", amount: 12400, lines: 14 });
check("зібрано з позиціями", picked.body === "Химич · 12 400 ₴ · 14 поз.", picked);
const ret = describe({ type: REP_FEED_TYPES.RETURN, name: "Химич", number: "1240", amount: -1200 });
check("повернення: мінус явний", ret.title === "Повернення від Химич" && ret.body === "№1240 · −1 200 ₴", ret);
const deliv = describe({ type: REP_FEED_TYPES.DOC_DELIVERED, name: null, number: "7", amount: 10 });
check("доставлено без імені → Клієнт", deliv.body === "Клієнт · 10 ₴", deliv);

// ---- групування ----
const one = groupPush([{ title: "A", body: "a", target: "/sales/orders/1" }]);
check("одна подія — як є", one.title === "A" && one.target === "/sales/orders/1", one);
const two = groupPush([
  { title: "A", body: "a", target: "/sales/orders/1" },
  { title: "B", body: "b", target: "/sales/orders/1" },
]);
check("дві з однією ціллю — ціль лишається", two.title === "2 події у клієнтів" && two.target === "/sales/orders/1", two);
check("дві — тіло з заголовків", two.body === "A · B", two);
const mixed = groupPush([
  { title: "A", body: "a", target: "/sales/orders/1" },
  { title: "B", body: "b", target: "/sales/clients/9" },
]);
check("різні цілі → головна", mixed.target === "/sales", mixed);
const five = groupPush(
  ["A", "B", "C", "D", "E"].map((t) => ({ title: t, body: "", target: "/sales/orders/1" }))
);
check("п'ять → перші три і «ще 2»", five.title === "5 подій у клієнтів" && five.body === "A · B · C і ще 2", five);
let threw = false;
try {
  groupPush([]);
} catch {
  threw = true;
}
check("порожній список — помилка", threw);

// ---- час ----
// 12.09.2026 14:00 Києва (літній час, UTC+3) → 11:00Z
const noonKyiv = new Date("2026-09-12T11:00:00Z");
check("docDayFloor: 2 дні тому, північ як UTC", docDayFloor(noonKyiv, 2).toISOString() === "2026-09-10T00:00:00.000Z", docDayFloor(noonKyiv, 2));
// 00:30 Києва 13.09 = 21:30Z 12.09 — київський день уже 13-й
const afterMidnight = new Date("2026-09-12T21:30:00Z");
check("docDayFloor: після київської півночі — новий день", docDayFloor(afterMidnight, 2).toISOString() === "2026-09-11T00:00:00.000Z", docDayFloor(afterMidnight, 2));
// перехід на зимовий час 25.10.2026: 26.10 10:00 Києва (UTC+2) = 08:00Z
const winter = new Date("2026-10-26T08:00:00Z");
check("docDayFloor: узимку день той самий", docDayFloor(winter, 1).toISOString() === "2026-10-25T00:00:00.000Z", docDayFloor(winter, 1));

const at = (hhmm: string) => new Date(`2026-09-12T${hhmm}:00+03:00`);
check("07:59 — тихо", !inPushHours(at("07:59")));
check("08:00 — можна", inPushHours(at("08:00")));
check("18:59 — можна", inPushHours(at("18:59")));
check("19:00 — тихо", !inPushHours(at("19:00")));

// ---- посилання ----
check("оплата → картка клієнта", feedHref(REP_FEED_TYPES.PAYMENT, "c1") === "/sales/clients/c1");
check("проведено → документ", feedHref(REP_FEED_TYPES.DOC_POSTED, "d1") === "/sales/orders/d1");
check("старий тип → документ (як було)", feedHref("WHOLESALE_ORDER_REQUEST", "d2") === "/sales/orders/d2");
check("без relatedId → null", feedHref(REP_FEED_TYPES.PAYMENT, null) === null);
check("isRepFeedType", isRepFeedType("REP_PAYMENT") && !isRepFeedType("REP_SOMETHING"));
check("візит → картка клієнта", feedHref(REP_FEED_TYPES.VISIT, "c1") === "/sales/clients/c1");
check("дзвінки → список клієнтів, без relatedId", feedHref(REP_FEED_TYPES.CALL_LIST, null) === "/sales/clients");

// ---- картка перед візитом ----
check("daysAgo 0/1/3/40", [0, 1, 3, 40].map(daysAgo).join("|") === "сьогодні|вчора|3 дні тому|40 днів тому");
const visitFull = describeVisit({
  name: "Химич", debt: 3200, overdue: 1200, oldestDays: 12, lastOrderDaysAgo: 40,
  recommend: ["Піна SOMA FIX 750", "Диски відрізні 125", "Дріт в'язальний", "Зайве"],
});
check("візит: заголовок", visitFull?.title === "Ви у Химич", visitFull);
check(
  "візит: борг, прострочка, останнє, три поради",
  visitFull?.body === "Борг 3 200 ₴ (прострочено 1 200, 12 дн) · останнє замовлення 40 днів тому · поповнити: Піна SOMA FIX 750, Диски відрізні 125, Дріт в'язальний",
  visitFull
);
const visitNoDebt = describeVisit({ name: "Химич", debt: 0, overdue: 0, oldestDays: 0, lastOrderDaysAgo: 2, recommend: ["Піна"] });
check("візит: без боргу — лише останнє й поради", visitNoDebt?.body === "останнє замовлення 2 дні тому · поповнити: Піна", visitNoDebt);
check("візит: нічого сказати → null", describeVisit({ name: "Химич", debt: 0, overdue: 0, oldestDays: 0, lastOrderDaysAgo: 5, recommend: [] }) === null);
const visitDebtOnly = describeVisit({ name: null, debt: 500, overdue: 0, oldestDays: 0, lastOrderDaysAgo: null, recommend: [] });
check("візит: лише борг без прострочки", visitDebtOnly?.body === "Борг 500 ₴" && visitDebtOnly.title === "Ви у Клієнт", visitDebtOnly);

// ---- список дзвінків ----
const call5 = describeCallList([
  { name: "Химич", action: "Забрати борг" }, { name: "Кунанець", action: "Ризик втрати" },
  { name: "Галан", action: "Відновити" }, { name: "Д", action: "Розпрацювати" }, { name: "Е", action: "Запропонувати бонус" },
]);
check("дзвінки: заголовок із кількістю", call5.title === "Кому подзвонити сьогодні: 5", call5);
check("дзвінки: три в тілі і «ще 2»", call5.body === "Химич — Забрати борг · Кунанець — Ризик втрати · Галан — Відновити і ще 2", call5);
const call1 = describeCallList([{ name: "Химич", action: "Забрати борг" }]);
check("дзвінки: один без «ще»", call1.body === "Химич — Забрати борг", call1);
check("вихідні: субота 12.09 і неділя 13.09", isWeekend(new Date("2026-09-12T09:00:00+03:00")) && isWeekend(new Date("2026-09-13T09:00:00+03:00")));
check("будень: понеділок 14.09", !isWeekend(new Date("2026-09-14T09:00:00+03:00")));
// 21:30Z неділі = 00:30 понеділка за Києвом: день тижня рахується за Києвом, не за UTC
check("понеділок 00:30 Києва (21:30Z неділі) — будень", !isWeekend(new Date("2026-09-13T21:30:00Z")));

// ---- внутрішні контрагенти ----
const staff = new Set(["Кулик Дмитро", "Передрій Дмитро", "Юрій Скуратов"].map(nameKey));
check("внутрішній: (співробітник)", isInternalCounterparty("Джумага Ігор (співробітник)", staff));
check("внутрішній: (торговий)", isInternalCounterparty("Пац Валентин (торговий)", staff));
check("внутрішній: Склад ( Дубляни)", isInternalCounterparty("Склад ( Дубляни)", staff));
check("внутрішній: Співробітники", isInternalCounterparty("Співробітники", staff));
check("внутрішній: повне ім'я торгового, з зайвими пробілами", isInternalCounterparty("Кулик  Дмитро ", staff));
check("не внутрішній: клієнт Кулик Дмитро Іванович", !isInternalCounterparty("Кулик Дмитро Іванович", staff));
check("внутрішній: слова переставлені, місто в дужках", isInternalCounterparty("Скуратов Юрій (Львів)", staff));
check("не внутрішній: три слова проти двох", !isInternalCounterparty("Кавецький Віктор Васильович(Львів)", new Set([nameKey("Кавецький Віктор")])));
check("не внутрішній: Складські системи ТОВ", !isInternalCounterparty("Складські системи ТОВ", staff));
check("не внутрішній: звичайний ФОП", !isInternalCounterparty("ФОП Химич Іван (м.Стрий)", staff));

// ---- налаштування ----
check("prefs: null → нічого не вимкнено", parsePushPrefs(null).mutedTypes.length === 0);
const prefs = parsePushPrefs({ mutedTypes: ["REP_PAYMENT", "REP_NOPE", 5, "REP_PAYMENT"] });
check("prefs: невідоме й дублі відкинуто", prefs.mutedTypes.join() === "REP_PAYMENT", prefs);
check("prefs: isPushMuted", isPushMuted(prefs, REP_FEED_TYPES.PAYMENT) && !isPushMuted(prefs, REP_FEED_TYPES.VISIT));
check("prefs: усі типи стрічки є в переліку категорій", Object.values(REP_FEED_TYPES).every((t) => PUSH_CATEGORIES.some((c) => c.type === t)));
check("docDayBounds: доба як UTC", docDayBounds("2026-09-14").from.toISOString() === "2026-09-14T00:00:00.000Z" && docDayBounds("2026-09-14").to.toISOString() === "2026-09-14T23:59:59.999Z");

console.log(failed ? `\n✗ помилок: ${failed}` : "\n✓ усе гаразд");
process.exit(failed ? 1 : 0);
