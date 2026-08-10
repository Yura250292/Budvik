/**
 * Шаблони маршрутів торгових: іменований набір населених пунктів.
 *
 * Геокодування робиться ТУТ, на створенні, а не при кожному перегляді мапи:
 * Nominatim просить не частіше запиту на секунду, тож 8 сіл — це 9 секунд.
 * Платити ці секунди раз при заведенні напрямку прийнятно, щодня — ні.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { geocodeStops } from "@/lib/routes/geocode-stops";

export const dynamic = "force-dynamic";
// Rate-limit Nominatim (1.1 с на пункт) легко виводить за типовий ліміт Vercel.
export const maxDuration = 60;

const EDIT_ROLES = ["ADMIN", "MANAGER"];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const templates = await prisma.routeTemplate.findMany({
    where: { isActive: true },
    include: {
      stops: { orderBy: { seq: "asc" } },
      _count: { select: { assignments: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    canEdit: EDIT_ROLES.includes(session.user.role),
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      region: t.region,
      totalDistanceKm: t.totalDistanceKm,
      routeGeometry: t.routeGeometry,
      assignmentsCount: t._count.assignments,
      stops: t.stops.map((s) => ({
        id: s.id,
        settlement: s.settlement,
        displayName: s.displayName,
        lat: s.lat,
        lng: s.lng,
        seq: s.seq,
      })),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | { name?: string; color?: string | null; region?: string | null; settlements?: string[] }
    | null;

  const name = body?.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Потрібна назва маршруту" }, { status: 400 });
  }
  if (!Array.isArray(body?.settlements) || body.settlements.length === 0) {
    return NextResponse.json({ error: "Потрібен хоча б один населений пункт" }, { status: 400 });
  }

  const region = body.region?.trim() || null;
  const { stops, failed, routeGeometry, totalDistanceKm } = await geocodeStops(body.settlements, region);

  if (stops.length === 0) {
    return NextResponse.json(
      { error: "Жоден населений пункт не вдалося знайти на карті", failed },
      { status: 422 }
    );
  }

  const template = await prisma.routeTemplate.create({
    data: {
      name,
      color: body.color?.trim() || null,
      region,
      createdById: session.user.id,
      routeGeometry: routeGeometry as never,
      totalDistanceKm,
      stops: { create: stops },
    },
    include: { stops: { orderBy: { seq: "asc" } } },
  });

  return NextResponse.json({ ok: true, template, failed });
}
