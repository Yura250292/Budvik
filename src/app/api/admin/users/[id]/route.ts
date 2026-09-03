import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isHexColor } from "@/lib/routes/colors";
import { ASSIGNABLE_ROLES } from "@/lib/roles";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      boltsBalance: true,
      createdAt: true,
      updatedAt: true,
      counterpartyId: true,
      linkedCounterparty: { select: { id: true, name: true, phone: true } },
      orders: {
        include: {
          items: { include: { product: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      boltsTransactions: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const totalSpent = user.orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const totalOrders = user.orders.length;
  const activeOrders = user.orders.filter(
    (o) => !["DELIVERED", "CANCELLED"].includes(o.status)
  ).length;

  return NextResponse.json({
    ...user,
    totalSpent,
    totalOrders,
    activeOrders,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { role, counterpartyId, telegramId } = body;

  // Handle Telegram link update (складовщик ↔ бот Budvik_Sklad)
  if ("telegramId" in body) {
    const value = telegramId ? String(telegramId).trim() : null;

    if (value) {
      const taken = await prisma.user.findUnique({
        where: { telegramId: value },
        select: { id: true, name: true },
      });
      if (taken && taken.id !== id) {
        return NextResponse.json(
          { error: `Цей Telegram вже прив'язано до користувача ${taken.name}` },
          { status: 409 }
        );
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: { telegramId: value, telegramUsername: value ? undefined : null },
      select: { id: true, name: true, telegramId: true, telegramUsername: true },
    });
    return NextResponse.json(user);
  }

  // Handle counterparty link update
  if ("counterpartyId" in body) {
    const user = await prisma.user.update({
      where: { id },
      data: { counterpartyId: counterpartyId ?? null },
      select: {
        id: true,
        counterpartyId: true,
        linkedCounterparty: { select: { id: true, name: true, phone: true } },
      },
    });
    return NextResponse.json(user);
  }

  // Колір торгового на мапі напрямків. Некоректне значення скидає до null —
  // тоді на мапі працює детермінований колір із палітри, а не помилка.
  if ("color" in body) {
    const value = isHexColor(body.color) ? String(body.color).trim() : null;

    try {
      const user = await prisma.user.update({
        where: { id },
        data: { color: value },
        select: { id: true, name: true, color: true },
      });
      return NextResponse.json(user);
    } catch (e) {
      // Міграцію user_color ще не накотили на цю базу — кажемо це прямо,
      // замість глухого 500.
      if ((e as { code?: string })?.code === "P2022") {
        return NextResponse.json(
          { error: "Колір поки не зберігається: у базі бракує колонки User.color (міграція user_color)" },
          { status: 503 }
        );
      }
      throw e;
    }
  }

  // ADMIN свідомо поза списком: роздача адмінських прав через випадаючий
  // список — шлях ескалації. DRIVER, навпаки, доданий — його очікують
  // /admin/erp/delivery-routes, а завести водія з адмінки
  // досі було неможливо.
  if (!role || !(ASSIGNABLE_ROLES as string[]).includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // Prevent changing own role
  if (id === session.user.id) {
    return NextResponse.json({ error: "Cannot change own role" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { role: true, name: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Права ADMIN не знімаються через список ролей, а MANAGER роздає лише
  // адмін — інакше двоє менеджерів по черзі зняли б один одного.
  if (target.role === "ADMIN") {
    return NextResponse.json(
      { error: "Роль адміністратора змінюють лише вручну в базі" },
      { status: 403 }
    );
  }
  if (
    (role === "MANAGER" || target.role === "MANAGER") &&
    session.user.role !== "ADMIN"
  ) {
    return NextResponse.json(
      { error: "Призначати та знімати менеджера може лише адміністратор" },
      { status: 403 }
    );
  }

  const user = await prisma.user.update({
    where: { id },
    data: { role },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  });

  return NextResponse.json(user);
}
