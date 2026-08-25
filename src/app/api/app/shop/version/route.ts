/**
 * Яка збірка застосунку покупця лежить на сервері.
 *
 * Окремі роути від /api/app/version, а не спільні з параметром: трекер
 * торгових питає ту адресу при кожному запуску й порівнює числа зі своїми.
 * Додати туди перемикач означало б, що помилка в новому коді ламає перевірку
 * оновлень на планшетах, які возять у машині.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fileSize } from "@/lib/r2";
import { SHOP_APK_KEY, SHOP_APK_VERSION_CODE, SHOP_APK_VERSION_NAME } from "@/lib/app-builds";

export const dynamic = "force-dynamic";

/**
 * Тільки керівники й торгові.
 *
 * Збірка ходить у бойову базу і створює справжні замовлення: списує залишок
 * і піднімає менеджерів сповіщенням у Telegram. Роздавати її покупцям до
 * магазинів не можна.
 */
const ALLOWED_ROLES = ["ADMIN", "MANAGER", "SALES"];

export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!role || !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });
  }

  const sizeBytes = await fileSize(SHOP_APK_KEY);
  if (sizeBytes === null) {
    // Файлу немає — окремим кодом. Сторінка на 503 показує «збірки ще немає»,
    // а не мовчазну кнопку, яка нічого не завантажить.
    return NextResponse.json({ error: "Збірка ще не готова" }, { status: 503 });
  }

  return NextResponse.json(
    {
      versionCode: SHOP_APK_VERSION_CODE,
      versionName: SHOP_APK_VERSION_NAME,
      sizeBytes,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
