import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyWorkerLinked } from "@/lib/telegram/notify";

/** Список складовщиків + активні запити на прив'язку. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [workers, requests] = await Promise.all([
    prisma.user.findMany({
      where: { role: "WAREHOUSE" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        telegramId: true,
        telegramUsername: true,
        createdAt: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.warehouseLinkRequest.findMany({
      where: { approved: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({ workers, requests });
}

/**
 * Прив'язка складовщика до Telegram.
 * Варіанти тіла запиту:
 *  - { requestId, userId }        — підтвердити запит для наявного користувача
 *  - { requestId, name, email }   — створити нового складовщика і підтвердити
 *  - { userId, telegramId }       — ручна прив'язка без запиту
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { requestId, userId, name, email, telegramId: manualTelegramId } = body;

  // --- Ручна прив'язка ---
  if (!requestId && userId && manualTelegramId) {
    const value = String(manualTelegramId).trim();
    const taken = await prisma.user.findUnique({
      where: { telegramId: value },
      select: { id: true, name: true },
    });
    if (taken && taken.id !== userId) {
      return NextResponse.json(
        { error: `Цей Telegram вже прив'язано до ${taken.name}` },
        { status: 409 }
      );
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { telegramId: value, role: "WAREHOUSE" },
      select: { id: true, name: true, telegramId: true },
    });

    await notifyWorkerLinked(value, user.name);
    return NextResponse.json({ ok: true, user });
  }

  // --- Підтвердження запиту ---
  if (!requestId) {
    return NextResponse.json({ error: "Не вказано запит" }, { status: 400 });
  }

  const request = await prisma.warehouseLinkRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) {
    return NextResponse.json({ error: "Запит не знайдено" }, { status: 404 });
  }
  if (request.approved) {
    return NextResponse.json({ error: "Запит уже підтверджено" }, { status: 400 });
  }
  if (request.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "Термін дії коду минув. Попросіть працівника надіслати /start ще раз." },
      { status: 400 }
    );
  }

  const occupied = await prisma.user.findUnique({
    where: { telegramId: request.telegramId },
    select: { id: true, name: true },
  });
  if (occupied && occupied.id !== userId) {
    return NextResponse.json(
      { error: `Цей Telegram вже прив'язано до ${occupied.name}` },
      { status: 409 }
    );
  }

  let targetUserId = userId as string | undefined;

  // Створення нового складовщика (пароль не потрібен — вхід лише через бота)
  if (!targetUserId) {
    if (!name || !email) {
      return NextResponse.json(
        { error: "Вкажіть ім'я та email нового складовщика" },
        { status: 400 }
      );
    }

    const existingEmail = await prisma.user.findUnique({
      where: { email: String(email).trim().toLowerCase() },
      select: { id: true },
    });
    if (existingEmail) {
      return NextResponse.json(
        { error: "Користувач з таким email вже існує — оберіть його зі списку" },
        { status: 409 }
      );
    }

    const created = await prisma.user.create({
      data: {
        name: String(name).trim(),
        email: String(email).trim().toLowerCase(),
        role: "WAREHOUSE",
      },
      select: { id: true },
    });
    targetUserId = created.id;
  }

  const [user] = await prisma.$transaction([
    prisma.user.update({
      where: { id: targetUserId },
      data: {
        telegramId: request.telegramId,
        telegramUsername: request.telegramUsername,
        role: "WAREHOUSE",
      },
      select: { id: true, name: true, telegramId: true, telegramUsername: true },
    }),
    prisma.warehouseLinkRequest.update({
      where: { id: request.id },
      data: {
        approved: true,
        approvedById: session.user.id,
        approvedAt: new Date(),
        linkedUserId: targetUserId,
      },
    }),
  ]);

  await notifyWorkerLinked(request.telegramId, user.name);

  return NextResponse.json({ ok: true, user });
}

/** Відв'язати Telegram від складовщика. */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "Не вказано користувача" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { telegramId: null, telegramUsername: null },
  });

  return NextResponse.json({ ok: true });
}
