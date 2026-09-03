/**
 * Надіслати водієві посилання на маршрут.
 *
 * Досі «Надіслати водію» відкривало шторку «Поділитися» на телефоні логіста:
 * далі він сам шукав водія в месенджері. Тепер, якщо водій привʼязав бота,
 * маршрут летить йому в Telegram із сервера, а картка запамʼятовує, що
 * посилання пішло, — інакше на десятку маршрутів логіст не знає, кому вже
 * відправив.
 *
 * Текст будує той самий lib/routes/driver-message.ts, що й кнопка в адмінці:
 * водій має отримати те саме, що логіст бачить у себе на екрані.
 *
 * Дві дороги, обидві лишають слід:
 *   channel=TELEGRAM — сервер шле сам;
 *   channel=SHARE    — логіст поділився вручну, ми лише ставимо штамп.
 *
 * Відсутній telegramId — НЕ помилка, а звичайний стан (жоден водій його ще
 * не має), тому це 200 з reason і текстом: клієнт одразу відкриває шторку
 * з тим самим повідомленням.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, OFFICE_ROLES } from "@/lib/app/identity";
import { kyivDate } from "@/lib/date/kyiv";
import { buildDriverMessage, toTelegramHtml } from "@/lib/routes/driver-message";
import { sendTelegramMessageResult } from "@/lib/telegram/notify";

/**
 * Ліміт повідомлення Telegram — 4096 символів. Маршрут на 25 точок із трьома
 * частинами посилання підбирається впритул, тому довгий текст ріжемо на межі
 * рядка: спершу список точок, потім посилання окремим повідомленням.
 */
const TELEGRAM_LIMIT = 3900;

function splitForTelegram(text: string): string[] {
  if (text.length <= TELEGRAM_LIMIT) return [text];

  const parts: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    // Рядок із посиланням не ріжемо ніколи — обірване посилання не відкриється.
    if (current && current.length + line.length + 1 > TELEGRAM_LIMIT) {
      parts.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const channel = (body as { channel?: string }).channel === "SHARE" ? "SHARE" : "TELEGRAM";

  const route = await prisma.deliveryRoute.findUnique({
    where: { id },
    include: {
      driver: { select: { id: true, name: true, telegramId: true } },
      stops: {
        orderBy: { sequence: "asc" },
        include: {
          counterparty: {
            select: { name: true, deliveryLat: true, deliveryLng: true },
          },
        },
      },
    },
  });
  if (!route) {
    return NextResponse.json({ error: "Маршрут не знайдено" }, { status: 404 });
  }

  if (route.status === "COMPLETED" || route.status === "CANCELLED") {
    return NextResponse.json(
      { sent: false, reason: "CLOSED", error: "Маршрут закритий — надсилати нема чого" },
      { status: 400 }
    );
  }

  // Чернетку водій не бачить у планшеті, і посилання описувало б маршрут,
  // якого для нього не існує. Спершу передача — потім дорога.
  if (route.status === "PLANNED") {
    return NextResponse.json(
      { sent: false, reason: "NOT_ASSIGNED", error: "Спершу передайте маршрут водію" },
      { status: 409 }
    );
  }

  const message = buildDriverMessage({
    number: route.number,
    day: kyivDate(route.date),
    driverName: route.driver?.name ?? null,
    stops: route.stops,
  });

  if (message.links.length === 0) {
    return NextResponse.json(
      {
        sent: false,
        reason: "NO_COORDS",
        error: "Немає двох точок з координатами — нема з чого скласти посилання",
      },
      { status: 422 }
    );
  }

  const stamp = async (via: "TELEGRAM" | "SHARE") => {
    const updated = await prisma.deliveryRoute.update({
      where: { id },
      data: {
        linkSentAt: new Date(),
        linkSentVia: via,
        linkSentStops: route.stops.length,
      },
      select: { linkSentAt: true },
    });
    return updated.linkSentAt;
  };

  // Логіст уже поділився сам — від нас лише пам'ять про це.
  if (channel === "SHARE") {
    const sentAt = await stamp("SHARE");
    return NextResponse.json({ sent: true, via: "SHARE", sentAt });
  }

  if (!route.driver?.telegramId) {
    return NextResponse.json({
      sent: false,
      reason: "NO_TELEGRAM",
      driverName: route.driver?.name ?? null,
      text: message.text,
    });
  }

  const chunks = splitForTelegram(message.text);
  let last = { ok: true, status: 200 as number | null };
  for (const chunk of chunks) {
    last = await sendTelegramMessageResult(route.driver.telegramId, toTelegramHtml(chunk));
    if (!last.ok) break;
  }

  if (last.ok) {
    const sentAt = await stamp("TELEGRAM");
    return NextResponse.json({ sent: true, via: "TELEGRAM", sentAt });
  }

  // 403 — водій заблокував бота. Це не збій сервера, а стан людини: віддаємо
  // 200, щоб клієнт спокійно перейшов на ручну відправку.
  if (last.status === 403) {
    return NextResponse.json({
      sent: false,
      reason: "BLOCKED",
      driverName: route.driver.name,
      text: message.text,
    });
  }

  return NextResponse.json(
    {
      sent: false,
      reason: "TELEGRAM_ERROR",
      error: "Telegram не відповів — спробуйте ще раз або поділіться вручну",
      text: message.text,
    },
    { status: 502 }
  );
}
