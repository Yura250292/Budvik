/**
 * Авто торгових і витрати на пальне за період.
 *
 * Кілометраж береться з поїздок бота (SalesTrip), норма й ціна — з
 * SalesVehicle. Для торгового без заведеного авто застосовуються дефолти,
 * щоб таблиця не була порожньою до заповнення довідника.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { geocodeAddress } from "@/lib/geo/nominatim";
import { parsePeriod } from "@/lib/analytics/period";
import { fuelCost, tripFactsByRep, VEHICLE_DEFAULTS } from "@/lib/analytics/facts";

export const dynamic = "force-dynamic";

const EDIT_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const role = session.user.role;
  const canEdit = EDIT_ROLES.includes(role);
  if (!canEdit && role !== "SALES") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams);
  const repScope = canEdit ? null : session.user.id;

  const [reps, vehicles, trips] = await Promise.all([
    prisma.user.findMany({
      where: { role: "SALES", ...(repScope ? { id: repScope } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.salesVehicle.findMany({
      where: repScope ? { repId: repScope } : {},
      select: {
        repId: true,
        label: true,
        fuelConsumption: true,
        fuelPricePerL: true,
        baseAddress: true,
        baseLat: true,
        baseLng: true,
      },
    }),
    tripFactsByRep(period.from, period.to, repScope),
  ]);

  const vehicleByRep = new Map(vehicles.map((v) => [v.repId, v]));
  const tripsByRep = new Map(trips.map((t) => [t.repId, t]));

  const rows = reps.map((rep) => {
    const vehicle = vehicleByRep.get(rep.id) ?? null;
    const t = tripsByRep.get(rep.id);
    const fuel = fuelCost(t?.totalKm ?? 0, t?.personalKm ?? 0, vehicle, t?.daysWorked ?? 0);

    return {
      repId: rep.id,
      repName: rep.name,
      label: vehicle?.label ?? null,
      hasVehicle: !!vehicle,
      baseAddress: vehicle?.baseAddress ?? null,
      // Координати кажуть, чи адреса ЗНАЙШЛАСЯ: введений рядок без них
      // означає, що геокодер промахнувся, і подача не рахується.
      hasBase: vehicle?.baseLat != null && vehicle?.baseLng != null,
      fuelConsumption: fuel.fuelConsumption,
      fuelPricePerL: fuel.fuelPricePerL,
      totalKm: t?.totalKm ?? 0,
      personalKm: t?.personalKm ?? 0,
      workKm: fuel.workKm,
      trips: t?.trips ?? 0,
      daysWorked: t?.daysWorked ?? 0,
      liters: fuel.liters,
      cost: fuel.cost,
      costPerDay: fuel.costPerDay,
    };
  });

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    canEdit,
    defaults: VEHICLE_DEFAULTS,
    rows,
    totals: {
      workKm: rows.reduce((s, r) => s + r.workKm, 0),
      liters: rows.reduce((s, r) => s + r.liters, 0),
      cost: rows.reduce((s, r) => s + r.cost, 0),
    },
  });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    repId?: string;
    label?: string | null;
    fuelConsumption?: number;
    fuelPricePerL?: number;
    baseAddress?: string | null;
  } | null;

  if (!body?.repId) {
    return NextResponse.json({ error: "Потрібен repId" }, { status: 400 });
  }

  const consumption = Number(body.fuelConsumption);
  const price = Number(body.fuelPricePerL);
  if (!Number.isFinite(consumption) || consumption <= 0 || consumption > 100) {
    return NextResponse.json({ error: "Норма має бути від 0 до 100 л/100км" }, { status: 400 });
  }
  if (!Number.isFinite(price) || price <= 0 || price > 1000) {
    return NextResponse.json({ error: "Ціна має бути від 0 до 1000 грн/л" }, { status: 400 });
  }

  const rep = await prisma.user.findUnique({ where: { id: body.repId }, select: { role: true } });
  if (!rep || rep.role !== "SALES") {
    return NextResponse.json({ error: "Користувач не є торговим" }, { status: 400 });
  }

  const label = body.label?.trim() || null;

  /**
   * База: адресу геокодуємо тут, при збереженні, а не при кожному показі.
   *
   * Поле baseAddress передається лише тоді, коли форма його редагувала —
   * інакше збереження норми пального стирало б адресу. Тому undefined і
   * порожній рядок означають різне: перше «не чіпати», друге «прибрати».
   */
  const existing = await prisma.salesVehicle.findUnique({
    where: { repId: body.repId },
    select: { baseAddress: true, baseLat: true, baseLng: true },
  });

  let baseFields: {
    baseAddress: string | null;
    baseLat: number | null;
    baseLng: number | null;
    baseLegsKm: typeof Prisma.DbNull;
  } | null = null;
  let baseNotFound = false;

  if (body.baseAddress !== undefined) {
    const address = body.baseAddress?.trim() || null;

    if (!address) {
      baseFields = { baseAddress: null, baseLat: null, baseLng: null, baseLegsKm: Prisma.DbNull };
    } else if (address === existing?.baseAddress && existing.baseLat != null) {
      // Адреса не змінилася — не смикаємо Nominatim і не гасимо кеш подачі.
      baseFields = null;
    } else {
      const found = await geocodeAddress(address);
      baseNotFound = !found;
      baseFields = {
        baseAddress: address,
        baseLat: found?.lat ?? null,
        baseLng: found?.lng ?? null,
        // База переїхала — старі плечі подачі більше не правда.
        baseLegsKm: Prisma.DbNull,
      };
    }
  }

  // Тут upsert безпечний: ключ repId — not null, NULLS DISTINCT не заважає.
  const vehicle = await prisma.salesVehicle.upsert({
    where: { repId: body.repId },
    create: {
      repId: body.repId,
      label,
      fuelConsumption: consumption,
      fuelPricePerL: price,
      ...(baseFields ?? {}),
    },
    update: {
      label,
      fuelConsumption: consumption,
      fuelPricePerL: price,
      ...(baseFields ?? {}),
    },
    select: {
      repId: true,
      label: true,
      fuelConsumption: true,
      fuelPricePerL: true,
      baseAddress: true,
      baseLat: true,
      baseLng: true,
    },
  });

  return NextResponse.json({
    ok: true,
    vehicle,
    // Адресу зберегли, але на карті не знайшли: подача не рахуватиметься,
    // і мовчати про це не можна — інакше план тихо лишиться заниженим.
    baseNotFound,
  });
}
