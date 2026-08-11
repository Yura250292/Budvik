/**
 * Погода для віджета дашборду.
 *
 * Open-Meteo: без ключа, без реєстрації й з нормальним покриттям України.
 * Проксі на сервері — щоб не світити зовнішні запити з браузера і щоб
 * однакові координати кешувалися на всіх користувачів.
 *
 * Координати приходять від клієнта (браузерна геолокація або вибране
 * місто зі списку). Округлюємо їх до 2 знаків: це ~1 км — достатньо для
 * погоди, але не дає зберігати точне місцеперебування торгового.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["ADMIN", "MANAGER", "SALES"];

/** Тернопіль — офіс, до якого падаємо, якщо координат немає. */
const FALLBACK = { lat: 49.5535, lon: 25.5948 };

export type WeatherResponse = {
  current: {
    temp: number;
    feels: number;
    code: number;
    wind: number;
    humidity: number;
    isDay: boolean;
  };
  today: { min: number; max: number; precipitation: number; sunrise: string; sunset: string };
  hourly: Array<{ time: string; temp: number; code: number; precipitation: number }>;
  daily: Array<{ date: string; min: number; max: number; code: number; precipitation: number }>;
  place: { lat: number; lon: number };
  updatedAt: string;
};

type OpenMeteo = {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    is_day: number;
  };
  hourly: { time: string[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability: number[] };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    sunrise: string[];
    sunset: string[];
  };
};

/** Координати з запиту: відкидаємо сміття й обрізаємо точність. */
function coord(raw: string | null, fallback: number, limit: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return fallback;
  return Number(n.toFixed(2));
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const lat = coord(searchParams.get("lat"), FALLBACK.lat, 90);
  const lon = coord(searchParams.get("lon"), FALLBACK.lon, 180);

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day" +
    "&hourly=temperature_2m,weather_code,precipitation_probability" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
    "&timezone=Europe%2FKiev&forecast_days=5";

  let data: OpenMeteo | null = null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      // 15 хвилин: погода не змінюється швидше, а ліміт Open-Meteo не безмежний.
      next: { revalidate: 900 },
    });
    if (res.ok) data = (await res.json()) as OpenMeteo;
  } catch {
    data = null;
  }

  if (!data?.current) {
    return NextResponse.json({ error: "Сервіс погоди недоступний" }, { status: 502 });
  }

  // Наступні 8 годин від поточної: показувати минулі години немає сенсу.
  const nowIdx = Math.max(
    0,
    data.hourly.time.findIndex((t) => t >= data!.current.time)
  );
  const hourly = data.hourly.time.slice(nowIdx, nowIdx + 8).map((time, i) => ({
    time,
    temp: Math.round(data!.hourly.temperature_2m[nowIdx + i]),
    code: data!.hourly.weather_code[nowIdx + i],
    precipitation: data!.hourly.precipitation_probability?.[nowIdx + i] ?? 0,
  }));

  const body: WeatherResponse = {
    current: {
      temp: Math.round(data.current.temperature_2m),
      feels: Math.round(data.current.apparent_temperature),
      code: data.current.weather_code,
      wind: Math.round(data.current.wind_speed_10m),
      humidity: Math.round(data.current.relative_humidity_2m),
      isDay: data.current.is_day === 1,
    },
    today: {
      min: Math.round(data.daily.temperature_2m_min[0]),
      max: Math.round(data.daily.temperature_2m_max[0]),
      precipitation: data.daily.precipitation_probability_max?.[0] ?? 0,
      sunrise: data.daily.sunrise[0],
      sunset: data.daily.sunset[0],
    },
    hourly,
    daily: data.daily.time.map((date, i) => ({
      date,
      min: Math.round(data!.daily.temperature_2m_min[i]),
      max: Math.round(data!.daily.temperature_2m_max[i]),
      code: data!.daily.weather_code[i],
      precipitation: data!.daily.precipitation_probability_max?.[i] ?? 0,
    })),
    place: { lat, lon },
    updatedAt: new Date().toISOString(),
  };

  return NextResponse.json(body);
}
