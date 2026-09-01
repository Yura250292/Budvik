/**
 * Що з робочої збірки ще НЕ доїхало на планшети.
 *
 * З'явився після 01.09. Троє торгових півдня їздили без треку на збірці
 * 1.3.0, у якій буфер висів на мертвому запиті. Виправлення на той час уже
 * лежало в репозиторії три доби — але залитий APK зібрали за три з половиною
 * години ДО нього, а номер версії при цьому не змінився. З коду це не було
 * видно ніяк: у сховищі 1.3.0, на планшетах 1.3.0, усе сходиться.
 *
 * Тому питання «у полі вже з виправленням?» має мати відповідь однією
 * командою, а не археологією по датах комітів. Скрипт ділить відставання
 * на дві частини, бо доставляються вони по-різному:
 *
 *   • нативне (android/, ios/, modules/, app.config.ts, package.json) —
 *     тільки новим APK: `npm run build:staff` у mobile/ і заливання у сховище;
 *   • решта (JS/TSX) — «повітрям» через `npm run update:staff`, без
 *     перевстановлення, оновлення застосується при наступному запуску.
 *
 * Виходить із кодом 1, коли поле відстає: щоб команду можна було поставити
 * у CI і щоб вона мовчала лише тоді, коли справді все доїхало.
 */

import { execFileSync } from "node:child_process";
import { STAFF_APK_COMMIT, STAFF_OTA_COMMIT, STAFF_APK_VERSION_NAME } from "../src/lib/app-builds";

const git = (args: string[]) => execFileSync("git", args, { encoding: "utf-8" }).trim();

/**
 * Шляхи, зміна яких означає нову нативну оболонку.
 *
 * app.config.ts і package.json тут не за компанію: у першому живуть дозволи,
 * versionCode і runtimeVersion, у другому — залежності з нативним кодом.
 * Зміна будь-чого з цього не доїде оновленням, хоч і виглядає як звичайний TS.
 */
const NATIVE = [
  "mobile/android/",
  "mobile/ios/",
  "mobile/modules/",
  "mobile/app.config.ts",
  "mobile/package.json",
];

const isNative = (file: string) => NATIVE.some((p) => file.startsWith(p));

function commits(since: string): string[] {
  const out = git(["log", "--oneline", `${since}..HEAD`, "--", "mobile/"]);
  return out ? out.split("\n") : [];
}

function files(since: string): string[] {
  const out = git(["diff", "--name-only", `${since}..HEAD`, "--", "mobile/"]);
  return out ? out.split("\n") : [];
}

const apkLag = commits(STAFF_APK_COMMIT);
const nativeLag = files(STAFF_APK_COMMIT).filter(isNative);
const otaLag = commits(STAFF_OTA_COMMIT);

console.log(`Робоча збірка ${STAFF_APK_VERSION_NAME}`);
console.log(`  APK у сховищі зібрано з ${STAFF_APK_COMMIT}`);
console.log(`  Останнє оновлення повітрям — з ${STAFF_OTA_COMMIT}\n`);

/**
 * Відставання APK саме по собі — ще не біда: JS доїжджає повітрям, і поки в
 * ньому немає нативного, у полі працює HEAD. Тривожить лише те, що доставити
 * нічим не можна або ще не доставлено.
 */
if (nativeLag.length === 0 && otaLag.length === 0) {
  console.log(
    apkLag.length === 0
      ? "✅ У полі рівно те, що в HEAD."
      : "✅ У полі HEAD: APK старіший, але все після нього доставлено повітрям."
  );
  process.exit(0);
}

if (nativeLag.length > 0) {
  console.log(`❌ Потрібен НОВИЙ APK — змінено нативне (${nativeLag.length} файлів):`);
  for (const f of nativeLag) console.log(`     ${f}`);
  console.log("   mobile/: npm run build:staff → залити у сховище → підняти числа в src/lib/app-builds.ts\n");
}

if (otaLag.length > 0) {
  console.log(`⚠️  Не в полі: ${otaLag.length} комітів після останнього оновлення.`);
  for (const c of otaLag) console.log(`     ${c}`);
  console.log('   mobile/: npm run update:staff "що саме" → оновити STAFF_OTA_COMMIT\n');
}

process.exit(1);
