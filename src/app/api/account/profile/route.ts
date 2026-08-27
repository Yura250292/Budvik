import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveIdentity } from "@/lib/app/identity";

/**
 * Власні дані користувача.
 *
 * Міняє тільки себе — id береться з сесії, не з тіла запиту.
 *
 * Ім'я тут навмисно НЕ редагується. Синхронізація з 1С прив'язує документи до
 * торгового послівним зіставленням `User.name` із «Ответственный»/«Менеджер»
 * (lib/sync-ingest/apply-documents.ts). Дозволити людині перейменувати себе —
 * означало б, що наступний прогін не знайде збігу і її продажі мовчки
 * випадуть у розбіжності як UNMATCHED_SALES_REP. Ім'я міняє адмін, свідомо.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(req: Request) {
  const me = await resolveIdentity(req);
  if (!me) return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: me.userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      password: true,
      avatarUrl: true,
      color: true,
      telegramUsername: true,
      createdAt: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    avatarUrl: user.avatarUrl,
    color: user.color,
    telegramUsername: user.telegramUsername,
    createdAt: user.createdAt,
    hasPassword: Boolean(user.password),
  });
}

export async function PATCH(req: NextRequest) {
  const me = await resolveIdentity(req);
  if (!me) return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });

  const body = await req.json();
  const data: { email?: string; phone?: string | null } = {};

  if ("email" in body) {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Некоректний email" }, { status: 400 });
    }

    const taken = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (taken && taken.id !== me.userId) {
      return NextResponse.json(
        { error: "Цей email вже зайнятий" },
        { status: 409 }
      );
    }

    data.email = email;
  }

  if ("phone" in body) {
    const phone = String(body.phone ?? "").trim();
    // Порожнє поле — це «прибрати телефон», а не помилка.
    data.phone = phone || null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Немає що змінювати" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: me.userId },
    data,
    select: { id: true, name: true, email: true, phone: true, role: true },
  });

  return NextResponse.json(updated);
}
