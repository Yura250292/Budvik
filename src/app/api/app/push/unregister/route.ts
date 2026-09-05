/**
 * Відписка пристрою персоналу — при виході з робочої збірки.
 *
 * Пара до register: той самий контур перевірки (токен пристрою або кукі
 * кабінету), та сама спільна таблиця пушів.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;

  const { token } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Не вказано токен" }, { status: 400 });
  }

  // Гасимо лише свій рядок: чужий токен відкликати не можна навіть знаючи його.
  await prisma.pushToken.updateMany({
    where: { token, userId: auth.me.userId },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
