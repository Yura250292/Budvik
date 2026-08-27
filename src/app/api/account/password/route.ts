import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { resolveIdentity } from "@/lib/app/identity";

/**
 * Зміна власного пароля.
 *
 * Навіщо: адмін видає торговому стартовий пароль через вкладку «Доступ», і
 * без цього ендпоінта той пароль лишався б назавжди — змінити його не було
 * чим, бо bcrypt.hash викликався лише в публічній реєстрації.
 *
 * Не адмінський ендпоінт: міняє пароль тільки собі, id береться з сесії, а
 * не з тіла запиту. Тому шлях /api/account, а не /api/admin.
 *
 * Старий пароль обов'язковий: сесія може лишитись відкритою на чужому
 * пристрої, і без цієї перевірки нею можна було б перехопити акаунт.
 */

/** Той самий cost, що й у решті проєкту (api/register, sales-reps/credentials). */
const BCRYPT_COST = 10;

const MIN_PASSWORD_LENGTH = 6;

export async function GET(req: Request) {
  const me = await resolveIdentity(req);
  if (!me) return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: me.userId },
    select: { email: true, password: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  // Хеш назовні не віддаємо — форма має знати лише, чи є що міняти.
  return NextResponse.json({ email: user.email, hasPassword: Boolean(user.password) });
}

export async function PATCH(req: NextRequest) {
  const me = await resolveIdentity(req);
  if (!me) return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });

  const body = await req.json();
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Новий пароль має бути не коротшим за ${MIN_PASSWORD_LENGTH} символів` },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: me.userId },
    select: { id: true, password: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  // Акаунт без пароля — це вхід через Google або запис під Telegram-бот.
  // Дозволити тут «зміну» означало б задати пароль тому, хто про це не просив.
  if (!user.password) {
    return NextResponse.json(
      { error: "У цього акаунта немає пароля. Зверніться до адміністратора." },
      { status: 400 }
    );
  }

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    return NextResponse.json({ error: "Поточний пароль неправильний" }, { status: 400 });
  }

  if (await bcrypt.compare(newPassword, user.password)) {
    return NextResponse.json(
      { error: "Новий пароль збігається зі старим" },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(newPassword, BCRYPT_COST) },
  });

  return NextResponse.json({ ok: true });
}
