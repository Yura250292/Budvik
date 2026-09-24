import { NextResponse } from "next/server";
import { STAFF_ROLES, requireRoles } from "@/lib/app/identity";
import { CALENDAR_SCOPE, callbackUrl, NONCE_COOKIE } from "@/lib/calendar/config";
import { verifyState } from "@/lib/calendar/state";
import { exchangeCode } from "@/lib/calendar/oauth";
import { saveConnection } from "@/lib/calendar/connection";

/**
 * Повернення з екрана згоди Google.
 *
 * Тут обробляються краї, на яких такі інтеграції зазвичай і сиплються:
 * людина натиснула «Скасувати», Google не віддав постійний дозвіл, людина
 * зняла галочку з календаря на екрані згоди. Кожен випадок має свій текст —
 * інакше людина п'ятий раз тисне «Підключити» й не розуміє, чому «готово»,
 * а в календарі порожньо.
 */
export const dynamic = "force-dynamic";

/** Повертає людину в кабінет із поміткою, що саме сталося — на той самий хост. */
function back(req: Request, returnTo: string, result: string): NextResponse {
  const url = new URL(returnTo, new URL(req.url).origin);
  url.searchParams.set("calendar", result);
  const res = NextResponse.redirect(url);
  res.cookies.delete(NONCE_COOKIE);
  return res;
}

export async function GET(req: Request) {
  const auth = await requireRoles(req, STAFF_ROLES);
  if (!auth.ok) return auth.response;

  const params = new URL(req.url).searchParams;
  const rawState = params.get("state") ?? "";
  const state = verifyState(rawState);

  // Підпис, строк життя, той самий браузер і та сама людина — усі чотири.
  if (!state) return NextResponse.json({ error: "Підключення застаріло. Спробуйте ще раз." }, { status: 400 });

  const nonce = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${NONCE_COOKIE}=`))
    ?.slice(NONCE_COOKIE.length + 1);

  if (!nonce || nonce !== state.nonce) {
    return NextResponse.json({ error: "Підключення почато в іншому браузері. Спробуйте ще раз." }, { status: 400 });
  }
  if (state.userId !== auth.me.userId) {
    return NextResponse.json({ error: "Підключення почала інша людина." }, { status: 400 });
  }

  // Людина натиснула «Скасувати» — це не помилка, нічого не зберігаємо.
  if (params.get("error")) return back(req, state.returnTo, "denied");

  const code = params.get("code");
  if (!code) return back(req, state.returnTo, "denied");

  const tokens = await exchangeCode(code, callbackUrl(req));

  /*
   * Найпідступніший випадок: людина вже давала дозвіл, і Google вирішив, що
   * новий постійний ключ не потрібен. prompt=consent це майже завжди лікує,
   * але не тоді, коли людина пройшла через чужий акаунт-чузер. Без окремого
   * тексту вона тиснутиме «Підключити» вп'яте — тож підключення не зберігаємо
   * і прямо кажемо, що робити.
   */
  if (!tokens.refreshToken) return back(req, state.returnTo, "no-refresh");

  // Галочку з календаря зняли на екрані згоди — підключати нема чого.
  const needed = CALENDAR_SCOPE.split(" ").filter((s) => s.includes("/auth/calendar"));
  const granted = tokens.scope.split(" ");
  if (!needed.every((s) => granted.includes(s))) return back(req, state.returnTo, "no-scope");

  await saveConnection({
    userId: auth.me.userId,
    googleEmail: tokens.email,
    refreshToken: tokens.refreshToken,
    scope: tokens.scope,
  });

  return back(req, state.returnTo, "ok");
}
