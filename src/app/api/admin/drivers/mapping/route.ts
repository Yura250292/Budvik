/**
 * Прив'язка водіїв з 1С до акаунтів на сайті.
 *
 * У маршрутному листі водій — посилання на фізособу в 1С; на сайті це
 * User з роллю DRIVER. Автоматично зіставити за іменем не намагаємось:
 * водіїв одиниці, а помилка коштує чужої зарплати. Адмін робить це раз.
 *
 * Після прив'язки старі листи цього водія оновлюються ретроспективно —
 * інакше зарплата за минулий місяць лишилася б порожньою.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const EDIT_ROLES = ["ADMIN", "MANAGER"];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const [unmappedRaw, drivers] = await Promise.all([
    // Водії з 1С, у яких є листи без прив'язаного акаунта.
    prisma.routeSheet.groupBy({
      by: ["driverExternalId1C", "driverName1C"],
      where: { driverId: null, driverExternalId1C: { not: null } },
      _count: { _all: true },
      _max: { date: true },
    }),
    prisma.user.findMany({
      where: { role: "DRIVER" },
      select: { id: true, name: true, email: true, driver1CExternalId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const unmapped = unmappedRaw
    .map((row) => ({
      driverExternalId1C: row.driverExternalId1C!,
      driverName1C: row.driverName1C,
      sheetsCount: row._count._all,
      lastSheetAt: row._max.date,
    }))
    .sort((a, b) => b.sheetsCount - a.sheetsCount);

  return NextResponse.json({ unmapped, drivers });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    driverExternalId1C?: string;
    userId?: string;
  } | null;

  const externalId = body?.driverExternalId1C?.trim();
  if (!externalId || !body?.userId) {
    return NextResponse.json({ error: "Потрібні водій з 1С і акаунт" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: body.userId },
    select: { id: true, role: true, driver1CExternalId: true },
  });
  if (!user || user.role !== "DRIVER") {
    return NextResponse.json({ error: "Користувач не є водієм" }, { status: 400 });
  }

  // Той самий Ref_Key не може вести до двох акаунтів: інакше половина
  // листів пішла б одному, половина іншому, і жодна зарплата не зійшлася б.
  const taken = await prisma.user.findFirst({
    where: { driver1CExternalId: externalId, id: { not: user.id } },
    select: { name: true },
  });
  if (taken) {
    return NextResponse.json(
      { error: `Цього водія з 1С вже прив'язано до «${taken.name}»` },
      { status: 409 }
    );
  }

  const [, retro] = await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { driver1CExternalId: externalId },
    }),
    // Ретро-прив'язка: усі листи цього водія, які досі висіли без акаунта.
    prisma.routeSheet.updateMany({
      where: { driverExternalId1C: externalId, driverId: null },
      data: { driverId: user.id },
    }),
  ]);

  return NextResponse.json({ ok: true, linkedSheets: retro.count });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "Потрібен userId" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { driver1CExternalId: true },
  });
  if (!user?.driver1CExternalId) {
    return NextResponse.json({ error: "Акаунт не прив'язаний" }, { status: 400 });
  }

  // Листи відв'язуємо теж: інакше зарплата рахувалася б на акаунт, який
  // уже не вважається цим водієм.
  const [, unlinked] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { driver1CExternalId: null } }),
    prisma.routeSheet.updateMany({
      where: { driverExternalId1C: user.driver1CExternalId, driverId: userId },
      data: { driverId: null },
    }),
  ]);

  return NextResponse.json({ ok: true, unlinkedSheets: unlinked.count });
}
