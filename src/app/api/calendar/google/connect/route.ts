import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { STAFF_ROLES, requireRoles } from "@/lib/app/identity";
import { calendarMissingEnv, callbackUrl, NONCE_COOKIE, safeReturnTo } from "@/lib/calendar/config";
import { signState } from "@/lib/calendar/state";
import { authorizeUrl } from "@/lib/calendar/oauth";

/**
 * Початок підключення календаря: веде людину на екран згоди Google.
 *
 * Окремо від входу через next-auth (src/lib/auth.ts): там GoogleProvider —
 * це вхід ПОКУПЦЯ на вітрину, і додавати туди календарний дозвіл означало б
 * питати згоду на календар у кожного роздрібного клієнта.
 *
 * Nonce лягає і в підписаний state, і в HttpOnly-куку. Підпис доводить, що
 * підключення почали ми; кука — що його почав цей самий браузер. Без другої
 * половини чужа сторінка могла б підсунути людині свій код авторизації.
 *
 * УВАГА для робочої збірки: Google не пускає OAuth усередині WebView
 * (disallowed_useragent), тож кнопка в застосунку мусить відкривати
 * системний браузер, а не власне вікно.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, STAFF_ROLES, { withProfile: true });
  if (!auth.ok) return auth.response;

  const missing = calendarMissingEnv();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Конектор календаря ще не налаштовано (немає ${missing.join(", ")})` },
      { status: 503 }
    );
  }

  const nonce = randomBytes(16).toString("base64url");
  const returnTo = safeReturnTo(new URL(req.url).searchParams.get("returnTo"));
  const state = signState({ userId: auth.me.userId, nonce, returnTo });

  const res = NextResponse.redirect(authorizeUrl(state, callbackUrl(req), auth.me.email));
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/calendar",
    maxAge: 600,
  });
  return res;
}
