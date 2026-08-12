/**
 * Дорога від «я тут» до однієї точки — для навігації прямо на веб-карті.
 *
 * До цього кнопка «Навігація» відкривала застосунок Google Maps, а вихід
 * у зовнішній застосунок убиває трек: вкладка йде у фон і watchPosition
 * завмирає. Тепер лінія малюється на нашій карті, планшет лишається у
 * вебі, трек не рветься. Google Maps зостається запасним посиланням для
 * тих, кому потрібні голосові підказки.
 *
 * Проксі до OSRM, а не виклик із браузера: одна точка входу, однакова
 * обробка помилок демо-сервера і жодних сюрпризів CORS на планшетах зі
 * старим Chrome.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRoute } from "@/lib/geo/osrm";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["DRIVER", "SALES", "ADMIN", "MANAGER"];

function isLngLat(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Math.abs(v[0]) <= 180 &&
    Math.abs(v[1]) <= 90
  );
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  let body: { from?: unknown; to?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  if (!isLngLat(body.from) || !isLngLat(body.to)) {
    return NextResponse.json(
      { error: "Потрібні from і to у форматі [lng, lat]" },
      { status: 400 }
    );
  }

  try {
    const route = await getRoute([body.from, body.to]);
    return NextResponse.json({
      distanceKm: route.totalDistanceKm,
      durationMin: route.totalDurationMin,
      geometry: route.geometry,
    });
  } catch {
    return NextResponse.json(
      { error: "Сервіс маршрутів не відповів. Спробуйте ще раз за хвилину." },
      { status: 502 }
    );
  }
}
