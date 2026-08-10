import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  BCRYPT_COST,
  EMAIL_RE,
  MIN_PASSWORD_LENGTH,
  isPlaceholderEmail,
} from "@/lib/auth/credentials";
import { PROTECTED_ROLES } from "@/lib/roles";

/**
 * Логін і пароль будь-якого користувача.
 *
 * Раніше це вміла лише /api/admin/sales-reps/[id]/credentials, і вона
 * відмовляла всім, крім SALES. Через це складовщику, водієві чи оптовику
 * не можна було задати пароль з адмінки взагалі.
 *
 * Навіщо окремий ендпоінт, а не гілка в /api/admin/users/[id]: там PATCH —
 * набір взаємовиключних `if ("field" in body)`, і домішувати туди пароль
 * означало б, що будь-яка помилка в тілі запиту мовчки пройде повз хешування.
 *
 * Обмеження прав НЕ знято, а замінено: старий гард `role !== "SALES"` стояв
 * тому, що шлях сам по собі нічого не гарантує — підставивши чужий id,
 * менеджер інакше змінив би пароль адміну. Тут ту саму дірку закриває
 * PROTECTED_ROLES: креденшели ADMIN/MANAGER міняє лише ADMIN.
 *
 * Змінюються тільки email і password, id лишається — тож усі прив'язані
 * продажі, плани й мотивація на місці.
 */

/** Хто може міняти креденшели цільового користувача. */
function assertMayEdit(
  actorRole: string,
  actorId: string,
  target: { id: string; role: string }
): NextResponse | null {
  // Свій власний запис редагувати можна завжди — це зміна свого ж пароля.
  if (target.id === actorId) return null;
  if ((PROTECTED_ROLES as string[]).includes(target.role) && actorRole !== "ADMIN") {
    return NextResponse.json(
      { error: "Логін і пароль адміністратора змінює лише інший адміністратор" },
      { status: 403 }
    );
  }
  return null;
}

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
    isPlaceholderEmail: isPlaceholderEmail(user.email),
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

  const forbidden = assertMayEdit(session.user.role, session.user.id, target);
  if (forbidden) return forbidden;

  const data: { email?: string; password?: string } = {};

  if ("email" in body) {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Некоректний email" }, { status: 400 });
    }

    const taken = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true },
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
    isPlaceholderEmail: isPlaceholderEmail(updated.email),
  });
}
