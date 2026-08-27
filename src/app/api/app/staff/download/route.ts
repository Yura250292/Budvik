/**
 * Віддає робочу збірку — лише тим, хто увійшов.
 *
 * Файл лежить у R2, а не в репозиторії: збірка Expo важить понад сто мегабайтів,
 * а GitHub відмовляє в файлах понад сто. Байти йдуть із CDN Cloudflare напряму —
 * проксіювати такі обсяги через Vercel означало б платити за трафік двічі.
 *
 * Bearer тут рівноправний із кукі навмисно: цим самим посиланням застосунок
 * оновлює себе, а власної сесії в браузері він не має.
 */

import { NextResponse } from "next/server";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import { signedUrl } from "@/lib/r2";
import { STAFF_APK_KEY } from "@/lib/app-builds";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;

  let url: string;
  try {
    url = await signedUrl(STAFF_APK_KEY);
  } catch (e) {
    console.error("[app/staff/download] не вдалося підписати посилання:", e);
    return NextResponse.json({ error: "Збірка тимчасово недоступна" }, { status: 503 });
  }

  /** 302, а не проксі: Android завантажує сам, ім'я файла бере з ключа в R2. */
  return NextResponse.redirect(url, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
