import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { geocodeAddress, reverseGeocode, searchAddressCandidates } from "@/lib/geo/nominatim";

export async function GET(req: NextRequest) {
  // Проксі до Nominatim: без перевірки сесії будь-хто ганяв би через наш
  // сервер довільні запити до зовнішнього сервісу від нашого імені.
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q");
  const lat = req.nextUrl.searchParams.get("lat");
  const lng = req.nextUrl.searchParams.get("lng");

  // Reverse geocode: ?lat=...&lng=...
  if (lat && lng) {
    try {
      const result = await reverseGeocode(parseFloat(lat), parseFloat(lng));
      if (!result) {
        return NextResponse.json({ error: "Місце не знайдено" }, { status: 404 });
      }
      return NextResponse.json(result);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Помилка зворотнього геокодування";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Forward geocode: ?q=...
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ error: "Параметр q або lat+lng обовʼязкові" }, { status: 400 });
  }

  // ?all=1 — список кандидатів для ручного вибору. Окремий режим, бо
  // одиночний geocodeAddress перебирає до восьми написань з паузами і для
  // живого пошуку в полі занадто повільний.
  if (req.nextUrl.searchParams.get("all") === "1") {
    try {
      const items = await searchAddressCandidates(q.trim());
      return NextResponse.json({ items });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Помилка пошуку адреси";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  try {
    const result = await geocodeAddress(q.trim());
    if (!result) {
      return NextResponse.json({ error: "Адресу не знайдено" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Помилка геокодування";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
