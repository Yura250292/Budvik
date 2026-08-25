/**
 * Відписка пристрою від сповіщень — при виході із застосунку або коли
 * людина вимикає сповіщення в налаштуваннях.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopIdentity, unauthorized } from "@/lib/shop/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await shopIdentity(req);
  if (!me) return unauthorized();

  const { token } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Не вказано токен" }, { status: 400 });
  }

  // Гасимо лише свій рядок: чужий токен відкликати не можна навіть знаючи його.
  await prisma.pushToken.updateMany({
    where: { token, userId: me.userId },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
