/**
 * Чи є кому віддати буфер треку — перевірка джерел, без пристрою.
 *
 * Точки лежать у SQLite і не гинуть від жодного перезапуску. Але лежати вони
 * можуть годинами: відправку запускає рекордер (а він мовчить, коли запис
 * зупинено), сторож (раз на чверть години, і на деяких планшетах не
 * прокидається зовсім) і кілька окремих місць. Досить прибрати одне з них —
 * і день доїде аж наступного дня, причому мовчки.
 *
 * Тому кожен зі шляхів нижче перевіряється окремо:
 *   npx tsx scripts/check-flush-triggers.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "src");
const read = (p: string) => readFileSync(join(root, p), "utf8");

let failed = 0;

function check(name: string, cond: boolean, hint?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${hint ? `\n      ${hint}` : ""}`);
  }
}

/** Чи є виклик усередині названої функції (до кінця файлу або до наступної). */
function insideFunction(source: string, fnName: string, needle: string): boolean {
  const start = source.indexOf(`export async function ${fnName}(`);
  if (start < 0) return false;
  const next = source.indexOf("\nexport ", start + 10);
  return source.slice(start, next < 0 ? undefined : next).includes(needle);
}

const controller = read("track/controller.ts");
const recorder = read("track/recorder.ts");
const watchdog = read("track/watchdog.ts");
const health = read("track/use-track-health.ts");
const shiftScreen = read("app/shift/index.tsx");

console.log("\nЗвідки запускається відправка буфера");
check("Рекордер — після кожної пачки фіксів", recorder.includes("maybeFlush()"));
check("Сторож — на кожне пробудження", watchdog.includes("maybeFlush()"));
check(
  "Кінець зміни віддає буфер",
  insideFunction(controller, "endShiftTracking", "flush("),
  "після stopTracking рекордер мовчить — інакше день лежатиме до сторожа"
);
check(
  "Пізнє закриття теж",
  insideFunction(controller, "stopEverything", "flush("),
  "цим шляхом іде закриття заднім числом"
);
check(
  "Вихід з акаунта — примусово",
  insideFunction(controller, "logoutAndStop", "flush(true)"),
  "інакше чужий день лишиться в планшеті назавжди"
);
check(
  "Відкриття застосунку на екрані",
  health.includes("flush()"),
  "поки трек не пишеться, іншого приводу відправити немає"
);
check("Кнопка «Надіслати зараз» на екрані зміни", shiftScreen.includes("flush()"));

console.log("\nЗапобіжники, без яких відправка не має сенсу");
check(
  "З буфера стирається лише підтверджене сервером",
  read("track/uploader.ts").includes("dropPoints(") &&
    !read("track/uploader.ts").includes("clearPoints()"),
  "зріз «перші N» зносить точки, записані під час відправки"
);
check(
  "Буфер переживає перезапуск процесу (SQLite, не пам'ять)",
  read("track/db.ts").includes("recordedAt TEXT PRIMARY KEY")
);

console.log(failed === 0 ? "\nУсе зійшлося.\n" : `\nНе зійшлося: ${failed}.\n`);
process.exit(failed === 0 ? 0 : 1);
