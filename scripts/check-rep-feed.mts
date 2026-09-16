/**
 * Перевірка стрічки торгового без бази: тексти, групування, межі часу.
 *
 *   npx tsx scripts/check-rep-feed.mts
 *
 * Падає (код 1), якщо хоч один рядок ✗. Живий прогін по базі — в
 * scripts/rep-feed-notify.mts.
 */
import {
  arrivalWindow,
  describeRoute,
  describeWatch,
  describePriceUp,
  describeWeek,
  isKyivFriday,
  weekStart,
  inDigestWindow,
  priceBasis,
  priceWindow,
  routeDayLabel,
  daysAgo,
  describe,
  describeArrival,
  previousWorkday,
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
import { REQUEST_KINDS, RequestError, validateRequestInput } from "../src/lib/office-requests";
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
check("різні цілі → сторінка стрічки", mixed.target === "/sales/feed", mixed);
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
// Не /sales/clients?filter=…: білий список тапів застосунку не пропускає query.
check("дзвінки → «Кому написати», без relatedId", feedHref(REP_FEED_TYPES.CALL_LIST, null) === "/sales/outreach");

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

// ---- прихід ----
check("прихід → сторінка дня шляхом", feedHref(REP_FEED_TYPES.ARRIVAL, "2026-09-14") === "/sales/arrivals/2026-09-14");
check("шлях приходу проходить білий список тапів", /^\/(sales|driver|warehouse)(\/[\w\-/]*)?$/.test("/sales/arrivals/2026-09-14"));
const arr = describeArrival([
  { name: "SOMA FIX Піна-клей монтажна 750 мл", clients: ["Химич", "Кунанець", "Галан"] },
  { name: "Круг відрізний ATAMAN 125", clients: ["Галан"] },
  { name: "Дріт в'язальний", clients: [] },
  { name: "Четвертий", clients: ["А"] },
  { name: "П'ятий", clients: ["Б"] },
]);
check("прихід: заголовок з множиною", arr.title === "Приїхало: 5 позицій для ваших клієнтів", arr);
check("прихід: кількість клієнтів у дужках, «і ще»", arr.body === "SOMA FIX Піна-клей монтажна 7… (3 кл.) · Круг відрізний ATAMAN 125 (1 кл.) · Дріт в'язальний і ще 2", arr);
check("прихід: довга назва обрізається", describeArrival([{ name: "SOMA FIX Піна-клей монтажна зимова 750 мл", clients: [] }]).body.endsWith("…"));
check("прихід: одна позиція", describeArrival([{ name: "Піна", clients: ["Химич"] }]).title === "Приїхало: 1 позиція для ваших клієнтів");
check("прихід: дві позиції", describeArrival([{ name: "А", clients: [] }, { name: "Б", clients: [] }]).title === "Приїхало: 2 позиції для ваших клієнтів");
check("попередній робочий: пн → пт", previousWorkday("2026-09-14") === "2026-09-11");
check("попередній робочий: ср → вт", previousWorkday("2026-09-16") === "2026-09-15");
const win = arrivalWindow("2026-09-14");
check("вікно понеділка: з пт 10:00 до пн 10:00 (стінний час як UTC)", win.from.toISOString() === "2026-09-11T10:00:00.000Z" && win.to.toISOString() === "2026-09-14T10:00:00.000Z", win);
check("prefs: прихід серед категорій", PUSH_CATEGORIES.some((c) => c.type === REP_FEED_TYPES.ARRIVAL));

// ---- маршрутний лист ----
check("день маршруту: сьогодні/завтра", routeDayLabel("2026-09-14", "2026-09-14") === "сьогодні" && routeDayLabel("2026-09-15", "2026-09-14") === "завтра");
check("день маршруту: далі — день тижня й дата", /16\.09/.test(routeDayLabel("2026-09-16", "2026-09-14")), routeDayLabel("2026-09-16", "2026-09-14"));
const rt = describeRoute({ name: "Химич", number: "6553", amount: 12400, day: "2026-09-15", today: "2026-09-14", driver: "Пайда Василь", sheetNumber: "1865" });
check("маршрут: з водієм", rt.title === "Поїде завтра: Химич" && rt.body === "Накладна №6553 · 12 400 ₴ · лист №1865 · водій Пайда Василь", rt);
const rtNo = describeRoute({ name: "Химич", number: "6553", amount: 100, day: "2026-09-15", today: "2026-09-14", driver: null, sheetNumber: "1865" });
check("маршрут: без водія — без слова «водій»", !rtNo.body.includes("водій"), rtNo);
check("маршрут → документ", feedHref(REP_FEED_TYPES.ROUTE, "d1") === "/sales/orders/d1");

// ---- товар під запит ----
check("запит → сторінка запитів", feedHref(REP_FEED_TYPES.WATCH, "p1") === "/sales/watches" && feedHref(REP_FEED_TYPES.WATCH, null) === "/sales/watches");
check("сторінка запитів проходить білий список тапів", /^\/(sales|driver|warehouse)(\/[\w\-/]*)?$/.test("/sales/watches"));
const wt = describeWatch({ name: "SOMA FIX Піна монтажна 750", sku: "12345", free: 24 });
check("запит: текст", wt.title === "Приїхало під ваш запит: SOMA FIX Піна монтажна 750" && wt.body === "Вільно 24 шт · Арт. 12345", wt);
check("запит: без артикула", describeWatch({ name: "Піна", sku: null, free: 1 }).body === "Вільно 1 шт");

// ---- подорожчання ----
check("подорожчання → сторінка дня", feedHref(REP_FEED_TYPES.PRICE_UP, "2026-09-14") === "/sales/price-changes/2026-09-14");
const pbW = priceBasis({ oldPrice: 150, newPrice: 160, oldWholesale: 120, newWholesale: 130 });
check("база: опт, коли є з обох боків", pbW?.basis === "wholesale" && pbW.pct === 8.3, pbW);
const pbR = priceBasis({ oldPrice: 100, newPrice: 110, oldWholesale: null, newWholesale: 90 });
check("база: роздріб, коли опту немає зі старого боку", pbR?.basis === "retail" && pbR.pct === 10, pbR);
check("база: стара ціна нуль → нема з чим порівнювати", priceBasis({ oldPrice: 0, newPrice: 10, oldWholesale: null, newWholesale: null }) === null);
const pu = describePriceUp([{ name: "SOMA FIX Піна 750", pct: 8.3 }, { name: "Диски 125", pct: 12 }]);
check("подорожчання: текст", pu.title === "Подорожчало: 2 позиції для ваших клієнтів" && pu.body === "SOMA FIX Піна 750 +8% · Диски 125 +12%", pu);
const pw = priceWindow("2026-09-14");
check("вікно цін понеділка: пт 09:00 — пн 09:00 за Києвом", pw.from.toISOString() === "2026-09-11T06:00:00.000Z" && pw.to.toISOString() === "2026-09-14T06:00:00.000Z", pw);
const k = (hhmm: string) => new Date(`2026-09-14T${hhmm}:00+03:00`);
check("зведення: 10:59 для 10 — так, 12:59 — так, 13:00 — ні, 09:59 — ні", inDigestWindow(k("10:59"), 10) && inDigestWindow(k("12:59"), 10) && !inDigestWindow(k("13:00"), 10) && !inDigestWindow(k("09:59"), 10));

// ---- підсумок тижня ----
check("тиждень → головна", feedHref(REP_FEED_TYPES.WEEK, null) === "/sales");
check("понеділок тижня: пт 18.09 → пн 14.09, нд 20.09 → пн 14.09, пн → той самий", weekStart("2026-09-18") === "2026-09-14" && weekStart("2026-09-20") === "2026-09-14" && weekStart("2026-09-14") === "2026-09-14");
check("п'ятниця за Києвом: пт 18.09 23:30 Києва (20:30Z) — так; сб 00:30 Києва (пт 21:30Z) — ні", isKyivFriday(new Date("2026-09-18T20:30:00Z")) && !isKyivFriday(new Date("2026-09-18T21:30:00Z")));
const wk = describeWeek({ revenue: 312400, prevRevenue: 278900, docs: 41, collected: 280100, clients: 23, place: 3, of: 9 });
check("тиждень: текст", wk.title === "Ваш тиждень: 312 400 ₴ продажів" && wk.body === "+12% до минулого · накладних 41 · клієнтів 23 · зібрано 280 100 ₴ · місце 3 з 9", wk);
const wkDown = describeWeek({ revenue: 10000, prevRevenue: 20000, docs: 0, collected: 0, clients: 0, place: 1, of: 1 });
check("тиждень: падіння з мінусом, без місця в команді з одного", wkDown.body === "−50% до минулого", wkDown);
const wkTiny = describeWeek({ revenue: 11057, prevRevenue: 37, docs: 2, collected: 0, clients: 2, place: 6, of: 6 });
check("тиждень: мізерна база — без відсотка", !wkTiny.body.includes("%"), wkTiny);
const wkJump = describeWeek({ revenue: 90000, prevRevenue: 6000, docs: 1, collected: 0, clients: 1, place: null, of: 6 });
check("тиждень: стрибок понад 300% — без відсотка", !wkJump.body.includes("%"), wkJump);
const wkNeg = describeWeek({ revenue: -291026, prevRevenue: 72000, docs: 12, collected: 156948, clients: 12, place: null, of: 6 });
check("тиждень: від'ємний оборот названо прямо, без відсотка", wkNeg.title === "Ваш тиждень: −291 026 ₴ чистого обороту з поверненнями" && !wkNeg.body.includes("%"), wkNeg);

// ---- заявки в офіс ----
check("заявка → сторінка заявок", feedHref(REP_FEED_TYPES.REQUEST_DONE, "r1") === "/sales/requests" && feedHref(REP_FEED_TYPES.REQUEST_DONE, null) === "/sales/requests");
check("види заявок унікальні", new Set(REQUEST_KINDS.map((k) => k.key)).size === REQUEST_KINDS.length);
const tryV = (x: unknown) => { try { return validateRequestInput(x); } catch (e) { return e instanceof RequestError ? e.message : "інша помилка"; } };
check("заявка: без виду — помилка", typeof tryV({ text: "завести клієнта" }) === "string");
check("заявка: закороткий текст — помилка", typeof tryV({ kind: "OTHER", text: "ok" }) === "string");
check("заявка: відстрочка без клієнта — помилка", typeof tryV({ kind: "CREDIT", text: "дайте 14 днів" }) === "string");
const okNew = tryV({ kind: "NEW_CLIENT", text: "  ФОП Химич, ЄДРПОУ 123  " });
check("заявка: новий клієнт без картки — так, текст обрізано", typeof okNew === "object" && okNew.text === "ФОП Химич, ЄДРПОУ 123" && okNew.counterpartyId === null, okNew);
const okCredit = tryV({ kind: "CREDIT", text: "дайте 14 днів", counterpartyId: "c1" });
check("заявка: відстрочка з клієнтом — так", typeof okCredit === "object" && okCredit.counterpartyId === "c1", okCredit);

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
check("внутрішній: (системний адмін)", isInternalCounterparty("Рудько Роман (системний адмін)", staff));

// ---- налаштування ----
check("prefs: null → нічого не вимкнено", parsePushPrefs(null).mutedTypes.length === 0);
const prefs = parsePushPrefs({ mutedTypes: ["REP_PAYMENT", "REP_NOPE", 5, "REP_PAYMENT"] });
check("prefs: невідоме й дублі відкинуто", prefs.mutedTypes.join() === "REP_PAYMENT", prefs);
check("prefs: isPushMuted", isPushMuted(prefs, REP_FEED_TYPES.PAYMENT) && !isPushMuted(prefs, REP_FEED_TYPES.VISIT));
// Винятки — типи, пуш яких налаштувань стрічки не читає, тож перемикач у
// профілі нічого б не вимикав:
//   TASK_DONE — рядок і пуш іде офісному автору задачі (tasks/notify.ts);
//   MEETING   — підсумок наради розсилає керівник свідомо, пуш шле роут у
//               мить розсилки (meetings/share.ts).
const NO_CATEGORY: readonly string[] = [REP_FEED_TYPES.TASK_DONE, REP_FEED_TYPES.MEETING];
check(
  "prefs: усі типи стрічки торгового є в переліку категорій",
  Object.values(REP_FEED_TYPES)
    .filter((t) => !NO_CATEGORY.includes(t))
    .every((t) => PUSH_CATEGORIES.some((c) => c.type === t))
);
check("docDayBounds: доба як UTC", docDayBounds("2026-09-14").from.toISOString() === "2026-09-14T00:00:00.000Z" && docDayBounds("2026-09-14").to.toISOString() === "2026-09-14T23:59:59.999Z");

console.log(failed ? `\n✗ помилок: ${failed}` : "\n✓ усе гаразд");
process.exit(failed ? 1 : 0);
