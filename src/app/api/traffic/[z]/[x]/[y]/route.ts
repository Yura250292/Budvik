/**
 * Тайли пробок TomTom — через нас, а не напряму з планшета.
 *
 * Причина проксі одна: ключ TomTom. Якби карта тягнула тайли сама, ключ
 * лежав би в NEXT_PUBLIC_ і його зчитав би будь-хто з відкритої вкладки,
 * а це чужий безкоштовний ліміт, який спалять за день.
 *
 * Без TOMTOM_API_KEY роут віддає 204: карта просто не показує пробки і
 * працює далі. Так само поводиться шар при будь-якій помилці TomTom —
 * пробки це прикраса поверх дороги, через них карта падати не має.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["DRIVER", "SALES", "ADMIN", "MANAGER"];

/**
 * relative0 — швидкість відносно вільного потоку плюс перекриті дороги.
 * Саме те, що потрібно водію: не «скільки км/год», а «тут стоїмо».
 */
const STYLE = "relative0";

/** Тайли живуть хвилину: пробки міняються повільніше, ніж їде планшет. */
const CACHE_SECONDS = 60;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new NextResponse(null, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return new NextResponse(null, { status: 403 });
  }

  const key = process.env.TOMTOM_API_KEY;
  // Ключа ще немає — це штатний стан, а не помилка.
  if (!key) return new NextResponse(null, { status: 204 });

  const { z, x, y } = await ctx.params;
  const zoom = Number(z);
  const tileX = Number(x);
  const tileY = Number(y);

  // Координати тайла беремо з URL — перевіряємо, щоб у запит до TomTom
  // не поїхало щось стороннє.
  const max = 2 ** zoom;
  const valid =
    Number.isInteger(zoom) &&
    zoom >= 0 &&
    zoom <= 22 &&
    Number.isInteger(tileX) &&
    Number.isInteger(tileY) &&
    tileX >= 0 &&
    tileX < max &&
    tileY >= 0 &&
    tileY < max;
  if (!valid) return new NextResponse(null, { status: 400 });

  const url =
    `https://api.tomtom.com/traffic/map/4/tile/flow/${STYLE}/${zoom}/${tileX}/${tileY}.png` +
    `?key=${encodeURIComponent(key)}&tileSize=256`;

  try {
    const res = await fetch(url, { next: { revalidate: CACHE_SECONDS } });
    // 204 від TomTom означає «на цьому тайлі даних про рух немає» —
    // передаємо як є, MapLibre такий тайл просто пропустить.
    if (res.status === 204 || !res.ok) {
      return new NextResponse(null, { status: res.ok ? 204 : 204 });
    }
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        // s-maxage кладе тайл у CDN Vercel: кілька планшетів в одному місті
        // дивляться ті самі тайли, і без спільного кешу кожен з них щохвилини
        // викликав функцію (а це окремий рахунок за кожен виклик). Кешована
        // відповідь віддається і без сесії, але тайл пробок — публічні дані
        // TomTom, а «прогріти» кеш без авторизації все одно неможливо:
        // промах кешу впирається в перевірку сесії вище.
        "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 4}`,
      },
    });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
