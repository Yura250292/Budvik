/**
 * Обмін токена пристрою на сесію NextAuth.
 *
 * Нативний застосунок живе на Bearer-токені (`bdvk_…`), а кабінет
 * торгового — на cookie NextAuth. Щоб WebView всередині застосунку
 * відкривав /sales вже залогіненим, а не форму входу, потрібен місток:
 * пристрій показує свій токен, отримує сесійну кукі й одразу редірект
 * у кабінет.
 *
 * Чому GET із Set-Cookie на сервері, а не мінт кукі в Kotlin: інакше
 * застосунок мусив би знати ім'я кукі, префікс `__Secure-`, maxAge і
 * формат JWT — тобто половину конфігу NextAuth у другому репозиторії.
 * Зміна версії NextAuth (v5 перейменовує кукі на `authjs.session-token`)
 * ламала б застосунок мовчки. Тут натив знає рівно один URL і один
 * заголовок, решта лишається поруч з authOptions.
 *
 * Безпека GET-роуту, який ставить кукі: top-level навігація браузера не
 * вміє додавати Authorization, а крос-доменний fetch з ним упирається в
 * preflight, на який ми не відповідаємо дозволом. Без валідного Bearer
 * підсадити сесію неможливо, тож CSRF тут нема на чому будувати.
 * Токен ходить лише в заголовку — не в URL, щоб не осідав у логах.
 */

import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { verifyDeviceToken } from "@/lib/track/device-token";
import { defaultTargetFor } from "@/lib/app/role-target";

export const dynamic = "force-dynamic";

/** Стільки ж, скільки дефолтна сесія NextAuth — 30 діб. */
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Пускаємо тільки відносний шлях свого сайту.
 *
 * `//evil.com` браузер прочитає як протокол-відносний абсолютний URL,
 * тож перевірки на «починається зі слеша» замало — інакше застосунок
 * можна було б відправити на чужий домен уже з сесією.
 */
function safeRelativePath(raw: string | null): string | null {
  if (!raw) return null;
  if (!/^\/(?!\/)/.test(raw)) return null;
  return raw;
}

export async function GET(req: NextRequest) {
  const device = await verifyDeviceToken(req.headers.get("authorization"));
  if (!device) {
    return NextResponse.json(
      { error: "Потрібен дійсний токен пристрою" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  /**
   * Роль і баланс читаємо з бази, а не з токена пристрою: між видачею
   * токена і сьогоднішнім входом торгового могли перевести в іншу роль.
   * Це та сама логіка, що в callbacks.jwt для Google-входу.
   */
  const user = await prisma.user.findUnique({
    where: { id: device.userId },
    select: { id: true, email: true, name: true, role: true, boltsBalance: true },
  });
  if (!user) {
    return NextResponse.json(
      { error: "Потрібен дійсний токен пристрою" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    console.error("[device/session] NEXTAUTH_SECRET не заданий");
    return NextResponse.json(
      { error: "Сервер не налаштований" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  /**
   * Поля один-в-один як у callbacks.jwt (src/lib/auth.ts): саме їх
   * callbacks.session перекладає в session.user, і на них дивляться
   * і SalesGate на клієнті, і getServerSession у роутах.
   */
  const sessionToken = await encode({
    token: {
      sub: user.id,
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      boltsBalance: user.boltsBalance,
    },
    secret,
    maxAge: SESSION_MAX_AGE,
  });

  /**
   * Ім'я кукі NextAuth v4 обирає за протоколом: на HTTPS читає
   * `__Secure-`-префікс, на HTTP — голе ім'я. Поставити не те ім'я =
   * сесія є, але ніхто її не бачить.
   *
   * Протокол дивимось на самому запиті (за проксі Vercel — у
   * x-forwarded-proto), а не тільки в NEXTAUTH_URL: debug-збірка
   * застосунку ходить на http://10.0.2.2:3000, і кукі з префіксом
   * `__Secure-` браузер по HTTP мовчки відкидає.
   */
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const requestIsHttps = forwardedProto
    ? forwardedProto.split(",")[0].trim() === "https"
    : req.nextUrl.protocol === "https:";
  const configIsHttps = (process.env.NEXTAUTH_URL ?? "").startsWith("https://");
  const secure = requestIsHttps || configIsHttps;

  /**
   * Коли протокол запиту й NEXTAUTH_URL розходяться, ставимо кукі під
   * обома іменами.
   *
   * Так буває рівно в одному місці — локальна розробка з бойовим
   * NEXTAUTH_URL у .env: getServerSession читає голе ім'я і бачить
   * сесію, а middleware (withAuth) шукає `__Secure-` і женеться на
   * /login. Тобто API-запити з застосунку проходять, а сторінка
   * кабінету — ні. Той самий прийом уже вживає scripts/check-tablet-api.ts.
   *
   * У проді обидва на HTTPS, розбіжності немає, і кукі рівно одна.
   */
  const cookieNames = new Set<string>();
  cookieNames.add(secure ? "__Secure-next-auth.session-token" : "next-auth.session-token");
  if (requestIsHttps !== configIsHttps) {
    cookieNames.add("next-auth.session-token");
    cookieNames.add("__Secure-next-auth.session-token");
  }

  const target =
    safeRelativePath(req.nextUrl.searchParams.get("redirect")) ??
    defaultTargetFor(user.role);

  /**
   * Location лишаємо відносним, щоб клієнт підставив той хост, з якого
   * прийшов.
   *
   * NextResponse.redirect вимагає абсолютний URL і бере його з
   * req.nextUrl.origin, а там у dev завжди localhost:3000 — незалежно
   * від того, хто стукав. Емулятор ходить на 10.0.2.2:3000, отримував
   * редірект на localhost, і WebView відкидав його як чужий хост:
   * замість кабінету відкривався системний браузер. За проксі на проді
   * origin так само може розійтися з реальним доменом.
   */
  const res = new NextResponse(null, {
    status: 302,
    headers: { Location: target },
  });
  res.headers.set("Cache-Control", "no-store");

  for (const name of cookieNames) {
    /**
     * `__Secure-` за специфікацією вимагає прапорець Secure, інакше
     * браузер відкине кукі мовчки — тому прапорець прив'язаний до імені,
     * а не до спільного `secure`.
     */
    res.cookies.set(name, sessionToken, {
      httpOnly: true,
      secure: name.startsWith("__Secure-"),
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
  }

  /**
   * Запасний канал для сервера: клієнтський UI визначає застосунок за
   * наявністю window.BudvikApp (міст надійніший — не протухає і не
   * чиститься разом з куками), але серверним компонентам об'єкт вікна
   * недоступний, тож лишаємо мітку і в куках.
   */
  res.cookies.set("budvik_app", "1", {
    httpOnly: false,
    secure: requestIsHttps,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return res;
}
