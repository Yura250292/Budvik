/**
 * Пряме посилання на файл збірки — щоб його можна було відкрити ПОЗА кабінетом.
 *
 * Навіщо окремо від /api/app/staff/download, який і так робить 302.
 *
 * Кабінет усередині старого трекера живе у WebView, і той перехоплює
 * завантаження так: якщо тип файла — APK, він кличе власне оновлення й тягне
 * СТАРИЙ трекер із /api/app/download. Тобто людина натиснула б «поставити нову
 * збірку» і отримала б перевстановлений старий застосунок.
 *
 * Обхід у тому, що посилання на ЧУЖИЙ хост трекер віддає системному браузеру
 * ще на етапі навігації (isOwnHost у CabinetActivity), не доходячи до
 * перехоплювача. Підписане посилання на сховище — саме чужий хост, і браузеру
 * не потрібна ні кукі, ні токен: підпис уже в самій адресі.
 *
 * Тому роут віддає адресу текстом, а не редіректом: сторінка отримує її
 * запитом (де кукі є) і вже потім веде людину прямо в сховище.
 */

import { NextResponse } from "next/server";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import { signedUrl } from "@/lib/r2";
import { STAFF_APK_KEY, STAFF_APK_VERSION_NAME } from "@/lib/app-builds";

export const dynamic = "force-dynamic";

/**
 * Година замість типових п'яти хвилин.
 *
 * Людина може відкрити сторінку, піти по планшет і повернутися; протухле
 * посилання дало б їй незрозумілу помилку сховища замість файла. Година — усе
 * ще короткий строк для посилання, яке не можна передати далі з користю:
 * збірка не секретна, але й розкидати її назовні не варто.
 */
const TTL_SECONDS = 60 * 60;

export async function GET(req: Request) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const url = await signedUrl(STAFF_APK_KEY, TTL_SECONDS);
    return NextResponse.json(
      { url, versionName: STAFF_APK_VERSION_NAME },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[app/staff/download-url] не вдалося підписати посилання:", e);
    return NextResponse.json({ error: "Збірка тимчасово недоступна" }, { status: 503 });
  }
}
