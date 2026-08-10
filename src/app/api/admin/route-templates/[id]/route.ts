/**
 * Редагування та видалення шаблону маршруту.
 *
 * При зміні складу пунктів шаблон перегеокодовується і геометрія
 * перебудовується — інакше на мапі лишилася б лінія від старого набору сіл.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { geocodeStops, type GeocodedStop } from "@/lib/routes/geocode-stops";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EDIT_ROLES = ["ADMIN", "MANAGER"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as
    | { name?: string; color?: string | null; region?: string | null; isActive?: boolean; settlements?: string[] }
    | null;

  if (!body) {
    return NextResponse.json({ error: "Порожній запит" }, { status: 400 });
  }

  const existing = await prisma.routeTemplate.findUnique({
    where: { id },
    include: { stops: { orderBy: { seq: "asc" } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Маршрут не знайдено" }, { status: 404 });
  }

  const data: {
    name?: string;
    color?: string | null;
    region?: string | null;
    isActive?: boolean;
    routeGeometry?: never;
    totalDistanceKm?: number | null;
  } = {};

  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (body.color !== undefined) data.color = body.color?.trim() || null;
  if (body.region !== undefined) data.region = body.region?.trim() || null;
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;

  let failed: string[] = [];

  if (Array.isArray(body.settlements)) {
    if (body.settlements.filter((s) => s.trim()).length === 0) {
      return NextResponse.json({ error: "Потрібен хоча б один населений пункт" }, { status: 400 });
    }

    const region = body.region !== undefined ? body.region?.trim() || null : existing.region;

    // Зміна області означає, що старі координати могли бути знайдені не там —
    // перегеокодовуємо все заново, інакше помилка з іншої області залишиться.
    const regionChanged = region !== existing.region;
    const known = regionChanged
      ? new Map<string, GeocodedStop>()
      : new Map(
          existing.stops.map((s) => [
            s.settlement.toLowerCase(),
            { settlement: s.settlement, displayName: s.displayName, lat: s.lat, lng: s.lng, seq: s.seq },
          ])
        );

    const result = await geocodeStops(body.settlements, region, known);
    failed = result.failed;

    if (result.stops.length === 0) {
      return NextResponse.json(
        { error: "Жоден населений пункт не вдалося знайти на карті", failed },
        { status: 422 }
      );
    }

    data.routeGeometry = result.routeGeometry as never;
    data.totalDistanceKm = result.totalDistanceKm;

    await prisma.$transaction([
      prisma.routeTemplateStop.deleteMany({ where: { templateId: id } }),
      prisma.routeTemplateStop.createMany({
        data: result.stops.map((s) => ({ ...s, templateId: id })),
      }),
      prisma.routeTemplate.update({ where: { id }, data }),
    ]);
  } else {
    await prisma.routeTemplate.update({ where: { id }, data });
  }

  const template = await prisma.routeTemplate.findUnique({
    where: { id },
    include: { stops: { orderBy: { seq: "asc" } } },
  });

  return NextResponse.json({ ok: true, template, failed });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { id } = await params;
  // Stops і assignments підуть каскадом (onDelete: Cascade у схемі).
  await prisma.routeTemplate.delete({ where: { id } }).catch(() => null);

  return NextResponse.json({ ok: true });
}
