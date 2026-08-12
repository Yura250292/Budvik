/**
 * Відмітка про візит: приїхав / не потрапив + скільки грошей забрав.
 *
 * Upsert, а не create: водій тисне кнопку в машині однією рукою, і
 * повторний тап мусить виправляти відмітку, а не плодити дублі. Ключ —
 * (людина, доба, клієнт), той самий, що @@unique у схемі.
 *
 * Сума при «забрав усе» фіксується ЧИСЛОМ на момент відмітки, а не
 * посиланням на борг: борг у 1С завтра перерахується, а відмітка має
 * лишитися свідченням про те, що було в той день.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["DRIVER", "SALES", "ADMIN", "MANAGER"];
const STATUSES = ["DONE", "MISSED"] as const;
const MONEY = ["FULL", "PARTIAL", "NONE", "NOT_APPLICABLE"] as const;

type Body = {
  counterpartyId?: string;
  day?: string;
  status?: (typeof STATUSES)[number];
  comment?: string | null;
  money?: (typeof MONEY)[number];
  collectedAmount?: number | null;
  /** Борг точки на момент відмітки — база для FULL */
  debtAmount?: number | null;
  routeSheetStopId?: string | null;
  deliveryStopId?: string | null;
  /** Де стояв планшет у мить відмітки */
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  if (!body.counterpartyId) {
    return NextResponse.json({ error: "Не вказано клієнта" }, { status: 400 });
  }
  if (!body.status || !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Некоректний статус візиту" }, { status: 400 });
  }

  const money = body.money && MONEY.includes(body.money) ? body.money : "NOT_APPLICABLE";

  // Часткова сума без числа — найімовірніше зламаний UI. Мовчки записати
  // null означало б втратити гроші у звіті, тому падаємо голосно.
  if (money === "PARTIAL" && typeof body.collectedAmount !== "number") {
    return NextResponse.json(
      { error: "Для часткової оплати треба вказати суму" },
      { status: 400 }
    );
  }
  if (typeof body.collectedAmount === "number" && body.collectedAmount < 0) {
    return NextResponse.json({ error: "Сума не може бути від'ємною" }, { status: 400 });
  }

  let collectedAmount: number | null = null;
  if (money === "PARTIAL") {
    collectedAmount = body.collectedAmount as number;
  } else if (money === "FULL") {
    // Клієнт шле борг точки; якщо не прислав — беремо суму, якщо і її
    // немає, лишаємо null (відмітка все одно цінна).
    collectedAmount =
      typeof body.debtAmount === "number"
        ? body.debtAmount
        : typeof body.collectedAmount === "number"
          ? body.collectedAmount
          : null;
  } else if (money === "NONE") {
    collectedAmount = 0;
  }

  const day = body.day || kyivDate(new Date());
  const dayStart = kyivDayStart(day);
  const userId = session.user.id;

  const client = await prisma.counterparty.findUnique({
    where: { id: body.counterpartyId },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ error: "Клієнта не знайдено" }, { status: 404 });
  }

  const data = {
    status: body.status,
    comment: body.comment?.trim() || null,
    money,
    collectedAmount,
    routeSheetStopId: body.routeSheetStopId ?? null,
    deliveryStopId: body.deliveryStopId ?? null,
    lat: typeof body.lat === "number" ? body.lat : null,
    lng: typeof body.lng === "number" ? body.lng : null,
    accuracyM: typeof body.accuracyM === "number" ? Math.round(body.accuracyM) : null,
  };

  const visit = await prisma.visit.upsert({
    where: {
      userId_day_counterpartyId: { userId, day: dayStart, counterpartyId: client.id },
    },
    create: { userId, day: dayStart, counterpartyId: client.id, ...data },
    update: data,
  });

  return NextResponse.json({ visit });
}

/** Зняти відмітку — водій натиснув помилково. */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const url = new URL(req.url);
  const counterpartyId = url.searchParams.get("counterpartyId");
  const day = url.searchParams.get("day") || kyivDate(new Date());
  if (!counterpartyId) {
    return NextResponse.json({ error: "Не вказано клієнта" }, { status: 400 });
  }

  await prisma.visit.deleteMany({
    where: { userId: session.user.id, day: kyivDayStart(day), counterpartyId },
  });

  return NextResponse.json({ ok: true });
}
