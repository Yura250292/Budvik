/**
 * Кладе робочу збірку (ua.budvik.staff) у сховище, звідки її роздає
 * /api/app/staff/download.
 *
 * Запуск:
 *   npx tsx scripts/publish-staff-apk.mts ~/Downloads/BudvikStaff.apk
 *
 * Три запобіжники, і кожен — про помилку, яка коштує дорого:
 *
 * 1. Ключ уже зайнятий → відмова. Ключ версіонований навмисно (BudvikStaff-1.1.0.apk):
 *    попередня збірка лишається доступною, тож відкотитися можна зміною одного
 *    рядка в app-builds.ts. Перезаписати ключ означало б втратити цю можливість
 *    саме тоді, коли вона потрібна.
 *
 * 2. Підпис. Інший ключ підпису = «пакет конфліктує»: оновлення не стане поверх,
 *    і всім, хто вже поставив застосунок, довелося б зносити його руками — разом
 *    із невідправленим буфером точок. Звіряємо з тим, чим підписана попередня
 *    збірка (див. scripts/check-apk-signature.mjs).
 *
 * 3. Версія у файлі vs. версія в коді. STAFF_APK_VERSION_CODE у app-builds.ts —
 *    це те, з чим застосунок порівнює себе. Розбіжність дає або вічну кнопку
 *    «Оновити», або відсутність оновлень узагалі.
 */

import { readFile, stat } from "fs/promises";
import { execFileSync } from "child_process";

/**
 * Ключі R2 лежать у .env, і поза Next їх ніхто не підвантажує.
 *
 * Без цього рядка S3Client отримує undefined замість ключів і падає з
 * «Resolved credential object is not valid» — повідомленням, яке звучить як
 * «ключі невірні», хоча насправді їх просто не прочитали. Той самий прийом
 * уже вживають інші скрипти, що ходять у сховище.
 */
try { (await import("dotenv")).config(); } catch { /* оточення вже задане */ }

const { fileSize, uploadFile } = await import("../src/lib/r2");
import {
  STAFF_APK_KEY,
  STAFF_APK_VERSION_CODE,
  STAFF_APK_VERSION_NAME,
} from "../src/lib/app-builds";

const CONTENT_TYPE = "application/vnd.android.package-archive";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Вкажіть шлях до APK: npx tsx scripts/publish-staff-apk.mts <файл.apk>");
    process.exit(1);
  }

  const info = await stat(path).catch(() => null);
  if (!info) {
    console.error(`Файла немає: ${path}`);
    process.exit(1);
  }

  console.log(`Збірка:  ${path} (${(info.size / 1024 / 1024).toFixed(1)} МБ)`);
  console.log(`Ключ:    ${STAFF_APK_KEY}`);
  console.log(`Версія:  ${STAFF_APK_VERSION_NAME} (versionCode ${STAFF_APK_VERSION_CODE})`);

  const existing = await fileSize(STAFF_APK_KEY);
  if (existing !== null) {
    console.error(
      `\nЗа цим ключем уже лежить файл (${(existing / 1024 / 1024).toFixed(1)} МБ).\n` +
        `Підніміть версію в mobile/app.config.ts і STAFF_APK_* у src/lib/app-builds.ts,\n` +
        `щоб ключ став новим. Перезапис заборонено: попередня збірка — це відкат.`
    );
    process.exit(1);
  }

  /**
   * Підпис перевіряємо власним розбором, бо apksigner і keytool у цьому
   * оточенні недоступні. Інструмент звірено з apksigner у CI трекера — збіг
   * байт у байт (див. пам'ять про ключ підпису).
   */
  try {
    const out = execFileSync("node", ["scripts/check-apk-signature.mjs", path], {
      encoding: "utf8",
    });
    console.log("\n— Підпис —");
    console.log(out.trim());
    console.log("\nЗвірте відбиток із тим, яким підписані попередні збірки ua.budvik.staff.");
  } catch (e) {
    console.error("Не вдалося прочитати підпис:", e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (!process.argv.includes("--yes")) {
    console.log("\nПеревірили відбиток? Повторіть запуск із --yes, щоб залити.");
    process.exit(0);
  }

  const bytes = await readFile(path);
  await uploadFile(bytes, STAFF_APK_KEY, CONTENT_TYPE);
  const uploaded = await fileSize(STAFF_APK_KEY);
  console.log(`\nЗалито: ${STAFF_APK_KEY} (${((uploaded ?? 0) / 1024 / 1024).toFixed(1)} МБ)`);
  console.log("Сторінки /sales/app і /driver/app покажуть картку нової збірки.");
}

main().catch((e) => {
  console.error("ПАДІННЯ:", e);
  process.exit(1);
});
