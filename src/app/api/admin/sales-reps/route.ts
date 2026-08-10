import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Заведення торгового представника.
 *
 * Два сценарії, бо в базі вже є обидва випадки:
 *
 *  - { mode: "link", userId, password? }        — наявний користувач стає SALES.
 *    Так підіймають людину, яка зареєструвалась через сайт як CLIENT.
 *
 *  - { mode: "create", name, email, password }  — новий запис одразу з доступом.
 *
 * Чому не через існуючий POST /api/admin/warehouse-workers: той заводить
 * працівника без пароля під Telegram-бот і вимагає requestId від бота. Тут
 * потрібен вхід на сайт за email і паролем.
 *
 * Важливо про синхронізацію: продажі з 1С прив'язуються за `name` — послівним
 * зіставленням у lib/sync-ingest/apply-documents.ts. Тому ім'я треба писати
 * рівно як у 1С («Кавецький Віктор»), інакше документи осядуть у розбіжностях
 * як UNMATCHED_SALES_REP. Email на прив'язку не впливає.
 */

/** Той самий cost, що й у публічній реєстрації (api/register/route.ts). */
const BCRYPT_COST = 10;

/** Коротший пароль не варто заводити навіть тимчасово. */
const MIN_PASSWORD_LENGTH = 6;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Кого можна підняти до торгового. ADMIN і MANAGER не чіпаємо: зміна ролі
 * забрала б у них доступ до адмінки, і зробити це «мимохідь» тут не можна.
 * DRIVER і WAREHOUSE лишаються осторонь — у них свої боти й сценарії.
 */
const PROMOTABLE_ROLES = ["CLIENT", "WHOLESALE", "WAREHOUSE"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Кандидати на підвищення — для випадаючого списку у формі прив'язки.
  const candidates = await prisma.user.findMany({
    where: { role: { in: PROMOTABLE_ROLES as never[] } },
    select: { id: true, name: true, email: true, role: true, password: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(
    candidates.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      hasPassword: Boolean(u.password),
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const mode = body.mode === "create" ? "create" : "link";

  // Пароль необов'язковий при link (у наявного користувача він зазвичай уже є),
  // але якщо його передали — перевіряємо однаково в обох гілках.
  const rawPassword = "password" in body ? String(body.password ?? "") : null;
  if (rawPassword !== null && rawPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Пароль має бути не коротшим за ${MIN_PASSWORD_LENGTH} символів` },
      { status: 400 }
    );
  }

  if (mode === "link") {
    const userId = String(body.userId ?? "").trim();
    if (!userId) {
      return NextResponse.json({ error: "Оберіть користувача" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, password: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
    }
    if (user.role === "SALES") {
      return NextResponse.json(
        { error: `${user.name} вже торговий представник` },
        { status: 409 }
      );
    }
    if (!PROMOTABLE_ROLES.includes(user.role)) {
      return NextResponse.json(
        { error: `Користувача з роллю ${user.role} не можна зробити торговим` },
        { status: 400 }
      );
    }
    // Своя роль — окремо: інакше адмін одним кліком забрав би в себе адмінку.
    if (user.id === session.user.id) {
      return NextResponse.json({ error: "Не можна змінити власну роль" }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        role: "SALES",
        ...(rawPassword ? { password: await bcrypt.hash(rawPassword, BCRYPT_COST) } : {}),
      },
      select: { id: true, name: true, email: true, role: true, password: true },
    });

    return NextResponse.json(
      {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        hasPassword: Boolean(updated.password),
        created: false,
      },
      { status: 200 }
    );
  }

  // mode === "create"
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();

  if (!name) {
    return NextResponse.json({ error: "Вкажіть ім'я" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Некоректний email" }, { status: 400 });
  }
  if (!rawPassword) {
    return NextResponse.json({ error: "Вкажіть пароль" }, { status: 400 });
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
  // синхронізація зіставляє за іменем і при двох кандидатах не прив'яже нікого.
  const sameName = await prisma.user.findFirst({
    where: { name, role: "SALES" },
    select: { id: true, email: true },
  });

  const created = await prisma.user.create({
    data: {
      name,
      email,
      role: "SALES",
      password: await bcrypt.hash(rawPassword, BCRYPT_COST),
    },
    select: { id: true, name: true, email: true, role: true },
  });

  return NextResponse.json(
    {
      ...created,
      hasPassword: true,
      created: true,
      warning: sameName
        ? `Торговий з іменем «${name}» уже існує (${sameName.email}). ` +
          `Синхронізація не зможе обрати між ними — продажі не прив'яжуться до жодного.`
        : undefined,
    },
    { status: 201 }
  );
}
