/**
 * Перевірка стрічки торгового без бази: тексти, групування, межі часу.
 *
 *   npx tsx scripts/check-rep-feed.mts
 *
 * Падає (код 1), якщо хоч один рядок ✗. Живий прогін по базі — в
 * scripts/rep-feed-notify.mts.
 */
import {
  describe,
  docDayFloor,
  eventsWord,
  groupPush,
  inPushHours,
  shortName,
  uah,
} from "../src/lib/rep-feed/format";
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

console.log(failed ? `\n✗ помилок: ${failed}` : "\n✓ усе гаразд");
process.exit(failed ? 1 : 0);
