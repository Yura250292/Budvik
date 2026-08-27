/**
 * Яка робоча збірка лежить у сховищі.
 *
 * Окремі роути від /api/app/version навмисно: ту адресу питає при кожному
 * запуску Kotlin-трекер, який зараз возять у машинах. Поки обидва застосунки в
 * обігу, спільний роут із перемикачем означав би, що помилка в новому коді
 * ламає перевірку оновлень на планшетах, які вже працюють.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import { fileSize } from "@/lib/r2";
import {
  STAFF_APK_KEY,
  STAFF_APK_VERSION_CODE,
  STAFF_APK_VERSION_NAME,
  STAFF_MIN_VERSION_CODE,
} from "@/lib/app-builds";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;

  /**
   * Заразом запам'ятовуємо, що саме стоїть на цьому пристрої.
   *
   * Той самий прийом, що в /api/app/version, але за іншим маркером: робоча
   * збірка називає себе BudvikStaff/<версія>. Без розділення офіс не відрізнив
   * би, хто вже переїхав із трекера, а хто ще ні — а це головне питання всього
   * переходу.
   */
  const installed = req.headers.get("user-agent")?.match(/BudvikStaff\/([\d.]+)/)?.[1];
  if (installed) {
    const key = `app:staff:installed:${auth.me.userId}`;
    await prisma.syncState
      .upsert({ where: { key }, create: { key, value: installed }, update: { value: installed } })
      .catch(() => {});
  }

  const sizeBytes = await fileSize(STAFF_APK_KEY);
  if (sizeBytes === null) {
    // Файлу немає — окремим кодом: сторінка показує «збірки ще немає», а не
    // мовчазну кнопку, яка нічого не завантажить.
    return NextResponse.json({ error: "Збірка ще не готова" }, { status: 503 });
  }

  return NextResponse.json(
    {
      versionCode: STAFF_APK_VERSION_CODE,
      versionName: STAFF_APK_VERSION_NAME,
      minVersionCode: STAFF_MIN_VERSION_CODE,
      sizeBytes,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
