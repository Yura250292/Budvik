import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Логін і пароль торгового.
 *
 * Навіщо окремий ендпоінт, а не гілка в /api/admin/users/[id]: там PATCH —
 * набір взаємовиключних `if ("field" in body)`, і домішувати туди пароль
 * означало б, що будь-яка помилка в тілі запиту мовчки пройде повз хешування.
 *
 * Торгові, заведені seed-скриптом, мають технічний email rep-*@budvik.local і
 * password = null — увійти таким записом неможливо (lib/auth.ts відхиляє
 * користувача без пароля). Тут адмін ставить справжню пошту й пароль.
 *
 * Змінюються лише email і password, id лишається — тож усі прив'язані продажі,
 * плани й мотивація на місці.
 */

/** Той самий cost, що й у публічній реєстрації (api/register/route.ts). */
const BCRYPT_COST = 10;

/** Коротший пароль не варто заводити навіть тимчасово. */
const MIN_PASSWORD_LENGTH = 6;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, password: true, role: true, telegramId: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  // Хеш назовні не віддаємо — адміну достатньо знати, чи пароль узагалі заданий.
  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    hasPassword: Boolean(user.password),
    hasTelegram: Boolean(user.telegramId),
    // Технічна пошта від seed-скрипта: на неї нічого не надсилається,
    // і поки вона така — торговий не має робочого логіна.
    isPlaceholderEmail: user.email.endsWith("@budvik.local"),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, email: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  // Ендпоінт лежить під /sales-reps, але шлях сам по собі нічого не гарантує:
  // підставивши чужий id, менеджер інакше змінив би пароль адміну.
  if (target.role !== "SALES") {
    return NextResponse.json(
      { error: "Цей користувач не торговий представник" },
      { status: 400 }
    );
  }

  const data: { email?: string; password?: string } = {};

  if ("email" in body) {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Некоректний email" }, { status: 400 });
    }

    const taken = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, role: true },
    });
    if (taken && taken.id !== id) {
      return NextResponse.json(
        { error: `Цей email вже належить користувачу ${taken.name}` },
        { status: 409 }
      );
    }

    data.email = email;
  }

  if ("password" in body) {
    const password = String(body.password ?? "");
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Пароль має бути не коротшим за ${MIN_PASSWORD_LENGTH} символів` },
        { status: 400 }
      );
    }
    data.password = await bcrypt.hash(password, BCRYPT_COST);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Немає що змінювати" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, password: true },
  });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    hasPassword: Boolean(updated.password),
    isPlaceholderEmail: updated.email.endsWith("@budvik.local"),
  });
}
