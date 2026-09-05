/**
 * Реєстрація пристрою персоналу для сповіщень.
 *
 * Окремий роут від /api/v1/push/register навмисно, і не з обережності, а
 * тому, що той контур перевіряє токен зі scope «shop»: робоча збірка має
 * scope «track», і її реєстрація там просто отримувала б 401. Зводити
 * обидва застосунки в один контур перевірки заборонено з тієї ж причини,
 * що й у DeviceToken.scope — токен покупця не має ходити в роути поля.
 *
 * Таблиця пушів спільна: адреса доставки в Expo однакова, і роздвоювати її
 * означало б слати два сповіщення на телефон, де людина і купує, і працює.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;

  const { token, platform, appVersion } = await req.json().catch(() => ({}));

  if (typeof token !== "string" || !token.startsWith("ExponentPushToken")) {
    return NextResponse.json({ error: "Некоректний токен" }, { status: 400 });
  }
  if (platform !== "ios" && platform !== "android") {
    return NextResponse.json({ error: "Невідома платформа" }, { status: 400 });
  }

  // upsert по самому токену: телефон міг змінити власника, і сповіщення
  // мають піти новому, а не тому, хто вийшов.
  await prisma.pushToken.upsert({
    where: { token },
    create: {
      token,
      userId: auth.me.userId,
      platform,
      appVersion: typeof appVersion === "string" ? appVersion : null,
    },
    update: {
      userId: auth.me.userId,
      platform,
      appVersion: typeof appVersion === "string" ? appVersion : null,
      revokedAt: null,
    },
  });

  return NextResponse.json({ ok: true });
}
