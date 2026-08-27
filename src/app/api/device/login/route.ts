/**
 * Логін пристрою: email+пароль в обмін на довгий токен.
 *
 * Окремий вхід для нативного застосунку, бо NextAuth віддає cookie, а
 * фоновій службі Android потрібен саме токен, який не протухне посеред
 * робочого дня. Роль перевіряємо тут же: видавати токен трекінгу
 * клієнту або складу немає підстав.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { issueDeviceToken, revokeOtherDeviceTokens, TRACK_ROLES } from "@/lib/track/device-token";

export const dynamic = "force-dynamic";

/** Однакова відповідь на «немає такого email» і «невірний пароль». */
const DENIED = { error: "Невірний email або пароль" };

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; deviceName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Вкажіть email і пароль" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, role: true, password: true },
  });

  // Порядок перевірок такий самий, як у CredentialsProvider: користувач
  // без пароля (заведений під Google або ще не активований) увійти не може.
  if (!user?.password) {
    return NextResponse.json(DENIED, { status: 401 });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    return NextResponse.json(DENIED, { status: 401 });
  }

  if (!TRACK_ROLES.includes(user.role)) {
    return NextResponse.json(
      { error: "Цей акаунт не має доступу до трекінгу" },
      { status: 403 }
    );
  }

  const deviceName =
    typeof body.deviceName === "string" ? body.deviceName.slice(0, 100) : null;
  const token = await issueDeviceToken(user.id, deviceName);

  /** Вхід із робочої збірки гасить старий трекер — див. /api/v1/auth/login. */
  if (req.headers.get("x-budvik-app")?.startsWith("staff/")) {
    await revokeOtherDeviceTokens(user.id, token);
  }

  return NextResponse.json({
    token,
    user: { id: user.id, name: user.name, role: user.role },
  });
}
