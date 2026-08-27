/**
 * Віддає APK застосунку — лише тим, хто увійшов.
 *
 * Файл лежить у assets/app/, а не в public/: усе з public/ Next віддає
 * статикою без жодної перевірки, тобто збірку міг би завантажити
 * будь-хто, кому дали адресу. Застосунок ходить у бойову базу, тож
 * роздавати його відкрито не варто.
 *
 * Планшети отримують APK файлом, не через Play Market — свого магазину
 * в компанії немає, а Play вимагав би підпис релізним ключем і
 * обґрунтування фонової геолокації.
 */

import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";

export const dynamic = "force-dynamic";

const APK_PATH = path.join(process.cwd(), "assets", "app", "BudvikTracker.apk");

export async function GET(req: Request) {
  /**
   * Дві авторизації, як у роутах зміни: кукі для браузера і Bearer для
   * самого застосунку — щоб він колись міг оновлювати себе тим же
   * посиланням.
   */
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;

  let apk: Buffer;
  try {
    apk = await readFile(APK_PATH);
  } catch {
    // Файл не доїхав у збірку — кажемо прямо, а не віддаємо 0 байт,
    // бо порожній APK Android встановить як «пошкоджений пакет».
    console.error("[app/download] APK не знайдено:", APK_PATH);
    return NextResponse.json(
      { error: "Збірка тимчасово недоступна" },
      { status: 503 }
    );
  }

  return new NextResponse(new Uint8Array(apk), {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": 'attachment; filename="BudvikTracker.apk"',
      "Content-Length": String(apk.length),
      // Кожна нова збірка їде під тим самим URL, тож кешувати не можна:
      // торговий отримав би стару версію і не зрозумів чому.
      "Cache-Control": "no-store",
    },
  });
}
