/**
 * Звірка правил черги відміток: застосунок і сайт.
 *
 * Запуск:  npx tsx scripts/check-visit-queue.ts
 *
 * Заради чого. Логіка черги продубльована свідомо — сайт і застосунок різні
 * збірки, спільного коду між ними немає. Але правила мусять збігатися: це той
 * самий екран дня, просто відкритий у браузері або в застосунку, і водій
 * переходить між ними в один день.
 *
 * Розбіжність тут не падає — вона проявляється тим, що відмітка, зроблена в
 * одному місці, поводиться інакше в іншому. Найдорожчий випадок: повторна
 * відмітка ДОДАЄТЬСЯ замість заміни, і на сервер їдуть обидві — спершу
 * виправлена, потім помилкова, яка її затирає.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(HERE, "../src/track/pending-visits.ts"), "utf8");
const web = readFileSync(join(HERE, "../../src/lib/track/pending-visits.ts"), "utf8");

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

/** Правило → як воно має виглядати в кожній реалізації. */
const RULES: Array<[string, RegExp, RegExp]> = [
  [
    "Повторна відмітка ЗАМІНЮЄ попередню (фільтр за stopKey)",
    /filter\(\s*\(\w+\)\s*=>\s*\w+\.stopKey\s*!==/,
    /filter\(\s*\(\w+\)\s*=>\s*\w+\.stopKey\s*!==/,
  ],
  [
    "4xx (крім 429) викидається з черги, а не тримається вічно",
    /status\s*>=\s*400\s*&&\s*status\s*<\s*500\s*&&\s*status\s*!==\s*429/,
    /status\s*>=\s*400\s*&&\s*res\.status\s*<\s*500\s*&&\s*res\.status\s*!==\s*429|res\.status\s*>=\s*400\s*&&\s*res\.status\s*<\s*500\s*&&\s*res\.status\s*!==\s*429/,
  ],
  [
    "Мережева помилка лишає відмітку в черзі",
    /left\.push\(entry\)/,
    /left\.push\(entry\)/,
  ],
];

for (const [name, appRe, webRe] of RULES) {
  const inApp = appRe.test(app);
  const inWeb = webRe.test(web);
  check(`${name}`, inApp && inWeb, { застосунок: inApp, сайт: inWeb });
}

/** Обидві реалізації мусять мати той самий набір дій. */
for (const fn of ["queueVisit", "flushPendingVisits", "listPendingVisits"]) {
  check(`Є ${fn}() в обох`, app.includes(fn) && web.includes(fn), {
    застосунок: app.includes(fn),
    сайт: web.includes(fn),
  });
}

/**
 * Найтонше: чергу треба віддавати ДО завантаження дня. Інакше сервер поверне
 * день без щойно зроблених відміток, і вони «зникнуть» з екрана.
 */
/*
 * У застосунку день читається через кеш запитів, тож обидва виклики стоять
 * поруч у queryFn (src/api/staff-queries.ts), а не на екрані. Перевіряємо саме
 * там — правило те саме, змінилося лише місце.
 */
const appDay = readFileSync(join(HERE, "../src/api/staff-queries.ts"), "utf8");
const webDay = readFileSync(join(HERE, "../../src/app/driver/tablet/page.tsx"), "utf8");
check(
  "Чергу віддаємо перед завантаженням дня (застосунок)",
  appDay.indexOf("flushPendingVisits") >= 0 &&
    appDay.indexOf("staffApi.day()") >= 0 &&
    appDay.indexOf("flushPendingVisits") < appDay.indexOf("staffApi.day()"),
  { flush: appDay.indexOf("flushPendingVisits"), day: appDay.indexOf("staffApi.day()") }
);
check(
  "Чергу віддаємо перед завантаженням дня (сайт)",
  /flushPendingVisits\(\)[\s\S]{0,200}?await load\(\)/.test(webDay),
  "у loadWithQueue"
);

console.log(failed === 0 ? "\nПравила збігаються." : `\nРозбіжностей: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
