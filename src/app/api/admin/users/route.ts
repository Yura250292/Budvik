import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BCRYPT_COST, EMAIL_RE, MIN_PASSWORD_LENGTH } from "@/lib/auth/credentials";
import { CREATABLE_ROLES } from "@/lib/roles";

/**
 * Список користувачів для розділу «Користувачі» (/admin/users).
 *
 * Форму відповіді можна лише доповнювати: цей ендпоінт читають ще
 * /admin/erp/delivery-routes, /admin/erp/commissions/rates,
 * /admin/erp/sales/[id], /admin/sales-reps, /manager/orders, /admin/erp/delivery-routes
 * і віджети дашборда. Перейменування поля тут ламає їх усі.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // totalSpent рахує база, а не JS.
  //
  // Було: `orders: { select: { totalAmount: true } }` — тобто до відповіді
  // тягнулися ВСІ замовлення КОЖНОГО користувача, і всі вони існували в
  // пам'яті лише заради одного reduce нижче. Один groupBy повертає стільки
  // рядків, скільки користувачів із замовленнями, замість усіх замовлень.
  const [users, spentByUser] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        boltsBalance: true,
        createdAt: true,
        avatarUrl: true,
        color: true,
        telegramId: true,
        telegramUsername: true,
        // Лише щоб порахувати hasPassword — назовні не виходить (див. нижче).
        password: true,
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.order.groupBy({
      by: ["userId"],
      _sum: { totalAmount: true },
    }),
  ]);

  const spent = new Map(spentByUser.map((r) => [r.userId, r._sum.totalAmount ?? 0]));

  // Хеш пароля не залишає сервер. Спред `...u` тут був би небезпечний:
  // додавши password у select вище, ми б тихо віддали bcrypt-хеші всім,
  // хто відкриє /admin/users. Тому поля перелічені явно.
  const result = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    boltsBalance: u.boltsBalance,
    createdAt: u.createdAt,
    avatarUrl: u.avatarUrl,
    color: u.color,
    telegramId: u.telegramId,
    telegramUsername: u.telegramUsername,
    hasPassword: Boolean(u.password),
    _count: u._count,
    totalSpent: spent.get(u.id) ?? 0,
  }));

  return NextResponse.json(result);
}

/**
 * Створення користувача будь-якої робочої ролі.
 *
 * Раніше створити людину можна було лише двома вузькими шляхами:
 * POST /api/admin/sales-reps (тільки торговий, обов'язковий пароль) і
 * POST /api/admin/warehouse-workers (тільки під заявку з бота). Клієнта,
 * оптовика чи водія завести з адмінки було неможливо — водіїв додавали
 * руками в базу, хоча /admin/erp/delivery-routes їх очікує.
 *
 * Пароль необов'язковий: складовщик і торговий, які працюють лише через
 * Telegram-бота, живуть без нього — lib/auth.ts відхиляє користувача без
 * пароля, тож такий запис просто не може залогінитись на сайті.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = body.phone ? String(body.phone).trim() : null;
  const role = String(body.role ?? "").toUpperCase();

  if (!name) {
    return NextResponse.json({ error: "Вкажіть ім'я" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Некоректний email" }, { status: 400 });
  }

  // ADMIN і MANAGER свідомо поза списком: створення адміністратора одним
  // POST — шлях ескалації прав. Підняти наявний запис можна лише свідомою
  // зміною ролі через PATCH, де діють окремі перевірки.
  if (!(CREATABLE_ROLES as string[]).includes(role)) {
    return NextResponse.json(
      { error: `Роль ${role || "—"} не можна призначити при створенні` },
      { status: 400 }
    );
  }

  const rawPassword = "password" in body ? String(body.password ?? "") : "";
  if (rawPassword && rawPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Пароль має бути не коротшим за ${MIN_PASSWORD_LENGTH} символів` },
      { status: 400 }
    );
  }

  const taken = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true },
  });
  if (taken) {
    return NextResponse.json(
      { error: `Цей email вже належить користувачу ${taken.name}` },
      { status: 409 }
    );
  }

  // Тезка — не помилка (у 1С бувають однакові прізвища), але попереджаємо:
  // продажі з 1С зіставляються за `name` (lib/sync-ingest/apply-documents.ts),
  // і при двох кандидатах документи осядуть як UNMATCHED_SALES_REP.
  const sameName =
    role === "SALES"
      ? await prisma.user.findFirst({
          where: { name, role: "SALES" },
          select: { id: true, email: true },
        })
      : null;

  const created = await prisma.user.create({
    data: {
      name,
      email,
      phone,
      role: role as never,
      ...(rawPassword ? { password: await bcrypt.hash(rawPassword, BCRYPT_COST) } : {}),
    },
    select: { id: true, name: true, email: true, phone: true, role: true },
  });

  return NextResponse.json(
    {
      ...created,
      hasPassword: Boolean(rawPassword),
      warning: sameName
        ? `Торговий з іменем «${name}» уже існує (${sameName.email}). ` +
          `Синхронізація не зможе обрати між ними — продажі не прив'яжуться до жодного.`
        : undefined,
    },
    { status: 201 }
  );
}
