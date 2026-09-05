/**
 * Смуга кроків маршруту й текст водієві — без мережі й бази.
 *
 * Запуск: npx tsx scripts/check-route-progress.ts
 *
 * Дві речі, які не можна ламати непомітно. Перша: жовта кнопка картки —
 * єдина підказка логісту, що робити далі; помилка в її виведенні тиха, бо
 * кнопка все одно намальована. Друга: текст водієві їде в месенджер, і його
 * вже читали як інструкцію — зникла точка або обірвана частина посилання
 * коштують водієві години на трасі (03.09: у маршруті на 15 точок водій
 * отримував 13).
 */

import { buildDriverMessage, toTelegramHtml } from "../src/lib/routes/driver-message";
import { routeProgress } from "../src/lib/routes/progress";

let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

/** Точка з піном у картці клієнта. */
const pinned = (name: string, lat = 49.8, lng = 24.0) => ({
  address: `${name}, вул. Тестова 1`,
  counterparty: { name, deliveryLat: lat, deliveryLng: lng },
});
/** Точка без координати — у посилання не потрапляє. */
const noPin = (name: string) => ({ address: `${name}, вул. Тестова 2`, counterparty: { name } });

// --- Смуга кроків ---
const draft = { status: "PLANNED", driverId: null, stops: [] as ReturnType<typeof pinned>[] };
const empty = routeProgress(draft);
check("Порожня чернетка → крок 1, «Додати точку»", empty.current === 1 && empty.cta === "ADD_STOPS", empty);

const noDriver = routeProgress({ ...draft, stops: [pinned("А"), pinned("Б")] });
check(
  "Точки є, водія немає → крок 2 без кнопки, блокер NO_DRIVER",
  noDriver.current === 2 && noDriver.cta === null && noDriver.blocker === "NO_DRIVER",
  noDriver
);

const oneCoord = routeProgress({ status: "PLANNED", driverId: "d1", stops: [pinned("А"), noPin("Б")] });
check(
  "Одна координата на двох точках → блокер NO_COORDS",
  oneCoord.current === 2 && oneCoord.blocker === "NO_COORDS",
  oneCoord
);

const ready = routeProgress({ status: "PLANNED", driverId: "d1", stops: [pinned("А"), pinned("Б")] });
check("Водій і дві координати → «Прокласти маршрут»", ready.cta === "ORDER", ready);

const ordered = routeProgress({
  status: "PLANNED",
  driverId: "d1",
  stops: [pinned("А"), pinned("Б")],
  routeGeometry: { type: "LineString", coordinates: [] },
});
check("Порядок прокладено → крок 3, «Передати водію»", ordered.current === 3 && ordered.cta === "ASSIGN", ordered);

const handedNoOrder = routeProgress({ status: "ASSIGNED", driverId: "d1", stops: [pinned("А"), pinned("Б")] });
check(
  "Передали без прокладання → крок 2 «пропущено», поточний 4",
  handedNoOrder.steps[2] === "skipped" && handedNoOrder.current === 4 && handedNoOrder.cta === "SEND",
  handedNoOrder
);

const sent = routeProgress({
  status: "ASSIGNED",
  driverId: "d1",
  stops: [pinned("А"), pinned("Б")],
  linkSentAt: "2026-09-03T09:00:00.000Z",
});
check("Посилання надіслано → кроків не лишилось", sent.current === null && sent.cta === null, sent);

const stale = routeProgress({
  status: "ASSIGNED",
  driverId: "d1",
  stops: [pinned("А"), pinned("Б")],
  linkSentAt: "2026-09-03T09:00:00.000Z",
  linkStale: true,
});
check("Маршрут правили після надсилання → «Надіслати ще раз»", stale.current === 4 && stale.cta === "RESEND", stale);

const done = routeProgress({ status: "COMPLETED", driverId: "d1", stops: [pinned("А")] });
check("Завершений маршрут закритий, без дій", done.closed && done.current === null && done.cta === null, done);

const cancelled = routeProgress({ status: "CANCELLED", driverId: "d1", stops: [pinned("А")] });
check("Скасований маршрут закритий", cancelled.closed && cancelled.cta === null, cancelled);

// --- Текст водієві ---
const msg = buildDriverMessage({
  number: "МР-000003",
  day: "2026-09-02",
  driverName: "Кравцов Віталій",
  stops: [pinned("Коваль", 49.53, 23.98), noPin("Кравець"), pinned("Налисник", 49.26, 23.85)],
});
const lines = msg.text.split("\n");
check("Шапка: номер · дата · водій", lines[0] === "Маршрут МР-000003 · 02.09.2026 · Кравцов Віталій", lines[0]);
check("У списку ВСІ точки, включно з безпінною", msg.text.includes("2. Кравець"), lines.slice(1, 4));
check("Точка без піна помічена", lines[2].includes("⚠ немає точки на карті"), lines[2]);
check("Нумерація за маршрутом, не за координатами", lines[3].startsWith("3. Налисник"), lines[3]);
check("У посилання пішли лише точки з координатами", msg.withCoords === 2 && msg.missing === 1, msg);
check("Одне посилання — без нумерації частин", msg.text.includes("Google Maps (від вашого місця): https://"), true);
check("Підсумок про точки без координат", msg.text.includes("Увага: 1 точка без координат"), msg.text.slice(-120));

const many = buildDriverMessage({
  number: "МР-000004",
  day: "2026-09-03",
  driverName: null,
  stops: Array.from({ length: 11 }, (_, i) => pinned(`Клієнт ${i + 1}`, 49.5 + i / 100, 24 + i / 100)),
});
// Перша частина везе всі 10 наших точок: origin у ній не передається взагалі
// (його місце Google віддає живій позиції водія), тож ліміт api=1 — девʼять
// проміжних плюс призначення — витрачається саме на наші точки. Доти тут
// стояв запас «мінус одна на старт», і десята точка зникала з посилання
// мовчки. Хвіст стартує з останньої точки першої частини, щоб дорога не рвалася.
check("11 точок → дві частини 10 + 2", many.links.length === 2 && many.links[0].points === 10 && many.links[1].points === 2, many.links.map((l) => l.points));
check("Частини підписані «1/2» і «2/2»", many.text.includes("частина 1/2") && many.text.includes("частина 2/2"), true);
check("Перша частина названа стартом від водія", many.text.includes("частина 1/2 — від вашого місця"), many.text.slice(-260));
check("Стик частин: кінець першої = початок другої", many.links[1].url.includes("origin=49.59,24.09"), many.links[1].url.slice(0, 90));
check("Відмінки: «2 точки», не «2 точок»", many.text.includes("(2 точки)"), many.text.slice(-160));
check("Без водія — шапка без хвоста", many.text.startsWith("Маршрут МР-000004 · 03.09.2026\n"), many.text.slice(0, 40));

// Одна точка — теж маршрут: «я тут → клієнт». Доти посилання не будувалося
// взагалі, бо стартом була сама ж ця точка.
const single = buildDriverMessage({ number: "МР-1", day: "2026-09-03", driverName: null, stops: [pinned("Один")] });
check("Одна точка — посилання від місця водія до неї", single.links.length === 1 && single.links[0].points === 1, single.links);
check("У ньому немає origin — його підставить Google", !single.links[0].url.includes("origin="), single.links[0].url);

const noCoords = buildDriverMessage({ number: "МР-2", day: "2026-09-03", driverName: null, stops: [noPin("Без піна")] });
check("Без жодної координати посилань немає", noCoords.links.length === 0, noCoords.links);

// --- Telegram HTML ---
const risky = buildDriverMessage({
  number: "МР-5",
  day: "2026-09-03",
  driverName: null,
  stops: [pinned('ТзОВ "Альфа & Бета"', 49.1, 24.1), pinned("<Тест>", 49.2, 24.2)],
});
const html = toTelegramHtml(risky.text);
check("Telegram: & екрановано", html.includes("&amp;") && !/&(?!amp;|lt;|gt;)/.test(html), html.slice(0, 120));
check("Telegram: кутові дужки екрановані", html.includes("&lt;Тест&gt;") && !html.includes("<Тест>"), html.slice(0, 160));
check("Telegram: посилання не поламане", html.includes("https://www.google.com/maps/dir/"), true);

console.log(failed === 0 ? "\nУсе зійшлося." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
