/**
 * Звірка паритету з Kotlin-трекером.
 *
 * Запуск:  npx tsx scripts/check-parity.ts
 *
 * Заради чого. Нова збірка замінює BudvikTracker на планшетах людей у полі.
 * Якщо в ній чогось бракує, це виявиться не помилкою, а тим, що людина не
 * зможе зробити те, що робила вчора — і в найгіршу мить. Тому перелік
 * можливостей старого застосунку звіряємо машинно, а не «пам'ятаємо».
 *
 * Перевіряємо наявність: кожній можливості Kotlin відповідає файл або виклик
 * у новій збірці. Це не доказ, що воно працює на пристрої — це доказ, що воно
 * взагалі є. Робота на пристрої перевіряється живою збіркою.
 */

import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const KOTLIN = join(HERE, "../../../BudvikTracker/app/src/main/java/ua/budvik/tracker");

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const app = (rel: string) => read(join(APP, rel));

/** Можливість Kotlin → де вона живе в новій збірці. */
const FEATURES: Array<[string, string, string]> = [
  ["Вхід і токен пристрою",        "MainActivity",       "src/app/(tabs)/account.tsx"],
  ["Кабінет у WebView",            "CabinetActivity",    "src/app/cabinet.tsx"],
  ["Міст window.BudvikApp",        "AppBridge",          "src/lib/bridge.ts"],
  ["Фонова служба треку",          "TrackingService",    "src/track/recorder.ts"],
  ["Буфер точок на пристрої",      "Storage",            "src/track/db.ts"],
  ["Сторож треку",                 "TrackWatchdogWorker","src/track/watchdog.ts"],
  ["Спостереження після зміни",    "AfterShiftWatcher",  "src/track/after-shift.ts"],
  ["Стан зміни",                   "ShiftActivity",      "src/app/shift/index.tsx"],
  ["Фото одометра",                "OdometerActivity",   "src/app/shift/odometer.tsx"],
  ["Історія змін",                 "HistoryActivity",    "src/app/shift/history.tsx"],
  ["Пізнє закриття зміни",         "LateCloseActivity",  "src/app/shift/late-close.tsx"],
  ["Відкладена зміна",             "PendingShift",       "src/track/pending-shift.ts"],
  ["Довезти відкладену зміну",     "ShiftSyncWorker",    "src/track/watchdog.ts"],
  ["Стан пристрою для пульсу",     "DeviceState",        "src/track/device-state.ts"],
  ["Самооновлення застосунку",     "Api",                "src/lib/self-update.ts"],
  ["Запуск після ребуту",          "BootReceiver",       "src/track/task.ts"],
];

console.log("— Можливості —");
for (const [name, kotlin, file] of FEATURES) {
  const kotlinExists = existsSync(join(KOTLIN, `${kotlin}.kt`));
  const ours = app(file);
  check(`${name} (Kotlin ${kotlin})`, kotlinExists && ours.length > 0, {
    kotlin: kotlinExists,
    файл: file,
    порожній: ours.length === 0,
  });
}

console.log("\n— Роути API, які смикав трекер —");
const kotlinApi = read(join(KOTLIN, "Api.kt"));
const endpoints = [...new Set(kotlinApi.match(/"\/api\/[a-z0-9/_-]+/g) ?? [])].map((m) => m.slice(1));
const staff = app("src/api/staff.ts") + app("src/lib/self-update.ts") + app("src/app/(tabs)/account.tsx");
/**
 * Два роути в новій збірці свідомо інші.
 *
 * /api/app/{version,download} лишаються за старим трекером: у нього свій
 * лічильник версій (6 / «1.5»), у нової збірки — свій (10100 / «1.1.0»).
 * Спільний роут означав би, що трекер бачить оновлення, якого для нього немає,
 * а нова збірка не бачить жодного.
 *
 * /api/device/login злився з /api/v1/auth/login: вхід один на покупця й
 * працівника, і саме там розходяться області токенів.
 */
const RENAMED: Record<string, string> = {
  "/api/app/version": "/api/app/staff/version",
  "/api/app/download": "/api/app/staff/download",
  "/api/device/login": "/auth/login",
};
for (const ep of endpoints) {
  const target = RENAMED[ep] ?? ep;
  const covered = staff.includes(target) || app("src/api/client.ts").includes(target);
  check(`${ep}${RENAMED[ep] ? ` → ${RENAMED[ep]}` : ""}`, covered);
}

console.log("\n— Міст: контракт із сайтом —");
const bridge = app("src/lib/bridge.ts");
for (const fn of ["openShift", "logout", "shiftStateJson", "appVersion", "appVersionCode", "downloadUpdate"]) {
  check(`window.BudvikApp.${fn}`, bridge.includes(fn));
}

console.log("\n— Свідомі відмінності (не прогалини) —");
const known: Array<[string, boolean, string]> = [
  [
    "BootReceiver: його дає сам expo-task-manager",
    true,
    "TaskBroadcastReceiver ловить BOOT_COMPLETED і відновлює зареєстровані завдання — " +
      "власного ресівера не потрібно (перевірено в його AndroidManifest.xml)",
  ],
  [
    "Сторож працює без мережі (власний нативний модуль)",
    read(join(APP, "modules/track-guard/android/src/main/java/expo/modules/trackguard/TrackGuardModule.kt"))
      .includes("BackgroundTaskWork") &&
      app("src/track/watchdog.ts").includes("scheduleOfflineGuard"),
    "expo-background-task зашиває NetworkType.CONNECTED; modules/track-guard ставить те саме " +
      "завдання без обмежень — як і робив Kotlin-трекер",
  ],
  [
    "Перепідписка, коли приймач замовк",
    app("src/track/health.ts").includes("ensureFreshFixes"),
    "hasStartedLocationUpdatesAsync каже «живо» навіть без фіксів годинами",
  ],
  [
    "CrashReporter: причина падіння їде полем lastError у пульсі",
    app("src/track/uploader.ts").includes("lastError"),
    "ApplicationExitInfo з Expo недоступний — лише помилки JS",
  ],
  [
    "Обмеження батареї видно (головна причина дір у треку)",
    app("src/track/device-state.ts").includes("isBatteryOptimizationEnabledAsync"),
    "expo-battery це вміє — раніше поле хибно вважали недоступним",
  ],
];
for (const [name, ok, why] of known) check(`${name}`, ok, why);

console.log(failed === 0 ? "\nПаритет повний." : `\nПрогалин: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
