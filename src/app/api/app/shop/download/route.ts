/**
 * Віддає тестову збірку застосунку покупця — лише тим, хто увійшов.
 *
 * Файл лежить у assets/app/, а не в public/: усе з public/ Next віддає
 * статикою без жодної перевірки, тобто збірку міг би завантажити будь-хто,
 * кому дали адресу. Застосунок ходить у бойову базу й створює справжні
 * замовлення.
 */

import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "MANAGER", "SALES"];

const APK_PATH = path.join(process.cwd(), "assets", "app", "Budvik27.apk");

export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!role || !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });
  }

  let apk: Buffer;
  try {
    apk = await readFile(APK_PATH);
  } catch {
    // Не віддаємо 0 байт: порожній APK Android встановить як «пошкоджений пакет».
    return NextResponse.json({ error: "Збірка ще не готова" }, { status: 503 });
  }

  return new NextResponse(new Uint8Array(apk), {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": 'attachment; filename="Budvik27.apk"',
      "Content-Length": String(apk.length),
      // Кожна нова збірка їде під тим самим URL — кешувати не можна.
      "Cache-Control": "no-store",
    },
  });
}
