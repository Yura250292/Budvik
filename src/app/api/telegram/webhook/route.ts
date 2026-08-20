/**
 * Telegram-webhook бота @Budvik_Sklad — замість цілодобового воркера.
 *
 * Раніше бот жив окремим процесом на Railway (polling) і вмів зміни
 * складовщиків, трек водіїв, розпізнавання накладних. Усе це відмерло —
 * трек переїхав на планшет, накладні в 1С, — а платити за процес, який
 * 99,9% часу спить, лишалось. Єдине, що досі потрібно від вхідних
 * повідомлень: прив'язка отримувача сповіщень про замовлення
 * (людина відкриває t.me/<bot>?start=oa_<code> з /admin/orders/alerts).
 * Самі сповіщення про замовлення завжди слав сайт (lib/telegram) — цей
 * роут лише замикає коло, обробляючи відповідь Telegram без воркера.
 *
 * Секрет: Telegram шле заголовок x-telegram-bot-api-secret-token зі
 * значенням, заданим при setWebhook. Без збігу — 401, бо URL публічний
 * і будь-хто міг би «прив'язувати» чужі чати.
 *
 * Відповідаємо 200 на все розпізнане й нерозпізнане: не-200 змушує
 * Telegram ретраїти той самий апдейт годинами.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessageResult } from "@/lib/telegram/notify";

export const dynamic = "force-dynamic";

/** «oa_123456» з деплінка або з тексту; шість голих цифр теж приймаємо —
 * половина людей вставляє посилання чи диктує код замість тапнути. */
function codeFrom(text: string): string | null {
  const raw = text.trim();
  const startPayload = /^\/start\s+oa[_-]?(\d{6})$/i.exec(raw);
  if (startPayload) return startPayload[1];
  if (/^\d{6}$/.test(raw)) return raw;
  const fromLink = /[?&]start=oa[_-]?(\d{6})/i.exec(raw);
  if (fromLink) return fromLink[1];
  const bare = /^oa[_-]?(\d{6})$/i.exec(raw);
  return bare ? bare[1] : null;
}

type LinkStatus = "linked" | "already" | "taken" | "unknown";

/** Та сама логіка, що жила в боті: код → рядок списку, chat узурпувати не
 * можна, повторний тап вмикає назад вимкненого за 403. */
async function linkByCode(
  from: { id: number; username?: string },
  code: string
): Promise<{ status: LinkStatus; name?: string }> {
  const recipient = await prisma.orderAlertRecipient.findUnique({ where: { code } });
  if (!recipient) return { status: "unknown" };

  const telegramId = String(from.id);

  if (recipient.telegramId === telegramId) {
    const updated = await prisma.orderAlertRecipient.update({
      where: { id: recipient.id },
      data: { active: true, telegramUsername: from.username || null },
    });
    return { status: "already", name: updated.name };
  }

  const other = await prisma.orderAlertRecipient.findUnique({ where: { telegramId } });
  if (other) return { status: "taken", name: other.name };

  const updated = await prisma.orderAlertRecipient.update({
    where: { id: recipient.id },
    data: {
      telegramId,
      telegramUsername: from.username || null,
      linkedAt: new Date(),
      active: true,
    },
  });
  return { status: "linked", name: updated.name };
}

function replyFor(r: { status: LinkStatus; name?: string }): string {
  switch (r.status) {
    case "linked":
      return (
        `✅ Готово, <b>${r.name}</b>.\n\n` +
        "Сюди приходитиме кожне нове замовлення з сайту: клієнт, телефон, адреса, " +
        "товари й сума.\n\n" +
        "Щоб перестати їх отримувати — скажіть адміністратору, і він вимкне вас у списку."
      );
    case "already":
      return `👌 Ви вже в списку як <b>${r.name}</b> — замовлення надходитимуть сюди.`;
    case "taken":
      return (
        `⚠️ Цей Telegram уже отримує замовлення як <b>${r.name}</b>.\n\n` +
        "Якщо це помилка — попросіть адміністратора прибрати зайвий запис у " +
        "«Сповіщення про замовлення»."
      );
    default:
      return "❌ Код не знайдено. Перевірте, чи не застаріле посилання, і попросіть адміністратора надіслати нове.";
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new NextResponse(null, { status: 401 });
  }

  let update: {
    message?: {
      text?: string;
      chat?: { id: number };
      from?: { id: number; username?: string; is_bot?: boolean };
    };
  };
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  const from = msg?.from;
  if (!msg?.text || !chatId || !from || from.is_bot) {
    return NextResponse.json({ ok: true });
  }

  const code = codeFrom(msg.text);
  if (code) {
    const result = await linkByCode(from, code);
    await sendTelegramMessageResult(String(chatId), replyFor(result));
    return NextResponse.json({ ok: true });
  }

  // /start без коду — людина зайшла «просто так». Пояснюємо, що бот тепер
  // лише шле замовлення; на решту текстів мовчимо, щоб нікого не спамити.
  if (/^\/start\b/.test(msg.text.trim())) {
    await sendTelegramMessageResult(
      String(chatId),
      "Цей бот надсилає сповіщення про нові замовлення з сайту Budvik27.\n\n" +
        "Щоб підключитися, відкрийте персональне посилання або введіть " +
        "6-значний код — і те, і те дає адміністратор у розділі " +
        "«Сповіщення про замовлення»."
    );
  }

  return NextResponse.json({ ok: true });
}
