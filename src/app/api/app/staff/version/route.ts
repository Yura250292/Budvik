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
import { requireRoles, STAFF_ROLES } from "@/lib/app/identity";
import { fileSize } from "@/lib/r2";
import {
  STAFF_APK_KEY,
  STAFF_APK_VERSION_CODE,
  STAFF_APK_VERSION_NAME,
  STAFF_MIN_VERSION_CODE,
} from "@/lib/app-builds";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, STAFF_ROLES);
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

  /**
   * Скарга шару треку — якщо застосунок її прислав.
   *
   * Цей роут навмисно став несучим для діагностики, і причина конкретна.
   * Пульс планшета (`/api/track/heartbeat`) збирається з тринадцяти читань
   * SQLite; журнал подій і буфер точок живуть там само. Коли база треку не
   * відкривається, замовкає все одразу — і з сервера зламаний планшет
   * невідрізненний від вимкненого.
   *
   * 10.09.2026 три планшети мали застосунок відкритим у межах сорока хвилин
   * (це видно з відмітки вище, яку пише сам застосунок), а шар треку не сказав
   * нічого. Тепер він скаже: проба їде параметром саме цього запиту, бо він на
   * тих планшетах проходить.
   *
   * Пишемо в SyncState, а не в нову колонку: діагностика не варта міграції на
   * проді, а ключ-значення для таких відміток тут уже використовується.
   */
  const probe = new URL(req.url).searchParams.get("probe");
  if (probe) {
    const key = `app:staff:probe:${auth.me.userId}`;
    const value = probe.slice(0, 300);
    await prisma.syncState
      .upsert({ where: { key }, create: { key, value }, update: { value } })
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
