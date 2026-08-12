/**
 * Зона напрямку: кого торговий може зачепити по дорозі.
 *
 * Радіус приходить параметром, а не зберігається в шаблоні: це інструмент
 * розгляду, а не властивість маршруту. Керівник крутить повзунок «а якщо
 * 15 км?» і бачить, як міняється список — зберігати кожне таке зазирання
 * в базу немає сенсу.
 *
 * SALES теж має доступ: торговий мусить бачити свою зону, щоб будувати
 * собі маршрут. Правити напрямки він при цьому не може — це вже інший
 * ендпойнт.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { parsePeriod } from "@/lib/analytics/period";
import { clampRadius, computeZone } from "@/lib/routes/zone";

export const dynamic = "force-dynamic";

/** Правити межу може лише керівництво; торговий свою зону бачить, але не змінює. */
const EDIT_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const period = parsePeriod(url.searchParams);
  const radiusKm = clampRadius(url.searchParams.get("radius"));

  const zone = await computeZone(id, period, radiusKm);
  if (!zone) {
    return NextResponse.json({ error: "Напрямок не знайдено" }, { status: 404 });
  }

  return NextResponse.json({
    ...zone,
    period: { from: period.fromDay, to: period.toDay, days: period.days },
  });
}

/**
 * Зберігає межу, виправлену руками.
 *
 * Радіус пишеться поруч із полігоном: коли адмін потім натисне «повернути
 * автоматичну», зона має відновитися такою, якою він її бачив, а не з
 * типових 10 км.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as
    | { rings?: unknown; radiusKm?: unknown }
    | null;

  const rings = body?.rings;
  if (!Array.isArray(rings) || rings.length === 0) {
    return NextResponse.json({ error: "Потрібна межа зони" }, { status: 400 });
  }

  // Валідуємо тут, а не лише при читанні: у базу мусить лягати вже чиста
  // форма, інакше помилку видно аж наступного разу і невідомо, звідки вона.
  const clean: Array<Array<[number, number]>> = [];
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const points: Array<[number, number]> = [];
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const [lat, lng] = p;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      points.push([lat, lng]);
    }
    if (points.length >= 3) clean.push(points);
  }

  if (clean.length === 0) {
    return NextResponse.json({ error: "Межа зони некоректна" }, { status: 400 });
  }

  const radiusKm = typeof body?.radiusKm === "number" ? body.radiusKm : null;

  const updated = await prisma.routeTemplate
    .update({
      where: { id },
      data: { zonePolygon: clean, zoneRadiusKm: radiusKm },
      select: { id: true },
    })
    .catch(() => null);

  if (!updated) {
    return NextResponse.json({ error: "Напрямок не знайдено" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, rings: clean.length });
}

/** Прибирає ручну межу — зона знову рахується коридором навколо маршруту. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { id } = await params;
  const updated = await prisma.routeTemplate
    // Prisma.DbNull, а не null: для nullable Json-поля звичайний null означав би
    // «не чіпати», і межа лишилася б на місці.
    .update({ where: { id }, data: { zonePolygon: Prisma.DbNull }, select: { id: true } })
    .catch(() => null);

  if (!updated) {
    return NextResponse.json({ error: "Напрямок не знайдено" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
