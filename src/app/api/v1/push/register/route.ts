/**
 * Реєстрація пристрою для сповіщень.
 *
 * Токен Expo зберігається у відкритому вигляді, на відміну від токена
 * авторизації: це адреса доставки, а не облікові дані, і для відправки
 * потрібне саме буквальне значення.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopIdentity, unauthorized } from "@/lib/shop/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await shopIdentity(req);
  if (!me) return unauthorized();

  const { token, platform, appVersion } = await req.json().catch(() => ({}));

  if (typeof token !== "string" || !token.startsWith("ExponentPushToken")) {
    return NextResponse.json({ error: "Некоректний токен" }, { status: 400 });
  }
  if (platform !== "ios" && platform !== "android") {
    return NextResponse.json({ error: "Невідома платформа" }, { status: 400 });
  }

  /**
   * upsert по самому токену, а не по парі «користувач + токен».
   *
   * Один пристрій може змінити власника: людина вийшла, увійшов хтось інший
   * на тому самому телефоні. Токен при цьому лишається той самий, і без
   * перепризначення userId сповіщення про чужі замовлення приходили б
   * попередньому власникові пристрою.
   */
  await prisma.pushToken.upsert({
    where: { token },
    create: {
      token,
      userId: me.userId,
      platform,
      appVersion: typeof appVersion === "string" ? appVersion : null,
    },
    update: {
      userId: me.userId,
      platform,
      appVersion: typeof appVersion === "string" ? appVersion : null,
      revokedAt: null,
    },
  });

  return NextResponse.json({ ok: true });
}
