/**
 * Список отримувачів Telegram-сповіщень про нове замовлення з сайту.
 *
 * Чому не прапорець на User: половина адресатів (власник, продавець у точці)
 * не заходить в адмінку взагалі, і заводити їм акаунт заради пуша безглуздо.
 * Тому рядок тут створює адмін, а людина лише підтверджує себе в боті —
 * тільки після /start у нас з'являється chat_id, писати на номер телефону
 * Telegram не дозволяє.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { sendTelegramMessageResult } from "@/lib/telegram/notify";

/** Юзернейм бота для deep-link. Той самий бот, що й у складу/торгових. */
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "Budvik_Sklad_bot";

async function requireStaff() {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) return null;
  return session;
}

const SELECT = {
  id: true,
  name: true,
  phone: true,
  code: true,
  telegramId: true,
  telegramUsername: true,
  linkedAt: true,
  active: true,
  createdAt: true,
} as const;

export async function GET() {
  if (!(await requireStaff())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const recipients = await prisma.orderAlertRecipient.findMany({
    select: SELECT,
    orderBy: [{ createdAt: "asc" }],
  });

  return NextResponse.json({
    recipients,
    botUsername: BOT_USERNAME,
    // Без токена бот мовчить у будь-якому разі — сторінка має сказати це
    // прямо, інакше адмін додасть людей і чекатиме повідомлень даремно.
    botConfigured: Boolean(process.env.TELEGRAM_SKLAD_BOT_TOKEN),
    groupChatId: process.env.ORDER_ALERT_CHAT_ID || null,
  });
}

/** Код короткий і диктується вголос, тому 6 цифр, а не uuid. */
function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: NextRequest) {
  if (!(await requireStaff())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Вкажіть ім'я" }, { status: 400 });

  // Телефон необов'язковий: він тут лише щоб упізнати людину в списку.
  const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (rawPhone && !normalizePhone(rawPhone)) {
    return NextResponse.json({ error: "Схоже, номер неповний" }, { status: 400 });
  }

  for (let i = 0; i < 5; i++) {
    try {
      const recipient = await prisma.orderAlertRecipient.create({
        data: { name, phone: normalizePhone(rawPhone), code: generateCode() },
        select: SELECT,
      });
      return NextResponse.json(recipient);
    } catch (e) {
      // P2002 — колізія 6-значного коду. Малоймовірна, але дешева в обробці.
      if ((e as { code?: string })?.code !== "P2002") throw e;
    }
  }
  return NextResponse.json({ error: "Не вдалося згенерувати код" }, { status: 500 });
}

/**
 * PATCH — редагування рядка:
 *  { id, active }        — увімкнути/вимкнути розсилку
 *  { id, name, phone }   — виправити підпис
 *  { id, unlink: true }  — відв'язати Telegram, лишивши людину в списку
 *  { id, test: true }    — надіслати тестове повідомлення
 */
export async function PATCH(req: NextRequest) {
  if (!(await requireStaff())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Не вказано отримувача" }, { status: 400 });

  const existing = await prisma.orderAlertRecipient.findUnique({ where: { id }, select: SELECT });
  if (!existing) return NextResponse.json({ error: "Отримувача не знайдено" }, { status: 404 });

  if (body.test) {
    if (!existing.telegramId) {
      return NextResponse.json({ error: "Людина ще не підключилась у боті" }, { status: 400 });
    }
    const res = await sendTelegramMessageResult(
      existing.telegramId,
      "🔔 Перевірка звʼязку: сюди приходитимуть нові замовлення з сайту."
    );
    if (!res.ok) {
      return NextResponse.json(
        {
          error:
            res.status === 403
              ? "Бот заблокований — людина має відкрити чат і натиснути «Запустити»"
              : "Telegram не прийняв повідомлення",
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.phone === "string") data.phone = normalizePhone(body.phone);
  if (body.unlink === true) {
    data.telegramId = null;
    data.telegramUsername = null;
    data.linkedAt = null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нема чого міняти" }, { status: 400 });
  }

  const recipient = await prisma.orderAlertRecipient.update({
    where: { id },
    data,
    select: SELECT,
  });
  return NextResponse.json(recipient);
}

export async function DELETE(req: NextRequest) {
  if (!(await requireStaff())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Не вказано отримувача" }, { status: 400 });

  await prisma.orderAlertRecipient.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
