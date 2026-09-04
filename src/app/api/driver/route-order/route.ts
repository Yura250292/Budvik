/**
 * Порядок обʼїзду, складений самим водієм.
 *
 * Логістичний порядок рахує OSRM, і він майже завжди найкоротший. Але
 * «найкоротший» не знає того, що знає людина: цей магазин відчиняється о
 * десятій, у той двір не заїхати вантажівкою до обіду, а на цьому ринку
 * розвантаження лише з торця. Тому останнє слово лишається за водієм —
 * він перетягує рядки, і його порядок запамʼятовується.
 *
 * Мітка особиста: діє в кабінеті цього водія і нікуди більше. Чому не
 * переписуємо sequence у самих точках — у коментарі до моделі
 * DriverRouteOrder: рядки листа приїжджають обміном з 1С і затерлися б, а
 * порядок маршруту сайту належить логісту.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveDriverRoute } from "@/lib/track/day-stops";
import { requireRoles, DRIVER_ROLES } from "@/lib/app/identity";

export const dynamic = "force-dynamic";

/** Скільки точок готові прийняти. Довший список — не маршрут, а помилка. */
const MAX_STOPS = 200;

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, DRIVER_ROLES);
  if (!auth.ok) return auth.response;

  const routeKey = new URL(req.url).searchParams.get("route");
  if (!routeKey) return NextResponse.json({ stopKeys: null });

  const row = await prisma.driverRouteOrder.findUnique({
    where: { driverId_routeKey: { driverId: auth.me.userId, routeKey } },
    select: { stopKeys: true, updatedAt: true },
  });

  return NextResponse.json({ stopKeys: row?.stopKeys ?? null, updatedAt: row?.updatedAt ?? null });
}

export async function PUT(req: NextRequest) {
  const auth = await requireRoles(req, DRIVER_ROLES);
  if (!auth.ok) return auth.response;

  let body: { route?: string; stopKeys?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  const routeKey = body.route;
  const stopKeys = body.stopKeys;
  if (!routeKey || !Array.isArray(stopKeys) || stopKeys.length === 0) {
    return NextResponse.json({ error: "Не вказано маршрут або порядок" }, { status: 400 });
  }
  if (stopKeys.length > MAX_STOPS) {
    return NextResponse.json({ error: "Забагато точок" }, { status: 400 });
  }

  /**
   * Приймаємо лише ключі, які справді є в ЦЬОМУ маршруті цього водія.
   *
   * Не параноя: ключ точки — це її id у базі, і без перевірки в таблицю
   * можна було б скласти будь-який список рядків. Заразом це ловить
   * розсинхрон, коли планшет зберігає порядок маршруту, який офіс уже
   * переробив.
   */
  const route = await resolveDriverRoute(auth.me.userId, routeKey);
  if (route.stops.length === 0) {
    return NextResponse.json({ error: "Маршрут не знайдено" }, { status: 404 });
  }
  const known = new Set(route.stops.map((s) => s.key));
  const clean = [...new Set(stopKeys.filter((k) => known.has(k)))];
  if (clean.length === 0) {
    return NextResponse.json({ error: "Жодна точка не належить цьому маршруту" }, { status: 400 });
  }

  await prisma.driverRouteOrder.upsert({
    where: { driverId_routeKey: { driverId: auth.me.userId, routeKey } },
    create: { driverId: auth.me.userId, routeKey, stopKeys: clean },
    update: { stopKeys: clean },
  });

  return NextResponse.json({ stopKeys: clean });
}

/** Скинути свій порядок — маршрут повертається до логістичного. */
export async function DELETE(req: NextRequest) {
  const auth = await requireRoles(req, DRIVER_ROLES);
  if (!auth.ok) return auth.response;

  const routeKey = new URL(req.url).searchParams.get("route");
  if (!routeKey) return NextResponse.json({ error: "Не вказано маршрут" }, { status: 400 });

  await prisma.driverRouteOrder.deleteMany({
    where: { driverId: auth.me.userId, routeKey },
  });

  return NextResponse.json({ ok: true });
}
