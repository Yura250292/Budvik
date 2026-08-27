/**
 * Вихід із робочої збірки на цьому пристрої.
 *
 * Одного clearToken() на боці застосунку замало: токен лишався б живим у базі,
 * і планшет, який передали іншій людині (або загубили), далі мав би право лити
 * трек і закривати зміни. Тому вихід гасить саме той токен, яким прийшов запит.
 *
 * Заразом чистимо кукі NextAuth: у WebView кабінету живе сесія, підсаджена
 * через /api/device/session, і без цього людина «вийшла» в застосунку, але
 * лишалася б залогіненою в кабінеті всередині нього.
 *
 * Токени магазину не чіпаємо — у торгового може стояти й застосунок покупця,
 * і вихід із роботи не має вибивати його звідти.
 */

import { NextResponse } from "next/server";
import { verifyDeviceToken, revokeDeviceToken } from "@/lib/track/device-token";

export const dynamic = "force-dynamic";

/** Ті самі імена, що ставить /api/device/session. */
const SESSION_COOKIES = ["next-auth.session-token", "__Secure-next-auth.session-token"];

export async function POST(req: Request) {
  const device = await verifyDeviceToken(req.headers.get("authorization"));

  /**
   * Відповідаємо 200 навіть на мертвий токен.
   *
   * Вихід — дія, яку не можна «не докінчити»: якщо застосунок отримає помилку,
   * він або лишить токен у себе, або зациклиться на повторах. А стан, до якого
   * веде виклик (токена немає), уже досягнутий.
   */
  if (device) await revokeDeviceToken(device.tokenId);

  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  for (const name of SESSION_COOKIES) {
    res.cookies.set(name, "", {
      httpOnly: true,
      secure: name.startsWith("__Secure-"),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  res.cookies.set("budvik_app", "", { httpOnly: false, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
