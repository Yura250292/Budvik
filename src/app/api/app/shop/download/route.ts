/**
 * Віддає збірку застосунку покупця — лише тим, хто увійшов.
 *
 * Файл лежить у R2, а не в репозиторії: збірка Expo важить понад сто
 * мегабайтів, а GitHub відмовляє в файлах понад сто. Та й тримати в історії
 * git по бінарнику на кожен реліз означало б репозиторій, який із часом
 * неможливо клонувати.
 *
 * Байти йдуть з CDN Cloudflare напряму, не через цю функцію: проксіювати
 * такі обсяги через Vercel — це і час виконання, і трафік, за який платимо
 * двічі. Перевірка ролі лишається тут, а посилання підписане й живе кілька
 * хвилин — поділитися ним не встигнеш.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { signedUrl } from "@/lib/r2";
import { SHOP_APK_KEY } from "@/lib/app-builds";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "MANAGER", "SALES"];

export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!role || !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });
  }

  let url: string;
  try {
    url = await signedUrl(SHOP_APK_KEY);
  } catch (e) {
    console.error("[app/shop/download] не вдалося підписати посилання:", e);
    return NextResponse.json({ error: "Збірка тимчасово недоступна" }, { status: 503 });
  }

  /**
   * 302, а не проксі. Android завантажує за посиланням сам; ім'я файла
   * бере з ключа в R2, тому ключ і названий Budvik27-<версія>.apk.
   */
  return NextResponse.redirect(url, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
