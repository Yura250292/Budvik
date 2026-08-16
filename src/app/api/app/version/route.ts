/**
 * Яка версія застосунку лежить на сервері.
 *
 * Застосунок питає це при запуску й порівнює зі своєю. Якщо серверна
 * новіша — у меню профілю з'являється «Оновити застосунок». Без такої
 * перевірки торговий не має жодного способу дізнатися, що вийшла нова
 * збірка: свого магазину в компанії немає, а Play Market ми не
 * використовуємо.
 */

import { stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { verifyDeviceToken } from "@/lib/track/device-token";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["SALES", "DRIVER", "ADMIN", "MANAGER"];

const APK_PATH = path.join(process.cwd(), "assets", "app", "BudvikTracker.apk");

/**
 * Версія збірки, що лежить у assets/app/.
 *
 * Мусить збігатися з versionCode у app/build.gradle.kts трекера й
 * оновлюватись тим самим комітом, що й сам APK.
 *
 * Числа тут, а не з двійкового AndroidManifest усередині APK: розбір
 * того формату — окрема залежність, яка ламається від зміни формату
 * заради двох чисел. А так версія видна в дифі поруч із файлом, і
 * розбіжність помітна одразу.
 *
 * Наслідок помилки м'який в обидва боки: забули підняти — торговий не
 * побачить кнопку і оновиться зі сторінки /sales/app; підняли зайве —
 * побачить кнопку й перевстановить ту саму збірку.
 */
const CURRENT_VERSION_CODE = 2;
const CURRENT_VERSION_NAME = "1.1";

export async function GET(req: Request) {
  /** Дві авторизації, як у решти роутів застосунку: Bearer і кукі. */
  const device = await verifyDeviceToken(req.headers.get("authorization"));
  const session = device ? null : await getServerSession(authOptions);
  const role = device?.role ?? (session?.user as { role?: string } | undefined)?.role;

  if (!role || !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });
  }

  let sizeBytes: number;
  try {
    sizeBytes = (await stat(APK_PATH)).size;
  } catch {
    /*
     * Файлу немає — кажемо прямо. Застосунок на такій відповіді просто
     * не показує кнопку: пропонувати оновлення, яке не завантажиться,
     * гірше, ніж не пропонувати нічого.
     */
    console.error("[app/version] APK не знайдено:", APK_PATH);
    return NextResponse.json({ error: "Збірка недоступна" }, { status: 503 });
  }

  return NextResponse.json(
    {
      versionCode: CURRENT_VERSION_CODE,
      versionName: CURRENT_VERSION_NAME,
      sizeBytes,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
