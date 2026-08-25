/**
 * Яка тестова збірка застосунку покупця лежить на сервері.
 *
 * Окремі роути від /api/app/version, а не спільні з параметром: трекер
 * торгових питає ту адресу при кожному запуску й порівнює числа зі своїми.
 * Додати туди перемикач означало б, що помилка в новому коді ламає перевірку
 * оновлень на планшетах, які возять у машині.
 */

import { stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Тільки керівники й торгові.
 *
 * Це тестова збірка, яка ходить у бойову базу і створює справжні замовлення:
 * списує залишок і піднімає менеджерів сповіщенням у Telegram. Роздавати її
 * покупцям до магазинів не можна.
 */
const ALLOWED_ROLES = ["ADMIN", "MANAGER", "SALES"];

const APK_PATH = path.join(process.cwd(), "assets", "app", "Budvik27.apk");

/**
 * Версія збірки. Мусить збігатися з version у mobile/app.json і
 * оновлюватись тим самим комітом, що й сам файл.
 */
const CURRENT_VERSION_CODE = 1;
const CURRENT_VERSION_NAME = "1.0.0";

export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!role || !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });
  }

  let sizeBytes: number;
  try {
    sizeBytes = (await stat(APK_PATH)).size;
  } catch {
    /*
     * Файлу немає — кажемо прямо і окремим кодом. Сторінка на 503 показує
     * «збірки ще немає», а не мовчазну кнопку, яка нічого не завантажить.
     */
    return NextResponse.json({ error: "Збірка ще не готова" }, { status: 503 });
  }

  return NextResponse.json(
    { versionCode: CURRENT_VERSION_CODE, versionName: CURRENT_VERSION_NAME, sizeBytes },
    { headers: { "Cache-Control": "no-store" } }
  );
}
