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
import { parsePeriod } from "@/lib/analytics/period";
import { clampRadius, computeZone } from "@/lib/routes/zone";

export const dynamic = "force-dynamic";

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
