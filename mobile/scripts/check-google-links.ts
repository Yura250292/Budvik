/**
 * Звірка дубля google-links із оригіналом на сайті.
 *
 * Запуск:  npx tsx scripts/check-google-links.ts
 *
 * Заради чого. `src/lib/google-links.ts` — свідома копія `src/lib/maps/google-links.ts`
 * із сайту: застосунок не має доступу до коду сайту. Ціна дубля — розходження,
 * і воно проявиться не помилкою, а тим, що водій відкриє посилання й побачить
 * не ті адреси. Тому копію перевіряємо машинно, а не «пам'ятаємо».
 *
 * Перевіряємо не текст файлів (коментарі й імпорти там законно різні), а
 * ПОВЕДІНКУ: обидві реалізації на однакових точках мусять дати однакові URL.
 */

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  batchNavigateUrl,
  googleMapsLinks,
  googleMapsLinksFromHere,
  directionsUrl,
  fromHereUrl,
  pointUrl,
  navigateUrl,
  MAX_POINTS_PER_LINK,
  type MapPoint,
} from "../src/lib/google-links";

const HERE = dirname(fileURLToPath(import.meta.url));

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

async function main() {
const site = await import(join(HERE, "../../src/lib/maps/google-links.ts"));

check("Ліміт точок на посилання збігається", site.MAX_POINTS_PER_LINK === MAX_POINTS_PER_LINK, {
  сайт: site.MAX_POINTS_PER_LINK,
  застосунок: MAX_POINTS_PER_LINK,
});

/** Двадцять п'ять точок — типовий довгий день, який Google не бере одним лінком. */
const many = Array.from({ length: 25 }, (_, i) => ({
  lat: 49.84 + i * 0.001,
  lng: 24.03 + i * 0.001,
}));

const cases: Array<[string, MapPoint[]]> = [
  ["порожній список", []],
  ["одна точка", many.slice(0, 1)],
  ["дві точки", many.slice(0, 2)],
  ["рівно ліміт", many.slice(0, MAX_POINTS_PER_LINK)],
  ["ліміт + 1", many.slice(0, MAX_POINTS_PER_LINK + 1)],
  ["довгий день (25)", many],
];
for (const [name, points] of cases) {
  const a = JSON.stringify(site.googleMapsLinks(points));
  const b = JSON.stringify(googleMapsLinks(points));
  check(`googleMapsLinks: ${name}`, a === b, { сайт: a.slice(0, 120), застосунок: b.slice(0, 120) });
}

/**
 * Те саме для дороги «від того місця, де водій зараз».
 *
 * Ця функція і є свіжий доказ, що звірка потрібна: сайт отримав її в
 * d64f7a8, копія в застосунку лишилася без неї — і водій у застосунку
 * місяць їздив за посиланням, яке починалося з першої точки маршруту.
 */
for (const [name, points] of cases) {
  const a = JSON.stringify(site.googleMapsLinksFromHere(points));
  const b = JSON.stringify(googleMapsLinksFromHere(points));
  check(`googleMapsLinksFromHere: ${name}`, a === b, {
    сайт: a.slice(0, 120),
    застосунок: b.slice(0, 120),
  });
}

/** Головне, заради чого вона існує: у першій частині НЕ МАЄ бути origin. */
const fromHere = googleMapsLinksFromHere(many);
check(
  "Перша частина без origin — старт ставить сам Google",
  !fromHere[0].url.includes("origin="),
  fromHere[0].url
);
check(
  "Наступні частини, навпаки, зі своїм origin",
  fromHere.slice(1).every((l) => l.url.includes("origin=")),
  fromHere.map((l) => l.url.includes("origin="))
);
check(
  "Одна точка теж дає посилання",
  googleMapsLinksFromHere(many.slice(0, 1)).length === 1
);

check(
  "directionsUrl однаковий",
  site.directionsUrl(many.slice(0, 4)) === directionsUrl(many.slice(0, 4))
);
check("fromHereUrl однаковий", site.fromHereUrl(many.slice(0, 4)) === fromHereUrl(many.slice(0, 4)));
check("pointUrl однаковий", site.pointUrl(many[0]) === pointUrl(many[0]));
check(
  "navigateUrl (Google) однаковий",
  site.navigateUrl(many[0], "google") === navigateUrl(many[0], "google")
);
check(
  "navigateUrl (Waze) однаковий",
  site.navigateUrl(many[0], "waze") === navigateUrl(many[0], "waze")
);
check(
  "Waze веде саме в навігацію",
  navigateUrl(many[0], "waze").includes("navigate=yes"),
  navigateUrl(many[0], "waze")
);

/**
 * Пачка «наступних точок» — те, що відкривається після кожної відмітки.
 *
 * Помилка тут коштує дорожче за решту: у пачці з ОДНІЄЇ точки посилання на
 * кілька точок показало б екран попереднього перегляду замість навігації, і
 * водій за кермом мусив би ще раз тицьнути «Почати».
 */
const batchCases: Array<[string, MapPoint[], "google" | "waze"]> = [
  ["порожня пачка (Google)", [], "google"],
  ["одна точка (Google)", many.slice(0, 1), "google"],
  ["одна точка (Waze)", many.slice(0, 1), "waze"],
  ["три точки (Google)", many.slice(0, 3), "google"],
  ["три точки (Waze)", many.slice(0, 3), "waze"],
  ["пʼять точок (Google)", many.slice(0, 5), "google"],
  ["десять точок (Google)", many.slice(0, 10), "google"],
];
for (const [name, points, app] of batchCases) {
  check(
    `batchNavigateUrl однаковий: ${name}`,
    site.batchNavigateUrl(points, app) === batchNavigateUrl(points, app),
    { сайт: site.batchNavigateUrl(points, app), застосунок: batchNavigateUrl(points, app) }
  );
}
check("Порожня пачка не дає посилання", batchNavigateUrl([], "google") === "");
check(
  "Одна точка веде навігацією, а не переглядом",
  batchNavigateUrl(many.slice(0, 1), "google") === pointUrl(many[0])
);
check(
  "Waze бере лише першу точку пачки",
  batchNavigateUrl(many.slice(0, 3), "waze") === navigateUrl(many[0], "waze")
);

/**
 * Десять точок мусять доїхати ВСІ.
 *
 * Тут був запас «мінус одна на старт», успадкований від посилання з origin,
 * — а origin у цій формі не передається взагалі. Через нього десята точка
 * зникала з посилання мовчки: у списку десять адрес, у навігаторі девʼять.
 * Рахуємо саме координати в адресі: девʼять проміжних плюс призначення.
 */
{
  const ten = many.slice(0, 10);
  const url = batchNavigateUrl(ten, "google");
  const wp = decodeURIComponent((url.match(/[&?]waypoints=([^&]*)/) ?? ["", ""])[1]);
  const count = (wp ? wp.split("|").length : 0) + 1; // + призначення
  check("Пачка з десяти точок везе всі десять", count === 10, { у_посиланні: count, url });
  const last = ten[9];
  check(
    "Остання точка пачки — призначення",
    url.includes(`destination=${Number(last.lat.toFixed(6))},${Number(last.lng.toFixed(6))}`),
    url
  );
}

/** Кожна наступна частина мусить стартувати там, де скінчилася попередня. */
const links = googleMapsLinks(many);
check("Довгий день ділиться більш ніж на одне посилання", links.length > 1, links.length);
check(
  "Частини стикуються без розриву",
  links.every((l) => l.points >= 2),
  links.map((l) => l.points)
);

console.log(failed === 0 ? "\nУсе зійшлося." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
}

main();
