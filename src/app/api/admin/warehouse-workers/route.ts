import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyWorkerLinked } from "@/lib/telegram/notify";

/**
 * Ролі, які можна призначити через прив'язку до Telegram-бота.
 * ADMIN/MANAGER свідомо відсутні: прив'язка не має бути шляхом
 * підвищення прав.
 */
const LINKABLE_ROLES = ["WAREHOUSE", "SALES"] as const;
type LinkableRole = (typeof LINKABLE_ROLES)[number];

/** Ролі, які не можна перезаписати прив'язкою — інакше тихо знімемо права. */
const PROTECTED_ROLES = ["ADMIN", "MANAGER"];

function parseRole(value: unknown): LinkableRole {
  // Дефолт WAREHOUSE — щоб старий фронтенд, який не шле role,
  // працював як раніше (критично для порядку деплою).
  const role = String(value ?? "WAREHOUSE").toUpperCase();
  return (LINKABLE_ROLES as readonly string[]).includes(role)
    ? (role as LinkableRole)
    : "WAREHOUSE";
}

/** Список працівників бота (склад + торгові) та активні запити на прив'язку. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [workers, requests] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [...LINKABLE_ROLES] } },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
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
 * Прив'язка працівника до Telegram.
 * Варіанти тіла запиту (у всіх необов'язковий role: "WAREHOUSE" | "SALES"):
 *  - { requestId, userId }        — підтвердити запит для наявного користувача
 *  - { requestId, name, email }   — створити нового працівника і підтвердити
 *  - { userId, telegramId }       — ручна прив'язка без запиту
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { requestId, userId, name, email, telegramId: manualTelegramId } = body;
  const role = parseRole(body.role);

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

    const guard = await assertNotProtected(userId);
    if (guard) return guard;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { telegramId: value, role },
      select: { id: true, name: true, telegramId: true, role: true },
    });

    await notifyWorkerLinked(value, user.name, role);
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

  if (targetUserId) {
    const guard = await assertNotProtected(targetUserId);
    if (guard) return guard;
  }

  // Створення нового працівника (пароль не потрібен — вхід лише через бота)
  if (!targetUserId) {
    if (!name || !email) {
      return NextResponse.json(
        { error: "Вкажіть ім'я та email нового працівника" },
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
        role,
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
        role,
      },
      select: { id: true, name: true, telegramId: true, telegramUsername: true, role: true },
    }),
    prisma.warehouseLinkRequest.update({
      where: { id: request.id },
      data: {
        approved: true,
        approvedById: session.user.id,
        approvedAt: new Date(),
        linkedUserId: targetUserId,
        assignedRole: role,
      },
    }),
  ]);

  await notifyWorkerLinked(request.telegramId, user.name, role);

  return NextResponse.json({ ok: true, user });
}

/**
 * Не дозволяємо прив'язкою знизити роль адміну чи менеджеру.
 * Помилковий вибір у списку інакше тихо зняв би людині права.
 */
async function assertNotProtected(userId: string): Promise<NextResponse | null> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, name: true },
  });
  if (target && PROTECTED_ROLES.includes(target.role)) {
    return NextResponse.json(
      {
        error:
          `${target.name} має роль ${target.role}. Прив'язка знизила б права — ` +
          "змініть роль вручну в картці користувача, якщо це справді потрібно.",
      },
      { status: 409 }
    );
  }
  return null;
}

/** Відв'язати Telegram від працівника. */
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
